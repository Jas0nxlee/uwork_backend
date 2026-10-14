import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import type { SandboxDriver, SandboxOwner } from "../src/sandbox/contract.js";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
class ControlledDriver implements SandboxDriver {
  containers = new Map<string, boolean>();
  creations: SandboxOwner[] = [];
  executions = 0;
  stopFails = false;
  entered = gate();
  stopGate: ReturnType<typeof gate> | undefined;
  inspectGate: ReturnType<typeof gate> | undefined;
  inspectEntered = gate();
  private inspectCalls = 0;
  async health() {
    return { available: true, image: "controlled" };
  }
  async create(owner: SandboxOwner) {
    this.creations.push(owner);
    this.containers.set(owner.id, true);
    return { containerId: owner.id, running: true, exitCode: null };
  }
  async inspect(owner: SandboxOwner) {
    if (this.inspectGate && this.inspectCalls++ === 0) {
      this.inspectEntered.release();
      await this.inspectGate.promise;
    }
    const running = this.containers.get(owner.id);
    return running === undefined
      ? null
      : { containerId: owner.id, running, exitCode: running ? null : 0 };
  }
  async execute(owner: SandboxOwner, code: string, signal: AbortSignal) {
    this.executions++;
    this.entered.release();
    if (code === "hang")
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) reject(new Error("Cancelled"));
        else
          signal.addEventListener(
            "abort",
            () => reject(new Error("Cancelled")),
            { once: true },
          );
      });
    return { stdout: "42\n", stderr: "", exitCode: 0 };
  }
  async stop(owner: SandboxOwner) {
    if (this.stopFails) throw new Error("Controlled stop failure");
    if (this.stopGate) await this.stopGate.promise;
    if (this.containers.has(owner.id)) this.containers.set(owner.id, false);
  }
  async remove(owner: SandboxOwner) {
    await this.stop(owner);
    this.containers.delete(owner.id);
  }
}
async function setup(t: TestContext) {
  const driver = new ControlledDriver();
  let modelCalls = 0;
  let responseGate: ReturnType<typeof gate> | undefined;
  const requested = gate();
  const upstream = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    modelCalls++;
    requested.release();
    if (responseGate) await responseGate.promise;
    const last = body.messages.at(-1);
    const user = body.messages.findLast(
      (message: { role: string }) => message.role === "user",
    ).content;
    const again = user === "repeat" || user === "conflict" || user === "new";
    const wantsTool = last.role !== "tool" || again;
    const code =
      user === "hang"
        ? "hang"
        : user === "conflict" && last.role === "tool"
          ? "different"
          : "console.log(42)";
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: wantsTool
              ? {
                  content: null,
                  tool_calls: [
                    {
                      id: user === "new" ? `call_${modelCalls}` : "call_code",
                      type: "function",
                      function: {
                        name: "execute_javascript",
                        arguments: JSON.stringify({ code }),
                      },
                    },
                  ],
                }
              : { content: "42" },
            finish_reason: wantsTool ? "tool_calls" : "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 19),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
    sandboxDriver: driver,
  });
  t.after(async () => {
    driver.stopGate?.release();
    driver.inspectGate?.release();
    responseGate?.release();
    await app.close();
    upstream.closeAllConnections();
    upstream.close();
  });
  const { tenantId, userId } = await bootstrap(app.services.db, {
    name: "Agent tools",
    email: "owner@example.test",
    password: "controlled-password-long",
  });
  const headers = {
    authorization: `Bearer ${(await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "owner@example.test", password: "controlled-password-long" } })).json().token}`,
  };
  const path = `/api/tenants/${tenantId}`;
  const credential = (
    await app.inject({
      method: "POST",
      url: `${path}/credentials`,
      headers,
      payload: { name: "Controlled model", value: "synthetic-only" },
    })
  ).json().id;
  const model = (
    await app.inject({
      method: "POST",
      url: `${path}/models`,
      headers,
      payload: {
        name: "Controlled",
        upstreamModel: "controlled",
        baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`,
        credentialId: credential,
        scope: { all: true },
        supportsTools: true,
        maxOutputTokens: 128,
      },
    })
  ).json().id;
  const agent = await app.inject({
    method: "POST",
    url: `${path}/agents`,
    headers,
    payload: {
      name: "Code agent",
      modelId: model,
      instructions: "Calculate with isolated code",
      scope: { all: true },
      maxOutputTokens: 128,
      sandbox: true,
      maxTurns: 3,
      maxToolCalls: 2,
      toolTimeoutMs: 1000,
    },
  });
  assert.equal(agent.statusCode, 201, agent.body);
  const agentId = agent.json().id;
  await app.inject({
    method: "POST",
    url: `${path}/agents/${agentId}/publish`,
    headers,
    payload: { version: 1 },
  });
  const config = (
    await app.inject({
      method: "PUT",
      url: `${path}/configurations/security`,
      headers,
      payload: { revision: 0, data: { allowSandbox: true } },
    })
  ).json();
  await app.inject({
    method: "POST",
    url: `${path}/configurations/security/publish`,
    headers,
    payload: { revision: config.revision },
  });
  const enqueue = async (input: string, timeoutMs = 1000) => {
    const response = await app.inject({
      method: "POST",
      url: `${path}/runs`,
      headers,
      payload: { agentId, input, timeoutMs },
    });
    assert.equal(response.statusCode, 202, response.body);
    return response.json().id as string;
  };
  const view = async (id: string) =>
    (await app.inject({ url: `${path}/runs/${id}`, headers })).json();
  return {
    app,
    driver,
    headers,
    path,
    tenantId,
    userId,
    model,
    agentId,
    enqueue,
    view,
    modelCalls: () => modelCalls,
    requested,
    holdResponse: (value: ReturnType<typeof gate>) => {
      responseGate = value;
    },
  };
}
test("a published Agent uses the SDK, billed model turns and one persistent isolated code execution", async (t) => {
  const f = await setup(t),
    runId = await f.enqueue("calculate");
  await f.app.services.runtime.drain();
  const run = await f.view(runId);
  assert.equal(run.status, "succeeded", JSON.stringify(run));
  assert.equal(run.output, "42");
  assert.equal(f.modelCalls(), 2);
  assert.equal(f.driver.executions, 1);
  assert.equal(f.driver.containers.size, 0);
  const tools = (
    await f.app.inject({
      url: `${f.path}/runs/${runId}/tools`,
      headers: f.headers,
    })
  ).json();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].status, "succeeded");
  assert.ok(tools[0].execution_id);
  assert.ok(tools[0].result.includes("42"));
  const raw = f.app.services.db.get<{ input: string; result: string }>(
    "SELECT input,result FROM run_tools WHERE run_id=?",
    runId,
  )!;
  assert.ok(!raw.input.includes("console.log"));
  assert.ok(!raw.result.includes("stdout"));
  assert.equal(
    f.app.services.db.all("SELECT id FROM ledger WHERE status='settled'")
      .length,
    2,
  );
});

test("an unconfirmed container stop cannot be reported as confirmed tool cancellation", async (t) => {
  const f = await setup(t),
    runId = await f.enqueue("hang", 5000),
    work = f.app.services.runtime.drain();
  await f.driver.entered.promise;
  f.driver.stopFails = true;
  try {
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `${f.path}/runs/${runId}/cancel`,
          headers: f.headers,
        })
      ).statusCode,
      200,
    );
    await work;
    const run = await f.view(runId);
    assert.equal(run.status, "failed", JSON.stringify(run));
    assert.equal(run.error_code, "STOP_UNCONFIRMED");
    const tool = f.app.services.db.get<{ status: string; error_code: string }>(
      "SELECT status,error_code FROM run_tools WHERE run_id=?",
      runId,
    )!;
    assert.equal(tool.status, "uncertain");
    assert.equal(tool.error_code, "STOP_UNCONFIRMED");
  } finally {
    f.driver.stopFails = false;
    await f.app.services.sandbox.releaseRun(runId);
  }
});

test("a tool deadline produces a timed-out parent only after sandbox removal", async (t) => {
  const f = await setup(t),
    runId = await f.enqueue("hang", 3000);
  await f.app.services.runtime.drain();
  const run = await f.view(runId);
  assert.equal(run.status, "timed_out", JSON.stringify(run));
  assert.equal(run.error_code, "TIMEOUT");
  assert.equal(f.driver.containers.size, 0);
  assert.equal(
    f.app.services.db.get<{ status: string }>(
      "SELECT status FROM sandbox_executions",
    )!.status,
    "timed_out",
  );
  assert.equal(
    f.app.services.db.get<{ status: string }>("SELECT status FROM run_tools")!
      .status,
    "timed_out",
  );
});
test("cancelling a running code Agent waits for its actual sandbox stop before a terminal result", async (t) => {
  const f = await setup(t),
    runId = await f.enqueue("hang", 5000);
  f.driver.stopGate = gate();
  const work = f.app.services.runtime.drain();
  await f.driver.entered.promise;
  let returned = false;
  const cancelling = f.app
    .inject({
      method: "POST",
      url: `${f.path}/runs/${runId}/cancel`,
      headers: f.headers,
    })
    .then((response) => {
      returned = true;
      return response;
    });
  for (let i = 0; i < 100; i++) {
    if (
      f.app.services.db.get<{ cancel_requested: number }>(
        "SELECT cancel_requested FROM runs WHERE id=?",
        runId,
      )?.cancel_requested
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(returned, false);
  assert.equal((await f.view(runId)).status, "running");
  f.driver.stopGate.release();
  assert.equal((await cancelling).statusCode, 200);
  await work;
  assert.equal((await f.view(runId)).status, "cancelled");
  assert.equal(f.driver.containers.size, 0);
  assert.equal(f.modelCalls(), 1);
});
test("repeated tool identities do not repeat code and changed arguments are rejected", async (t) => {
  const f = await setup(t);
  for (const input of ["repeat", "conflict"]) {
    const before = f.driver.executions,
      runId = await f.enqueue(input);
    await f.app.services.runtime.drain();
    const run = await f.view(runId);
    assert.equal(run.status, "failed", JSON.stringify(run));
    assert.equal(f.driver.executions - before, 1);
    assert.equal(f.driver.containers.size, 0);
    if (input === "conflict")
      assert.equal(run.error_code, "TOOL_IDEMPOTENCY_CONFLICT");
    else assert.equal(run.error_code, "MODEL_TURN_LIMIT");
  }
});

test("a policy revoked during model generation prevents any sandbox provision or code execution", async (t) => {
  const f = await setup(t),
    hold = gate();
  f.holdResponse(hold);
  const runId = await f.enqueue("calculate"),
    work = f.app.services.runtime.drain();
  await f.requested.promise;
  const old = (
    await f.app.inject({
      url: `${f.path}/configurations/security`,
      headers: f.headers,
    })
  ).json();
  const draft = (
    await f.app.inject({
      method: "PUT",
      url: `${f.path}/configurations/security`,
      headers: f.headers,
      payload: { revision: old.revision, data: { allowSandbox: false } },
    })
  ).json();
  await f.app.inject({
    method: "POST",
    url: `${f.path}/configurations/security/publish`,
    headers: f.headers,
    payload: { revision: draft.revision },
  });
  hold.release();
  await work;
  const run = await f.view(runId);
  assert.equal(run.status, "failed", JSON.stringify(run));
  assert.equal(run.error_code, "AGENT_TOOLS_DENIED");
  assert.equal(f.driver.executions, 0);
  assert.equal(f.driver.containers.size, 0);
  assert.equal(f.modelCalls(), 1);
});

test("cancellation racing a Docker observation cannot enqueue new code after the parent cancellation intent", async (t) => {
  const f = await setup(t);
  f.driver.inspectGate = gate();
  const runId = await f.enqueue("calculate", 5000),
    work = f.app.services.runtime.drain();
  await f.driver.inspectEntered.promise;
  const cancelled = f.app.inject({
    method: "POST",
    url: `${f.path}/runs/${runId}/cancel`,
    headers: f.headers,
  });
  const cancelling = Promise.resolve(cancelled);
  for (let i = 0; i < 100; i++) {
    if (
      f.app.services.db.get<{ cancel_requested: number }>(
        "SELECT cancel_requested FROM runs WHERE id=?",
        runId,
      )?.cancel_requested
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  f.driver.inspectGate.release();
  assert.equal((await cancelling).statusCode, 200);
  await work;
  assert.equal((await f.view(runId)).status, "cancelled");
  assert.equal(f.driver.executions, 0);
  assert.equal(f.driver.containers.size, 0);
  assert.equal(
    f.app.services.db.all("SELECT id FROM sandbox_executions").length,
    0,
  );
});

test("active model revocation stops code and a managed run sandbox rejects standalone execution requests", async (t) => {
  const f = await setup(t),
    runId = await f.enqueue("hang", 5000),
    work = f.app.services.runtime.drain();
  await f.driver.entered.promise;
  const runtime = f.app.services.db.get<{ runtime_id: string }>(
    "SELECT runtime_id FROM run_sandboxes WHERE run_id=?",
    runId,
  )!.runtime_id;
  const independent = await f.app.inject({
    method: "POST",
    url: `${f.path}/runtimes/${runtime}/executions`,
    headers: f.headers,
    payload: { code: "unrelated" },
  });
  assert.equal(independent.statusCode, 403, independent.body);
  const revoke = await f.app.inject({
    method: "DELETE",
    url: `${f.path}/models/${f.model}`,
    headers: f.headers,
  });
  assert.equal(revoke.statusCode, 204, revoke.body);
  f.app.services.runtime.pump();
  await work;
  const run = await f.view(runId);
  assert.equal(run.status, "cancelled", JSON.stringify(run));
  assert.equal(run.error_code, "ACCESS_REVOKED");
  assert.equal(f.driver.containers.size, 0);
  assert.equal(f.driver.executions, 1);
});

test("unique tool calls have a durable per-run budget independent of the model turn limit", async (t) => {
  const f = await setup(t),
    runId = await f.enqueue("new");
  await f.app.services.runtime.drain();
  const run = await f.view(runId);
  assert.equal(run.status, "failed", JSON.stringify(run));
  assert.equal(run.error_code, "TOOL_CALL_LIMIT");
  assert.equal(f.driver.executions, 2);
  assert.equal(f.modelCalls(), 3);
  assert.equal(f.driver.containers.size, 0);
  assert.equal(
    f.app.services.db.all("SELECT call_id FROM run_tools WHERE run_id=?", runId)
      .length,
    2,
  );
});

test("a seated member can run an authorized code Agent without gaining management or another member's history", async (t) => {
  const f = await setup(t);
  const member = await f.app.inject({
    method: "POST",
    url: `${f.path}/members`,
    headers: f.headers,
    payload: {
      name: "Member",
      email: "member@example.test",
      password: "controlled-password-long",
      role: "member",
      seat: true,
    },
  });
  assert.equal(member.statusCode, 201, member.body);
  const headers = {
    authorization: `Bearer ${(await f.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "member@example.test", password: "controlled-password-long" } })).json().token}`,
  };
  const own = await f.app.inject({
    method: "POST",
    url: `${f.path}/runs`,
    headers,
    payload: { agentId: f.agentId, input: "calculate", timeoutMs: 1000 },
  });
  assert.equal(own.statusCode, 202, own.body);
  await f.app.services.runtime.drain();
  assert.equal((await f.view(own.json().id)).status, "succeeded");
  assert.equal(f.driver.containers.size, 0);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `${f.path}/runtimes`,
        headers,
        payload: { name: "Forbidden management" },
      })
    ).statusCode,
    403,
  );
  const ownerRun = await f.enqueue("calculate");
  await f.app.services.runtime.drain();
  assert.equal(
    (await f.app.inject({ url: `${f.path}/runs/${ownerRun}/tools`, headers }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await f.app.inject({
        url: `${f.path}/runs/${own.json().id}/tools`,
        headers,
      })
    ).statusCode,
    200,
  );
});

test("late sandbox allocation is bounded by the remaining parent deadline rather than a new full lifetime", async (t) => {
  const f = await setup(t),
    hold = gate();
  f.holdResponse(hold);
  const runId = await f.enqueue("calculate", 60000),
    work = f.app.services.runtime.drain();
  await f.requested.promise;
  const started = Date.now() - 55000,
    deadline = started + 60000;
  f.app.services.db.run(
    "UPDATE runs SET started_at=? WHERE id=?",
    started,
    runId,
  );
  hold.release();
  await work;
  assert.equal((await f.view(runId)).status, "succeeded");
  assert.equal(f.driver.creations.length, 1);
  assert.ok(f.driver.creations[0]!.expiresAt <= deadline);
});

test("an expired persistent parent budget cannot dispatch tools while its event-loop timer is still pending", async (t) => {
  const f = await setup(t),
    hold = gate();
  f.holdResponse(hold);
  const runId = await f.enqueue("calculate", 60000),
    work = f.app.services.runtime.drain();
  await f.requested.promise;
  f.app.services.db.run(
    "UPDATE runs SET started_at=? WHERE id=?",
    Date.now() - 61000,
    runId,
  );
  hold.release();
  await work;
  const run = await f.view(runId);
  assert.equal(run.status, "timed_out", JSON.stringify(run));
  assert.equal(run.error_code, "TIMEOUT");
  assert.equal(f.driver.creations.length, 0);
  assert.equal(f.driver.executions, 0);
  assert.equal(f.modelCalls(), 1);
});

test("the sandbox patrol propagates an exhausted parent deadline as timeout rather than revocation", async (t) => {
  const f = await setup(t),
    runId = await f.enqueue("hang", 60000),
    work = f.app.services.runtime.drain();
  await f.driver.entered.promise;
  f.app.services.db.run(
    "UPDATE runs SET started_at=? WHERE id=?",
    Date.now() - 60001,
    runId,
  );
  f.app.services.sandbox.pump();
  await work;
  const run = await f.view(runId);
  assert.equal(run.status, "timed_out", JSON.stringify(run));
  assert.equal(run.error_code, "TIMEOUT");
  const tool = f.app.services.db.get<{ status: string; error_code: string }>(
    "SELECT status,error_code FROM run_tools WHERE run_id=?",
    runId,
  )!;
  assert.equal(tool.status, "timed_out");
  assert.equal(tool.error_code, "TIMEOUT");
  assert.equal(f.driver.containers.size, 0);
});

test("runtime lifetime expiry during code is a deadline, not a user cancellation", async (t) => {
  const f = await setup(t),
    runId = await f.enqueue("hang", 5000),
    work = f.app.services.runtime.drain();
  await f.driver.entered.promise;
  const runtime = f.app.services.db.get<{ runtime_id: string }>(
    "SELECT runtime_id FROM run_sandboxes WHERE run_id=?",
    runId,
  )!.runtime_id;
  f.app.services.db.run(
    "UPDATE sandbox_runtimes SET expires_at=? WHERE id=?",
    Date.now() - 1,
    runtime,
  );
  f.app.services.sandbox.pump();
  await work;
  const run = await f.view(runId);
  assert.equal(run.status, "timed_out", JSON.stringify(run));
  assert.equal(run.error_code, "TIMEOUT");
  assert.equal(f.driver.containers.size, 0);
});
