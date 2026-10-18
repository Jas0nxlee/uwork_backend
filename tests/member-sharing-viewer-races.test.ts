import { test } from "node:test";
import assert from "node:assert/strict";
import { Script, createContext } from "node:vm";
import { createHash } from "node:crypto";
import { sharingViewerJs } from "../src/sharing-viewer-assets.js";

async function settle() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}
function deferred<T>() {
  let complete!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: complete };
}
interface TestResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
function response(
  status: number,
  body?: unknown,
  bytes?: ReturnType<typeof deferred<ArrayBuffer>>,
): TestResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    async arrayBuffer() {
      assert.ok(bytes, "this finite response has no binary body");
      return bytes.promise;
    },
  };
}
type ClickHandler = () => void | Promise<void>;
type TestFetch = (
  path: string,
  init?: { method?: string },
) => Promise<TestResponse>;

const code = "a".repeat(32);
const api = `/api/client/shares/${code}`;
const content = Buffer.from("OWNED_VIEWER_RACE_BYTES");
const artifact = {
  artifact_id: "share-artifact-1",
  display_name: "owned.txt",
  size_bytes: content.length,
  sha256: createHash("sha256").update(content).digest("hex"),
  url: `https://sharing.example.test${api}/artifacts/share-artifact-1`,
};

/** 有限假 DOM/fetch 只驱动生产脚本的两个异步交错，不是浏览器或 HTTP 验收。 */
function viewer(fetch: TestFetch) {
  const elements = new Map<string, TestElement>();
  const created: TestElement[] = [];
  const lifecycle = new Map<string, () => void>();
  let downloads = 0;
  class TestElement {
    children: TestElement[] = [];
    handlers = new Map<string, ClickHandler>();
    attributes = new Map<string, string>();
    dataset: Record<string, string> = {};
    hidden = false;
    disabled = false;
    textContent = "";
    download = "";
    focused = false;
    removed = false;
    constructor(readonly tag = "div") {
      created.push(this);
    }
    append(...nodes: TestElement[]) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes: TestElement[]) {
      this.children = [...nodes];
    }
    addEventListener(name: string, handler: ClickHandler) {
      this.handlers.set(name, handler);
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    focus() {
      this.focused = true;
    }
    remove() {
      this.removed = true;
    }
    click() {
      if (this.disabled) return;
      if (this.tag === "a" && this.download) downloads++;
      return this.handlers.get("click")?.();
    }
  }
  const element = (id: string) => {
    let value = elements.get(id);
    if (!value) {
      value = new TestElement();
      elements.set(id, value);
    }
    return value;
  };
  const root = element("root");
  root.dataset.shareCode = code;
  class TestURL extends URL {
    static createObjectURL() {
      return "blob:owned-viewer-race";
    }
    static revokeObjectURL() {}
  }
  const context = createContext({
    document: {
      querySelector: () => root,
      getElementById: element,
      createElement: (tag: string) => new TestElement(tag),
      body: new TestElement("body"),
    },
    location: { origin: "https://sharing.example.test" },
    window: {
      addEventListener: (name: string, handler: () => void) =>
        lifecycle.set(name, handler),
    },
    URL: TestURL,
    Blob,
    AbortController,
    AbortSignal,
    Date,
    Uint8Array,
    Error,
    Promise,
    Array,
    String,
    crypto: {
      subtle: {
        async digest(algorithm: string, bytes: ArrayBuffer) {
          assert.equal(algorithm, "SHA-256");
          return Uint8Array.from(
            createHash("sha256").update(new Uint8Array(bytes)).digest(),
          ).buffer;
        },
      },
    },
    // 故意允许已接受的假响应晚到，验证消费者围栏，不能只依赖传输层完成 abort。
    fetch,
    setTimeout: () => 0,
  });
  new Script(sharingViewerJs, {
    filename: "sharing-viewer-production.js",
  }).runInContext(context);
  return {
    element,
    root,
    created,
    get downloads() {
      return downloads;
    },
    click: (id: string) => element(id).click(),
    dispose: () => lifecycle.get("pagehide")?.(),
  };
}

test("an old share download cannot create a Blob download after logout completes", async (t) => {
  const body = deferred<ArrayBuffer>();
  let signedOut = false;
  const ui = viewer(async (path) => {
    if (path === `${api}/preview`)
      return signedOut
        ? response(401, { error: { code: "SESSION_EXPIRED" } })
        : response(200, {
            share: { title: "Owned title", expires_at: Date.now() + 1000 },
            rows: [{ kind: "assistantText", text: "Owned body" }],
            artifacts: [artifact],
            can_revoke: true,
          });
    if (path.endsWith("/content")) return response(200, undefined, body);
    if (path === "/api/auth/logout") {
      signedOut = true;
      return response(204);
    }
    throw new Error("Unexpected finite viewer request");
  });
  t.after(() => ui.dispose());
  await settle();
  assert.equal(ui.root.dataset.state, "ready");
  const button = ui.created.find(
    (item) => item.dataset.artifactId === artifact.artifact_id,
  );
  assert.ok(button);
  const oldDownload = button.click();
  await settle();
  await ui.click("logout");
  await settle();
  assert.equal(ui.root.dataset.state, "unavailable");
  body.resolve(Uint8Array.from(content).buffer);
  await oldDownload;
  await settle();
  assert.equal(
    ui.downloads,
    0,
    "old download crossed logout and created a Blob download",
  );
});

test("an old login cleanup cannot overwrite a newer attempt presentation", async (t) => {
  const claimA = deferred<TestResponse>(),
    cancelA = deferred<TestResponse>(),
    claimB = deferred<TestResponse>();
  let attempts = 0;
  const ui = viewer(async (path) => {
    if (path === `${api}/preview`)
      return response(401, { error: { code: "SESSION_EXPIRED" } });
    if (path === `/api/auth/shares/${code}/context`)
      return response(200, { tenantId: "owned-tenant" });
    if (path === "/api/auth/wecom/attempts") {
      const id = ++attempts === 1 ? "A" : "B";
      return response(201, {
        id,
        proof: `synthetic-proof-${id}`,
        expiresAt: Date.now() + 300000,
        authorizeUrl: `https://login.work.weixin.qq.com/wwlogin/sso/login?state=${id}`,
      });
    }
    if (path.endsWith("/A/claim")) return claimA.promise;
    if (path.endsWith("/A/cancel")) return cancelA.promise;
    if (path.endsWith("/B/claim")) return claimB.promise;
    if (path.endsWith("/B/cancel")) return response(200, { ok: true });
    throw new Error("Unexpected finite viewer request");
  });
  t.after(async () => {
    ui.dispose();
    claimB.resolve(response(503, { error: { code: "TEST_CLOSED" } }));
    await settle();
  });
  await settle();
  const oldLogin = ui.click("login");
  await settle();
  assert.equal(ui.element("auth-box").hidden, false);
  claimA.resolve(response(503, { error: { code: "OWNED_A_FAILURE" } }));
  await settle();
  const admitsBWhileCancelling = !ui.element("login").disabled;
  if (admitsBWhileCancelling) {
    void ui.click("login");
    await settle();
    assert.equal(attempts, 2);
    assert.equal(ui.element("notice").textContent, "");
  }
  cancelA.resolve(response(200, { ok: true }));
  await oldLogin;
  await settle();
  // 同样接受延迟 B 到 A cleanup 结束的安全 admission，不限定修复必须用哪种内部票据。
  if (!admitsBWhileCancelling) {
    void ui.click("login");
    await settle();
    assert.equal(attempts, 2);
  }
  assert.equal(
    ui.element("notice").textContent,
    "",
    "late A cleanup wrote its error onto B",
  );
});
