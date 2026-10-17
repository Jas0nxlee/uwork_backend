import assert from "node:assert/strict";
import { test } from "node:test";
import { createUWorkBackendSession } from "../src/enterprise-identity/uworkBackendSession.js";
import type { EnterpriseIdentityAuthority } from "../src/enterprise-identity/identityServiceLifecycle.js";
import type { ISkillsService } from "../src/skills/skills.js";
import { withEnterpriseSkillBodyPolicy } from "../src/enterprise-assets/enterpriseSkillBodyPolicy.js";

function fixture() {
  const controller = new AbortController();
  let authority: EnterpriseIdentityAuthority = {
    generation: 1,
    revision: 1,
    signal: controller.signal,
    session: {
      token: "synthetic-private",
      issuerOrigin: "https://backend.example.test",
      expiresAt: Date.now() + 60000,
      profile: { id: "member", tenantId: "tenant", displayName: "Controlled", provider: "wecom" },
    },
  };
  let personal = false,
    dangerous = false,
    filesystem = true,
    managed = true,
    reads = 0,
    requests = 0;
  let duringRead: (() => void) | undefined;
  const raw: ISkillsService = {
    async list() {
      reads++;
      duringRead?.();
      return {
        skills: [
          {
            id: "controlled",
            name: "Controlled",
            description: "Controlled",
            body: "controlled-private-body",
            path: "/controlled/SKILL.md",
            scope: "user",
            enabled: true,
          },
        ],
        capability: { userScopeAvailable: true },
        diagnostics: [],
      };
    },
    async buildPromptContext(params) {
      reads++;
      duringRead?.();
      return {
        prompt: `${params.prompt}\ncontrolled-private-body`,
        activatedSkillNames: ["Controlled"],
      };
    },
    async setEnabled() {},
    async copyToCommon() {
      return { newPath: "/controlled/copied" };
    },
    async removeFromCommon() {},
    async deleteSkill() {},
  };
  const backendSession = createUWorkBackendSession({
    resolveConfig: async () => ({
      backend: managed ? "uwork" : "ucas",
      apiBaseUrl: "https://backend.example.test",
    }),
    readAuthority: () => authority,
    readPersistedSession: async () => ({
      revision: authority.revision,
      session: authority.session,
    }),
    fetchImpl: async (input) => {
      requests++;
      assert.equal(new URL(String(input)).pathname, "/api/client/authorize");
      return Response.json({
        allowed: true,
        tenantId: "tenant",
        personal: { skills: personal },
        security: {
          allowFilesystem: filesystem,
          allowShell: false,
          allowNetwork: false,
          dangerousSkills: dangerous,
          allowedDomains: [],
        },
      });
    },
  });
  return {
    service: withEnterpriseSkillBodyPolicy(raw, backendSession),
    reads: () => reads,
    requests: () => requests,
    allow: () => {
      personal = true;
      dangerous = true;
    },
    deny: () => {
      personal = false;
      dangerous = false;
    },
    filesystem: () => {
      filesystem = false;
    },
    unmanaged: () => {
      managed = false;
    },
    duringRead: (value: () => void) => {
      duringRead = value;
    },
    logout: () => {
      controller.abort();
      authority = { ...authority, generation: 2, revision: 2, session: null };
    },
  };
}

test("legacy Host list and prompt body outlets cannot bypass current personal skill policy", async () => {
  const f = fixture();
  await assert.rejects(
    () => f.service.list({ workspacePath: "/controlled" }),
    /enterprise_personal_skills_denied/,
  );
  await assert.rejects(
    () => f.service.buildPromptContext({ workspacePath: "/controlled", prompt: "/Controlled" }),
    /enterprise_personal_skills_denied/,
  );
  assert.equal(f.reads(), 0);
  f.allow();
  assert.equal(
    (await f.service.list({ workspacePath: "/controlled" })).skills[0]!.body,
    "controlled-private-body",
  );
  assert.match(
    (await f.service.buildPromptContext({ workspacePath: "/controlled", prompt: "/Controlled" }))
      .prompt,
    /controlled-private-body/,
  );
});

test("logout and policy revocation after a legacy read discard both body-bearing results", async () => {
  for (const mode of ["logout", "policy", "filesystem"] as const)
    for (const prompt of [false, true]) {
      const f = fixture();
      f.allow();
      f.duringRead(mode === "logout" ? f.logout : mode === "filesystem" ? f.filesystem : f.deny);
      await assert.rejects(
        () =>
          prompt
            ? f.service.buildPromptContext({ workspacePath: "/controlled", prompt: "/Controlled" })
            : f.service.list({ workspacePath: "/controlled" }),
        (error: unknown) =>
          error instanceof Error &&
          /^enterprise_/.test(error.message) &&
          !error.message.includes("controlled-private-body"),
      );
      assert.equal(f.reads(), 1);
    }
});

test("unmanaged legacy Host outlets retain their original result without enterprise HTTP", async () => {
  const f = fixture();
  f.unmanaged();
  assert.equal((await f.service.list({ workspacePath: "/controlled" })).skills.length, 1);
  assert.match(
    (await f.service.buildPromptContext({ workspacePath: "/controlled", prompt: "/Controlled" }))
      .prompt,
    /controlled-private-body/,
  );
  assert.equal(f.requests(), 0);
});

test("unmanaged errors retain legacy semantics while managed read failures remain sanitized", async () => {
  for (const managed of [false, true]) {
    const f = fixture(),
      failure = new Error("controlled-private-body");
    f.allow();
    if (!managed) f.unmanaged();
    f.duringRead(() => {
      throw failure;
    });
    await assert.rejects(
      () => f.service.list({ workspacePath: "/controlled" }),
      (error: unknown) =>
        managed
          ? error instanceof Error && error.message === "enterprise_skill_read_failed"
          : error === failure,
    );
  }
});
