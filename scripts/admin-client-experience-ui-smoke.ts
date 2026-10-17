// 独占真实后台+原样API代理，旧/新正式静态资源对照；不构建或替换主admin/dist。
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  readdir,
  stat,
  rm,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import {
  clientExperienceSchemas,
  type ClientExperienceKind,
} from "../src/client-experience.js";
import {
  OwnedAdminBrowser,
  boundedWait,
  portClosed,
} from "./fixtures/owned-admin-browser.js";

type Row = Record<string, unknown>;
interface FileHash {
  path: string;
  sha256: string;
}
interface Config {
  draft: unknown;
  published: unknown;
  revision: number;
  version: number;
}
const run = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
const evidence = resolve(
  "evidence/admin-client-experience-20261017/browser",
  run,
);
await mkdir(evidence, { recursive: true, mode: 0o700 });
const oldDist = resolve(
  "evidence/admin-client-experience-20261017/scope-old-assets",
);
const manifestPath = resolve(
  "evidence/client-experience-20261017/owned-admin-artifacts.json",
);
const ownedManifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  outDir: string;
  ownedAssets: FileHash[];
  sources: FileHash[];
};
assert.ok(
  ownedManifest.outDir.startsWith(
    resolve("evidence/client-experience-20261017") + "/",
  ),
);
for (const source of ownedManifest.sources)
  assert.equal(
    createHash("sha256")
      .update(await readFile(resolve(source.path)))
      .digest("hex"),
    source.sha256,
    `source changed since owned build: ${source.path}`,
  );
const oldManifest = JSON.parse(
  await readFile(join(oldDist, "manifest.json"), "utf8"),
) as { files: FileHash[] };
const hashTree = async (
  directory: string,
  relative = "",
): Promise<FileHash[]> => {
  const results: FileHash[] = [];
  for (const entry of await readdir(join(directory, relative), {
    withFileTypes: true,
  })) {
    const name = join(relative, entry.name);
    if (entry.isDirectory()) results.push(...(await hashTree(directory, name)));
    else if (entry.isFile())
      results.push({
        path: name,
        sha256: createHash("sha256")
          .update(await readFile(join(directory, name)))
          .digest("hex"),
      });
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
};
const mainBefore = await hashTree(resolve("admin/dist"));
const allPhases: Row[] = [];
const kinds: ClientExperienceKind[] = [
  "scenes",
  "help",
  "desktop",
  "plugin-store",
];
const expectedDrafts = {
  scenes: {
    draftSuggestions: [
      {
        id: "draft-browser",
        title: { cn: "浏览器草稿建议", en: "Browser suggestion" },
        prompt: { cn: "生成受控工作摘要", en: "Summarize the owned fixture" },
        icon: "sparkles",
        actions: ["NAVIGATE:AUTOMATIONS"],
        pluginStableId: "fixture.existing-plugin",
      },
    ],
    scheduledTemplates: [
      {
        id: "scheduled-browser",
        title: { cn: "浏览器定时模板", en: "Browser schedule" },
        prompt: { cn: "整理受控日报", en: "Prepare an owned daily report" },
        cronExpr: "0 9 * * 1-5",
      },
    ],
    offPeakTemplates: [
      {
        id: "offpeak-browser",
        title: { cn: "浏览器错峰模板", en: "Browser off peak" },
        prompt: { cn: "检查受控示例", en: "Inspect the owned example" },
        description: { cn: "受控夜间示例", en: "Owned overnight example" },
      },
    ],
  },
  help: {
    communityUrls: {
      "zh-CN": "https://community.example.test/zh-cn",
      "en-US": "https://community.example.test/en-us",
    },
    feedback: { mode: "external", url: "https://feedback.example.test/form" },
  },
  desktop: {
    desktopContextPrompt: { enabled: true },
    rendererActionTrace: {
      enabled: true,
      sampleRatio: 0.1,
      enabledGroups: ["core", "settings"],
    },
  },
  "plugin-store": {
    order: {
      code: {
        categoryOrder: ["category-a", "category-b"],
        pluginOrder: { "category-a": ["plugin/one", "plugin/two"] },
      },
      work: {
        categoryOrder: ["work-category"],
        pluginOrder: { "work-category": ["work/plugin"] },
      },
    },
  },
};
const closeServer = (server: Server) =>
  new Promise<void>((done, reject) => {
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : done()));
  });
async function phase(phase: "red" | "green", dist: string, assets: FileHash[]) {
  const phaseEvidence = join(evidence, phase);
  await mkdir(phaseEvidence, { recursive: true, mode: 0o700 });
  const snapshot = join(phaseEvidence, "assets");
  const allowed = new Map<string, string>();
  for (const asset of assets) {
    assert.match(
      asset.path,
      /^(?:assets\/[A-Za-z0-9_.-]+\.(?:js|css)|index\.html|brand\.svg)$/,
    );
    const bytes = await readFile(join(dist, asset.path));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      asset.sha256,
      `asset changed: ${asset.path}`,
    );
    await mkdir(dirname(join(snapshot, asset.path)), { recursive: true });
    await copyFile(join(dist, asset.path), join(snapshot, asset.path));
    allowed.set("/" + asset.path, join(snapshot, asset.path));
  }
  const root = await mkdtemp("/tmp/acx-");
  const password = randomBytes(24).toString("hex"),
    tokens: string[] = [];
  const redact = (text: string) =>
    [password, ...tokens].reduce(
      (value, secret) =>
        secret ? value.replaceAll(secret, "[REDACTED]") : value,
      text,
    );
  let backendOrigin = "",
    frontendOrigin = "",
    app: Awaited<ReturnType<typeof createApp>> | undefined;
  let failure: string | undefined;
  const receipts: Row[] = [],
    dom: Row[] = [],
    checks: Row[] = [],
    serverData: Row[] = [],
    gateFacts: Row[] = [];
  let gating = false,
    release!: () => void;
  const released = new Promise<void>((done) => {
    release = done;
  });
  const heldIds = new Set<string>(),
    sentIds = new Set<string>();
  let tenantA = "",
    tenantB = "";
  const markerA = `SCOPE-${phase}-A-owned`,
    markerB = `SCOPE-${phase}-B-current`;
  const browser = new OwnedAdminBrowser({
    root,
    evidence: phaseEvidence,
    name: `acx-${phase}-${run.slice(-6)}`,
    redact,
  });
  const frontend = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path.startsWith("/api/") || path.startsWith("/v1/")) {
      if (!backendOrigin) {
        res.writeHead(503).end();
        return;
      }
      const upstream = httpRequest(
        new URL(req.url ?? "/", backendOrigin),
        { method: req.method, headers: req.headers },
        (reply) => {
          res.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
      return;
    }
    const file = allowed.get(path === "/" ? "/index.html" : path);
    if (!file || !["GET", "HEAD"].includes(req.method ?? "")) {
      res.writeHead(404).end();
      return;
    }
    void readFile(file).then(
      (bytes) => {
        res.setHeader("cache-control", "no-store");
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("x-frame-options", "DENY");
        res.setHeader("referrer-policy", "no-referrer");
        if (path === "/")
          res.setHeader(
            "content-security-policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          );
        res.setHeader(
          "content-type",
          file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : file.endsWith(".svg")
                ? "image/svg+xml"
                : "text/html; charset=utf-8",
        );
        res.writeHead(200).end(req.method === "HEAD" ? undefined : bytes);
      },
      () => res.writeHead(500).end(),
    );
  });
  let frontendClosed = false,
    backendClosed = false;
  let browserCleanup: Row = {};
  const cleanup: Row = {};
  try {
    await new Promise<void>((done) => frontend.listen(0, "127.0.0.1", done));
    frontendOrigin = `http://127.0.0.1:${(frontend.address() as { port: number }).port}`;
    assert.notEqual(new URL(frontendOrigin).port, "3000");
    app = await createApp({
      database: join(root, "backend.sqlite"),
      masterKey: randomBytes(32),
      publicUrl: frontendOrigin,
      worker: false,
    });
    const a = await bootstrap(app.services.db, {
      name: "A Owned UI",
      email: "experience-a@example.test",
      password,
    });
    const b = await bootstrap(app.services.db, {
      name: "B Owned UI",
      email: "experience-b@example.test",
      password,
    });
    tenantA = a.tenantId;
    tenantB = b.tenantId;
    // 仅初始化同一用户的第二组织成员关系；配置准备与后续验证全部走真实API。
    app.services.db.run(
      "INSERT INTO members(tenant_id,user_id,role,seat) VALUES(?,?,'admin',1)",
      tenantB,
      a.userId,
    );
    app.addHook("onSend", async (req, reply, payload) => {
      const params = req.params as { tenantId?: string; kind?: string };
      if (
        gating &&
        req.method === "GET" &&
        req.routeOptions.url ===
          "/api/tenants/:tenantId/configurations/:kind" &&
        params.tenantId === tenantA &&
        params.kind === "new-chat" &&
        reply.statusCode === 200 &&
        req.headers["user-agent"] !== "uwork-experience-verification"
      ) {
        const actual = JSON.parse(String(payload)) as Config;
        heldIds.add(req.id);
        gateFacts.push({
          event: "held-after-real-read",
          requestId: req.id,
          tenantId: tenantA,
          kind: "new-chat",
          revision: actual.revision,
          welcome: (actual.draft as Row).welcome,
        });
        await released;
        gateFacts.push({ event: "released-unchanged", requestId: req.id });
      }
      return payload;
    });
    app.addHook("onResponse", async (req, reply) => {
      if (heldIds.has(req.id)) sentIds.add(req.id);
      const body = req.body as Row | undefined;
      receipts.push({
        requestId: req.id,
        method: req.method,
        path: req.url,
        route: req.routeOptions.url ?? "unmatched",
        status: reply.statusCode,
        channel:
          req.headers["user-agent"] === "uwork-experience-verification"
            ? "api-cross-check"
            : "browser-ui",
        ...(req.method === "PUT" &&
        req.routeOptions.url === "/api/tenants/:tenantId/configurations/:kind"
          ? { revision: body?.revision, data: body?.data }
          : {}),
      });
    });
    backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
    assert.notEqual(new URL(backendOrigin).port, "3000");
    const request = async <T = Row>(
      token: string,
      path: string,
      method = "GET",
      body?: unknown,
    ) => {
      assert.ok(
        path.startsWith("/api/") &&
          !/device-tokens|wecom|connectors|\/runs|\/commands/.test(path),
      );
      const response = await fetch(backendOrigin + path, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          "user-agent": "uwork-experience-verification",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.equal(response.status, 200, `${method} ${path} actual status`);
      return {
        data: (await response.json()) as T,
        etag: response.headers.get("etag"),
      };
    };
    const login = async (email: string, tenantId: string) => {
      const { data } = await request<{ token: string }>(
        "",
        "/api/auth/login",
        "POST",
        { email, password, tenantId },
      );
      assert.equal(typeof data.token, "string");
      tokens.push(data.token);
      return data.token;
    };
    const tokenA = await login("experience-a@example.test", tenantA),
      tokenB = await login("experience-b@example.test", tenantB);
    const pa = `/api/tenants/${tenantA}`,
      pb = `/api/tenants/${tenantB}`;
    for (const [token, base, welcome] of [
      [tokenA, pa, markerA],
      [tokenB, pb, markerB],
    ] as const) {
      const { data } = await request<Config>(
        token,
        `${base}/configurations/new-chat`,
      );
      const saved = await request<{ revision: number }>(
        token,
        `${base}/configurations/new-chat`,
        "PUT",
        { revision: data.revision, data: { ...(data.draft as Row), welcome } },
      );
      await request(token, `${base}/configurations/new-chat/publish`, "POST", {
        revision: saved.data.revision,
      });
    }
    await browser.start();
    const env = {
      UWORK_EXPERIENCE_ORIGIN: frontendOrigin,
      UWORK_EXPERIENCE_PHASE: phase,
      UWORK_EXPERIENCE_EMAIL: "experience-a@example.test",
      UWORK_EXPERIENCE_PASSWORD: password,
      UWORK_EXPERIENCE_TENANT_A: tenantA,
      UWORK_EXPERIENCE_TENANT_B: tenantB,
      UWORK_EXPERIENCE_MARKER_A: markerA,
      UWORK_EXPERIENCE_MARKER_B: markerB,
    };
    const runBrowser = async (stage: string, kind = "") => {
      const result = await browser.run(
        resolve("scripts/admin-client-experience-ui-browser.py"),
        stage,
        { ...env, UWORK_EXPERIENCE_KIND: kind },
      );
      dom.push(result);
      console.log(JSON.stringify({ phase, stage, status: "dom-verified" }));
      return result;
    };
    gating = true;
    const pending = await runBrowser("race-start");
    await boundedWait(
      async () => heldIds.size,
      (count) => count > 0,
      "real A response held",
    );
    if (phase === "green") assert.equal(pending.pendingWritesDisabled, true);
    const switched = await runBrowser("race-switch-b");
    assert.equal(switched.headerTenant, tenantB);
    assert.equal(switched.welcome, markerB);
    gating = false;
    release();
    await boundedWait(
      async () => sentIds.size,
      (count) => count === heldIds.size,
      "original A body completed",
    );
    const observed = await runBrowser("race-observe-save");
    assert.equal(observed.headerTenant, tenantB);
    assert.equal(observed.welcome, phase === "red" ? markerA : markerB);
    const bAfterRace = (
      await request<Config>(tokenB, `${pb}/configurations/new-chat`)
    ).data;
    assert.equal(
      (bAfterRace.draft as Row).welcome,
      phase === "red" ? markerA : markerB,
    );
    assert.equal((bAfterRace.published as Row).welcome, markerB);
    checks.push({
      check: "late-tenant-same-kind",
      expectedInvariantPassed: phase === "green",
      headerTenant: tenantB,
      shownWelcome: observed.welcome,
      savedBWelcome: (bAfterRace.draft as Row).welcome,
      publishedBWelcome: (bAfterRace.published as Row).welcome,
    });
    if (phase === "red") {
      try {
        assert.equal(
          observed.welcome,
          markerB,
          "late A response must not overwrite current B form",
        );
      } catch (error) {
        await writeFile(
          join(phaseEvidence, "old-invariant-red.log"),
          redact(
            error instanceof Error ? error.message : "old invariant failed",
          ),
          { mode: 0o600 },
        );
      }
    }
    if (phase === "green") {
      for (const kind of kinds) {
        const initial = (
          await request<Config>(tokenB, `${pb}/configurations/${kind}`)
        ).data;
        const initialClient = (
          await request<{ configuration: Row; versions: Row }>(
            tokenB,
            "/api/client/configuration",
          )
        ).data;
        await runBrowser(`${kind}-draft`, kind);
        const draft = (
          await request<Config>(tokenB, `${pb}/configurations/${kind}`)
        ).data;
        clientExperienceSchemas[kind].parse(draft.draft);
        assert.deepEqual(
          draft.draft,
          expectedDrafts[kind],
          `${kind} actual UI draft must match all intended fields`,
        );
        const draftClient = (
          await request<{ configuration: Row; versions: Row }>(
            tokenB,
            "/api/client/configuration",
          )
        ).data;
        assert.notDeepEqual(draft.draft, initial.published);
        assert.deepEqual(
          draftClient.configuration[kind],
          initialClient.configuration[kind],
        );
        assert.equal(draftClient.versions[kind], initialClient.versions[kind]);
        serverData.push({
          kind,
          stage: "draft",
          ...draft,
          clientData: draftClient.configuration[kind],
          clientVersion: draftClient.versions[kind],
        });
        await runBrowser(`${kind}-publish`, kind);
        const published = (
          await request<Config>(tokenB, `${pb}/configurations/${kind}`)
        ).data;
        const publishedClient = (
          await request<{ configuration: Row; versions: Row }>(
            tokenB,
            "/api/client/configuration",
          )
        ).data;
        assert.equal(published.version, initial.version + 1);
        assert.deepEqual(published.published, draft.draft);
        assert.deepEqual(
          publishedClient.configuration[kind],
          published.published,
        );
        assert.equal(publishedClient.versions[kind], published.version);
        serverData.push({
          kind,
          stage: "published",
          ...published,
          clientData: publishedClient.configuration[kind],
          clientVersion: publishedClient.versions[kind],
        });
        await runBrowser(`${kind}-edit`, kind);
        const edited = (
          await request<Config>(tokenB, `${pb}/configurations/${kind}`)
        ).data;
        const editedClient = (
          await request<{ configuration: Row; versions: Row }>(
            tokenB,
            "/api/client/configuration",
          )
        ).data;
        assert.notDeepEqual(edited.draft, published.published);
        if (kind === "help") {
          assert.equal(
            ((edited.draft as Row).communityUrls as Row)["zh-CN"],
            null,
          );
          assert.deepEqual((edited.draft as Row).feedback, {
            mode: "disabled",
            url: null,
          });
        }
        assert.deepEqual(editedClient.configuration[kind], published.published);
        assert.equal(edited.version, published.version);
        serverData.push({
          kind,
          stage: "edited-unpublished",
          ...edited,
          clientData: editedClient.configuration[kind],
        });
        await runBrowser(`${kind}-discard`, kind);
        const discarded = (
          await request<Config>(tokenB, `${pb}/configurations/${kind}`)
        ).data;
        assert.deepEqual(discarded.draft, published.published);
        assert.equal(discarded.version, published.version);
        serverData.push({ kind, stage: "discarded", ...discarded });
      }
      for (const kind of kinds) await runBrowser(`layout-${kind}`, kind);
    }
    for (const [token, base, tenant] of [
      [tokenA, pa, "A"],
      [tokenB, pb, "B"],
    ] as const)
      for (const kind of ["new-chat", ...kinds])
        serverData.push({
          tenant,
          kind,
          stage: "final",
          ...(await request<Config>(token, `${base}/configurations/${kind}`))
            .data,
        });
    assert.equal(
      receipts.some((row) =>
        /device-tokens|\/wecom|connectors|\/v1\/|\/commands|\/runs\//.test(
          String(row.path),
        ),
      ),
      false,
    );
  } catch (error) {
    failure = redact(
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "owned UI verification failed",
    );
  } finally {
    gating = false;
    release();
    try {
      browserCleanup = await browser.close();
    } catch (error) {
      browserCleanup = {
        cleanupError: redact(
          error instanceof Error ? error.message : "unknown cleanup error",
        ),
      };
      failure ??= "owned browser cleanup failed";
    }
    try {
      await closeServer(frontend);
      frontendClosed = true;
    } catch {
      failure ??= "owned frontend close failed";
    }
    if (app)
      try {
        app.server.closeAllConnections();
        await app.close();
        backendClosed = true;
      } catch {
        failure ??= "owned backend close failed";
      }
    const frontendPort = frontendOrigin
        ? Number(new URL(frontendOrigin).port)
        : null,
      backendPort = backendOrigin ? Number(new URL(backendOrigin).port) : null;
    cleanup.browser = browserCleanup;
    cleanup.frontend = {
      port: frontendPort,
      closed:
        frontendClosed && (!frontendPort || (await portClosed(frontendPort))),
    };
    cleanup.backend = {
      port: backendPort,
      closed:
        backendClosed && (!backendPort || (await portClosed(backendPort))),
    };
    const quiesced =
      browserCleanup.fullyClosed === true &&
      (cleanup.frontend as Row).closed === true &&
      (cleanup.backend as Row).closed === true;
    if (quiesced) await rm(root, { recursive: true, force: true });
    else
      failure ??= "owned resources not fully closed; temporary root retained";
    cleanup.root = root;
    cleanup.rootRemoved = await stat(root).then(
      () => false,
      () => true,
    );
    cleanup.bhRemoved = await stat(join(root, "bh")).then(
      () => false,
      () => true,
    );
    const record = {
      phase,
      status: failure
        ? "failed"
        : phase === "red"
          ? "old-red-reproduced"
          : "passed",
      failure,
      fixturePid: process.pid,
      boundary:
        "immutable official assets; actual DOM/CDP; real owned backend behind raw static/API proxy; unchanged actual A GET held after read; setup/API cross-check separate; no fetch/React/store response injection; no main env/DB/Vault/assets/clientout/model/paid/WeCom/MCP/drive/device/remote probes",
      frontendOrigin,
      backendOrigin,
      assets,
      tenants: { A: tenantA, B: tenantB },
      receipts,
      gateFacts,
      dom,
      checks,
      serverData,
      cleanup,
    };
    const encoded = JSON.stringify(record, null, 2);
    if (redact(encoded) !== encoded)
      throw new Error("private verification material entered evidence");
    await writeFile(join(phaseEvidence, "result.json"), encoded, {
      mode: 0o600,
    });
    allPhases.push(record);
    console.log(
      JSON.stringify({
        phase,
        status: record.status,
        failure,
        evidence: phaseEvidence,
        fullyClosed: quiesced,
      }),
    );
    if (failure) throw new Error(failure);
  }
}

let failure: string | undefined;
try {
  await phase("red", oldDist, oldManifest.files);
  await phase("green", ownedManifest.outDir, ownedManifest.ownedAssets);
} catch (error) {
  failure = error instanceof Error ? error.message : "verification failed";
  process.exitCode = 1;
} finally {
  const mainAfter = await hashTree(resolve("admin/dist"));
  const mainAssetsUnchanged =
    JSON.stringify(mainBefore) === JSON.stringify(mainAfter);
  if (!mainAssetsUnchanged) {
    failure ??= "main admin assets changed during verification";
    process.exitCode = 1;
  }
  await writeFile(
    join(evidence, "summary.json"),
    JSON.stringify(
      {
        status: failure ? "failed" : "passed",
        failure,
        run,
        backendNode: process.version,
        manifestPath,
        ownedAssets: ownedManifest.ownedAssets,
        sources: ownedManifest.sources,
        mainAssetsUnchanged,
        mainBefore,
        mainAfter,
        phases: allPhases.map((row) => ({
          phase: row.phase,
          status: row.status,
          failure: row.failure,
          cleanup: row.cleanup,
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: failure ? "failed" : "passed",
      evidence,
      mainAssetsUnchanged,
      failure,
    }),
  );
}
