import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { eventually, liveFixture } from "./client-native-session-fixture.js";
import {
  bounded,
  catalogQueueFixture,
} from "./client-assets-catalog-queue-fixture.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UWorkBackendSession } from "../clients/uwork/packages/services/src/enterprise-identity/backendSessionContract.js";

type Row = Record<string, unknown>;
const label =
  process.env.UWORK_GATEWAY_EVIDENCE_RUN === "red" ? "red" : "green";
const evidenceDirectory = `evidence/client-assets-catalog-queue-20261017/${label}`;
const marker = "SAME_HOST_APPROVED_EXPERT_BODY";
const expertName = "SameHostCatalogExpert";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

test(
  "production maintenance and actual packaged CLI first catalog share one Host transaction FIFO",
  { timeout: 45000 },
  async (t) => {
    const entered = deferred(),
      release = deferred(),
      warmed = deferred();
    const outcomes: { status: string; code?: string }[] = [];
    const bodies: Row[] = [];
    let manifestResponses = 0;
    let maintenanceTrace: string | undefined;
    t.after(() => release.resolve());
    const f = await liveFixture(t, "same-host-expert-first-load", true, {
      evidenceDirectory,
      assetMaintenance: true,
      observeAssetCatalog(catalog) {
        outcomes.push({
          status: catalog.status,
          ...(catalog.code ? { code: catalog.code } : {}),
        });
        warmed.resolve();
      },
      async beforeAssetManifestResponse(traceId) {
        const index = ++manifestResponses;
        if (index === 1) {
          maintenanceTrace = traceId;
          entered.resolve();
          await release.promise;
        }
        // Old concurrent readers retain R while production maintenance commits R2.
        // FIFO readers reach this unchanged HTTP response only after maintenance finished.
        if (traceId !== maintenanceTrace) await warmed.promise;
      },
      reply(body) {
        bodies.push(structuredClone(body));
        if (!body.stream) return { text: "Owned catalog title" };
        const messages = (body.messages ?? []) as Row[];
        if (
          messages.some(
            (message) =>
              message.role === "user" &&
              JSON.stringify(message.content).includes("SAME_HOST_CHILD_TASK"),
          )
        )
          return { text: "SAME_HOST_CHILD_COMPLETE" };
        if (messages.some((message) => message.role === "tool"))
          return { text: "SAME_HOST_PARENT_COMPLETE" };
        return {
          toolCall: {
            id: "owned-catalog-agent",
            name: "Agent",
            arguments: JSON.stringify({
              description: "Owned same Host catalog",
              prompt: "SAME_HOST_CHILD_TASK: finish the owned child",
              subagent_type: expertName,
            }),
          },
        };
      },
    });
    const current = await f.api<Row>(
      `${f.p}/configurations/security`,
      "GET",
      undefined,
      f.login.token,
    );
    const saved = await f.api<Row>(
      `${f.p}/configurations/security`,
      "PUT",
      {
        revision: current.revision,
        data: { ...(current.published as Row), allowFilesystem: true },
      },
      f.login.token,
    );
    await f.api(
      `${f.p}/configurations/security/publish`,
      "POST",
      { revision: saved.revision },
      f.login.token,
    );
    const asset = await f.api<{ id: string }>(
      `${f.p}/assets`,
      "POST",
      {
        name: expertName,
        kind: "expert",
        scope: { all: true },
        content: { instructions: marker, profession: "Owned catalog test" },
      },
      f.login.token,
      201,
    );
    for (const operation of ["review", "publish"])
      await f.api(
        `${f.p}/assets/${asset.id}/${operation}`,
        "POST",
        { version: 1, ...(operation === "review" ? { approved: true } : {}) },
        f.login.token,
      );
    assert((await f.gateway().sync("login")).committed);
    const starting = f.packaged(true);
    void starting.catch(() => {});
    await entered.promise;
    await eventually(
      () => Promise.resolve(f.privateFrames as { method: string }[]),
      (frames) =>
        frames.some(
          (frame) => frame.method === "interaction/readEnterpriseSkills",
        ),
    );
    // A bounded held-response observation window; no production timeout or retry is altered.
    await delay(150);
    release.resolve();
    const cli = await starting;
    assert.equal(
      (await cli.send("SAME_HOST_EXPERT_TRIGGER")).status,
      "accepted",
    );
    await eventually(
      () => Promise.resolve(cli.notifications),
      (rows) =>
        rows.some(
          (row) =>
            row.method === "v4/telemetry/event" &&
            row.params.kind === "turn.terminal" &&
            row.params.sessionId === cli.sessionId &&
            typeof row.params.sourceCommandId === "string" &&
            row.params.status === "success",
        ),
      20000,
    );
    await eventually(
      () =>
        f.api<{ items: { status: string }[] }>(
          `${f.p}/usage`,
          "GET",
          undefined,
          f.login.token,
        ),
      (value) =>
        value.items.length === 4 &&
        value.items.every((row) => row.status === "settled"),
    );
    const childBodies = bodies.filter((body) =>
      JSON.stringify(
        (body.messages as Row[]).filter((message) => message.role === "system"),
      ).includes(marker),
    );
    assert.equal(
      childBodies.length,
      1,
      `actual child missing; real catalog outcomes: ${JSON.stringify(outcomes)}`,
    );
    assert(outcomes.length >= 2);
    assert(
      outcomes.every((outcome) => outcome.status === "ready"),
      JSON.stringify(outcomes),
    );
    f.check(
      "actual-maintenance-and-packaged-runtime-serialized-private-catalog-approved-child",
    );
  },
);

test(
  "queued cancellation is bounded and cannot overtake an active transaction or block a successor",
  { timeout: 15000 },
  async (t) => {
    const f = await catalogQueueFixture(t, "queued-cancel");
    const gate = f.gate("active");
    const active = f.host.readCatalog("active");
    await gate.entered.promise;
    const controller = new AbortController();
    const queued = f.host.readCatalog("cancelled", controller.signal);
    const next = f.host.readCatalog("successor");
    await f.waitCaptured("cancelled");
    await f.waitCaptured("successor");
    controller.abort();
    assert.equal((await bounded(queued)).status, "denied");
    assert.equal(
      f.requests.filter((row) =>
        ["cancelled", "successor"].includes(row.traceId),
      ).length,
      0,
    );
    gate.release.resolve();
    assert.equal((await active).status, "ready");
    assert.equal((await next).status, "ready");
    assert.equal(
      f.events.filter((event) => event.traceId === "cancelled").length,
      0,
    );
    assert.equal((await f.host.readCatalog("after-cancel")).status, "ready");
  },
);

test(
  "queued original identity is denied on logout and a new owner can read after release",
  { timeout: 15000 },
  async (t) => {
    const f = await catalogQueueFixture(t, "queued-owner-change");
    const gate = f.gate("active");
    const active = f.host.readCatalog("active");
    await gate.entered.promise;
    const queued = f.host.readCatalog("old-owner");
    await f.waitCaptured("old-owner");
    await f.identity.logout();
    const result = await bounded(queued);
    assert.equal(result.status, "denied");
    assert.equal(
      f.requests.filter((row) => row.traceId === "old-owner").length,
      0,
    );
    gate.release.resolve();
    assert.equal((await active).status, "denied");
    await f.login();
    assert.equal((await f.host.readCatalog("new-owner")).status, "ready");
    assert.equal(
      f.events.filter((event) => event.traceId === "old-owner").length,
      0,
    );
  },
);

test(
  "queued original configuration is revalidated before any asset or HTTP IO",
  { timeout: 15000 },
  async (t) => {
    const f = await catalogQueueFixture(t, "queued-configuration-change");
    const gate = f.gate("active");
    const active = f.host.readCatalog("active");
    await gate.entered.promise;
    const queued = f.host.readCatalog("old-configuration");
    await f.waitCaptured("old-configuration");
    f.replaceConfiguration();
    gate.release.resolve();
    assert.equal((await active).status, "denied");
    const result = await queued;
    assert.deepEqual(result, {
      status: "denied",
      code: "enterprise_configuration_changed",
    });
    assert.equal(
      f.requests.filter((row) => row.traceId === "old-configuration").length,
      0,
    );
    assert.equal(
      f.events.filter((event) => event.traceId === "old-configuration").length,
      0,
    );
    assert.equal(
      (await f.host.readCatalog("new-configuration")).status,
      "ready",
    );
  },
);

test(
  "dispose retires active and queued work even when the actual HTTP transport ignores abort",
  { timeout: 15000 },
  async (t) => {
    const f = await catalogQueueFixture(t, "queued-dispose", {
      uncooperativeTransport: true,
    });
    const gate = f.gate("active");
    const active = f.host.readCatalog("active");
    await gate.entered.promise;
    const queued = f.host.readCatalog("disposed-waiter");
    await f.waitCaptured("disposed-waiter");
    await bounded(f.host.disposeAllAndWait());
    assert.equal((await active).status, "denied");
    assert.equal((await queued).status, "denied");
    assert.equal(
      f.requests.filter((row) => row.traceId === "disposed-waiter").length,
      0,
    );
    assert.equal(
      f.events.filter((event) => event.traceId === "disposed-waiter").length,
      0,
    );
    const eventsBefore = f.events.length;
    gate.release.resolve();
    assert.equal((await f.host.readCatalog("after-dispose")).status, "denied");
    assert.equal(f.events.length, eventsBefore);
    assert.equal(
      (await f.createHost().readCatalog("replacement-host")).status,
      "ready",
    );
  },
);

test(
  "two actual private profile stores do not share one Host FIFO head",
  { timeout: 15000 },
  async (t) => {
    const first = await catalogQueueFixture(t, "parallel-profile-one");
    const second = await catalogQueueFixture(t, "parallel-profile-two");
    // Only route the original production scopes; no response, decision or error is substituted.
    const routed: UWorkBackendSession = {
      run(operation, context) {
        return (
          context?.traceId === "profile-one" ? first.backend : second.backend
        ).run(operation, context);
      },
    };
    const host = first.createHost(routed);
    const gate = first.gate("profile-one");
    const held = host.readCatalog("profile-one");
    await gate.entered.promise;
    const independent = await bounded(host.readCatalog("profile-two"));
    assert.equal(independent.status, "ready");
    gate.release.resolve();
    assert.equal((await held).status, "ready");
  },
);

test(
  "an independent newer Host still wins the disk CAS and the stale Host cannot prune it",
  { timeout: 15000 },
  async (t) => {
    const f = await catalogQueueFixture(t, "cross-host-CAS");
    const gate = f.gate("stale-host");
    const stale = f.host.readCatalog("stale-host");
    await gate.entered.promise;
    const winner = await f.createHost().readCatalog("newer-host");
    assert.equal(winner.status, "ready");
    gate.release.resolve();
    assert.deepEqual(await stale, {
      status: "denied",
      code: "enterprise_asset_selection_changed",
    });
    assert(winner.status === "ready");
    assert.equal(winner.experts.length, 1);
    assert.match(
      await readFile(join(winner.experts[0]!.directory, "expert.json"), "utf8"),
      /CATALOG_FIFO_EXPERT_V1/,
    );
  },
);

test(
  "a version change denies the old transaction and releases the next fresh catalog",
  { timeout: 15000 },
  async (t) => {
    const f = await catalogQueueFixture(t, "queued-version-change");
    const gate = f.gate("old-version");
    const stale = f.host.readCatalog("old-version");
    await gate.entered.promise;
    const next = f.host.readCatalog("next-version");
    await f.waitCaptured("next-version");
    await f.publishVersionTwo();
    gate.release.resolve();
    assert.deepEqual(await stale, {
      status: "denied",
      code: "enterprise_assets_changed",
    });
    const current = await next;
    assert(current.status === "ready");
    assert.equal(current.experts[0]!.asset.version, 2);
  },
);

test(
  "corrupt bytes remain denied for every queued catalog without download repair",
  { timeout: 15000 },
  async (t) => {
    const f = await catalogQueueFixture(t, "queued-corruption");
    const initial = await f.host.readCatalog("initial");
    assert(initial.status === "ready");
    const file = join(initial.experts[0]!.directory, "expert.json");
    await writeFile(file, "owned-corruption");
    const before = f.requests.filter((row) =>
      row.pathname.endsWith("/download"),
    ).length;
    const values = await Promise.all([
      f.host.readCatalog("corrupt-one"),
      f.host.readCatalog("corrupt-two"),
    ]);
    assert(values.every((value) => value.status === "denied"));
    assert.equal(
      f.requests.filter((row) => row.pathname.endsWith("/download")).length,
      before,
    );
    assert.equal(await readFile(file, "utf8"), "owned-corruption");
  },
);
