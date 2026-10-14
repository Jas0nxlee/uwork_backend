import type { Db } from "../db.js";
import type { Vault } from "../vault.js";
import {
  ApiError,
  fail,
  id,
  now,
  parseJson,
  secret,
  type Actor,
  type Scope,
} from "../core.js";
import { currentActor, inScope, requirePermission } from "../access.js";
import { assertChannel, effectiveSecurity } from "../policy.js";
import { audit } from "../events.js";
import type {
  SandboxDriver,
  SandboxOwner,
  SandboxRuntimeRow,
  SandboxExecutionRow,
  SandboxRuntimeView,
} from "./contract.js";

export class SandboxService {
  private active = new Map<
    string,
    {
      runtimeId: string;
      controller: AbortController;
      promise: Promise<void>;
      row: SandboxExecutionRow;
    }
  >();
  private provisions = new Map<string, Promise<unknown>>();
  private lifecycle = new Map<string, Promise<unknown>>();
  private reaper: Promise<void> | undefined;
  private stopped = false;
  failure: string | null = null;
  constructor(
    private db: Db,
    private vault: Vault,
    private driver: SandboxDriver | undefined,
    private admit: (actor: Actor) => void,
  ) {}
  private async serialize<T>(
    runtimeId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.lifecycle.get(runtimeId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(operation);
    this.lifecycle.set(runtimeId, task);
    try {
      return await task;
    } finally {
      if (this.lifecycle.get(runtimeId) === task)
        this.lifecycle.delete(runtimeId);
    }
  }
  private owner(row: SandboxRuntimeRow): SandboxOwner {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      ownerToken: row.owner_token,
      expiresAt: row.expires_at,
    };
  }
  private row(tenantId: string, runtimeId: string) {
    const row = this.db.get<SandboxRuntimeRow>(
      "SELECT * FROM sandbox_runtimes WHERE tenant_id=? AND id=?",
      tenantId,
      runtimeId,
    );
    if (!row || row.status === "deleted")
      fail(404, "NOT_FOUND", "Runtime 不存在");
    return row;
  }
  private output(row: SandboxRuntimeRow): SandboxRuntimeView {
    return {
      id: row.id,
      name: row.name,
      scope: parseJson<Scope>(row.scope),
      status: row.status,
      containerId: row.container_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      errorCode: row.error_code,
      revision: row.revision,
    };
  }
  private authorize(actor: Actor, row: SandboxRuntimeRow) {
    this.admit(actor);
    assertChannel(this.db, actor, "agents");
    if (!effectiveSecurity(this.db, actor).allowSandbox)
      fail(403, "SANDBOX_DENIED", "企业未允许隔离代码执行");
    if (!inScope(this.db, parseJson<Scope>(row.scope), actor))
      fail(403, "SANDBOX_DENIED", "Runtime 未授权给当前成员");
  }
  private available() {
    if (!this.driver)
      fail(503, "SANDBOX_NOT_CONFIGURED", "尚未配置专用 Docker 沙箱");
    return this.driver;
  }
  async health() {
    return this.driver
      ? this.driver.health()
      : { available: false, image: "not-configured" };
  }
  async recover() {
    const interrupted = this.db.all<{ runtime_id: string }>(
      "SELECT DISTINCT runtime_id FROM sandbox_executions WHERE status='running'",
    );
    this.db.run(
      "UPDATE sandbox_executions SET status='failed',error_code='PROCESS_RESTARTED',finished_at=? WHERE status='running'",
      now(),
    );
    if (!this.driver) return;
    for (const row of this.db.all<SandboxRuntimeRow>(
      "SELECT * FROM sandbox_runtimes WHERE status NOT IN ('stopped','deleted')",
    )) {
      try {
        if (
          ["busy", "failed", "stopping"].includes(row.status) ||
          interrupted.some((r) => r.runtime_id === row.id)
        )
          await this.driver.stop(this.owner(row));
        const observed = await this.driver.inspect(this.owner(row));
        this.db.run(
          "UPDATE sandbox_runtimes SET status=?,container_id=?,error_code=?,updated_at=? WHERE id=?",
          observed?.running ? "ready" : observed ? "stopped" : "failed",
          observed?.containerId ?? row.container_id,
          observed ? null : "SANDBOX_MISSING",
          now(),
          row.id,
        );
      } catch {
        this.db.run(
          "UPDATE sandbox_runtimes SET status='failed',error_code='RECOVERY_UNCONFIRMED',updated_at=? WHERE id=?",
          now(),
          row.id,
        );
      }
    }
  }
  async create(actor: Actor, name: string, scope: Scope, ttlMinutes: number) {
    requirePermission(actor, "write");
    this.admit(actor);
    const driver = this.available();
    if (this.stopped) fail(503, "SHUTTING_DOWN", "服务正在关闭");
    const runtimeId = id();
    const timestamp = now();
    this.db.transaction(() => {
      const count = this.db.get<{ tenant: number; total: number }>(
        "SELECT coalesce(sum(CASE WHEN tenant_id=? THEN 1 ELSE 0 END),0) tenant,count(*) total FROM sandbox_runtimes WHERE status NOT IN ('stopped','deleted')",
        actor.tenantId,
      )!;
      if (count.tenant >= 4 || count.total >= 16)
        fail(429, "SANDBOX_CAPACITY", "沙箱资源已达上限");
      this.db.run(
        "INSERT INTO sandbox_runtimes(id,tenant_id,user_id,name,scope,owner_token,status,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        runtimeId,
        actor.tenantId,
        actor.userId,
        name,
        JSON.stringify(scope),
        secret(),
        "provisioning",
        timestamp,
        timestamp + ttlMinutes * 60000,
        timestamp,
      );
      audit(this.db, actor, "sandbox.create", runtimeId);
    });
    const work = (async () => {
      const row = this.row(actor.tenantId, runtimeId);
      try {
        const observation = await driver.create(this.owner(row));
        const accepted = this.db.run(
          "UPDATE sandbox_runtimes SET status='ready',container_id=?,updated_at=? WHERE id=? AND status='provisioning'",
          observation.containerId,
          now(),
          runtimeId,
        );
        if (!accepted.changes) {
          await driver.remove(this.owner(row));
          this.db.run(
            "UPDATE sandbox_runtimes SET status='stopped',container_id=NULL,updated_at=? WHERE id=? AND status='stopping'",
            now(),
            runtimeId,
          );
          fail(409, "PROVISION_CANCELLED", "Runtime 创建已取消");
        }
        return this.output(this.row(actor.tenantId, runtimeId));
      } catch (error) {
        this.db.run(
          "UPDATE sandbox_runtimes SET status='failed',error_code=?,updated_at=? WHERE id=? AND status='provisioning'",
          error instanceof ApiError ? error.code : "SANDBOX_START_FAILED",
          now(),
          runtimeId,
        );
        throw error;
      }
    })();
    this.provisions.set(runtimeId, work);
    try {
      return await work;
    } finally {
      this.provisions.delete(runtimeId);
    }
  }
  list(
    actor: Actor,
    page: number,
    pageSize: number,
    q: string,
    status?: string,
  ) {
    requirePermission(actor, "read");
    const args = [actor.tenantId, `%${q}%`, ...(status ? [status] : [])];
    const where = `tenant_id=? AND name LIKE ? AND status<>'deleted'${status ? " AND status=?" : ""}`;
    return {
      items: this.db
        .all<SandboxRuntimeRow>(
          `SELECT * FROM sandbox_runtimes WHERE ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
          ...args,
          pageSize,
          (page - 1) * pageSize,
        )
        .map((r) => this.output(r)),
      total: this.db.get<{ n: number }>(
        `SELECT count(*) n FROM sandbox_runtimes WHERE ${where}`,
        ...args,
      )!.n,
      page,
      pageSize,
    };
  }
  async update(
    actor: Actor,
    runtimeId: string,
    name: string,
    scope: Scope,
    revision: number,
  ) {
    requirePermission(actor, "write");
    this.row(actor.tenantId, runtimeId);
    if (
      !this.db.run(
        "UPDATE sandbox_runtimes SET name=?,scope=?,revision=revision+1,updated_at=? WHERE tenant_id=? AND id=? AND revision=?",
        name,
        JSON.stringify(scope),
        now(),
        actor.tenantId,
        runtimeId,
        revision,
      ).changes
    )
      fail(409, "REVISION_CONFLICT", "Runtime 已被修改");
    const running = [...this.active.values()].filter(
      (a) => a.runtimeId === runtimeId,
    );
    for (const item of running) {
      try {
        this.authorize(
          currentActor(this.db, item.row.tenant_id, item.row.user_id),
          this.row(actor.tenantId, runtimeId),
        );
      } catch {
        item.controller.abort("revoked");
      }
    }
    await Promise.all(
      running.filter((a) => a.controller.signal.aborted).map((a) => a.promise),
    );
    audit(this.db, actor, "sandbox.scope.update", runtimeId, {
      revision: revision + 1,
    });
    return this.output(this.row(actor.tenantId, runtimeId));
  }
  async view(actor: Actor, runtimeId: string) {
    const row = this.row(actor.tenantId, runtimeId);
    requirePermission(actor, "read");
    if (
      this.driver &&
      !["provisioning", "stopping", "stopped"].includes(row.status)
    ) {
      const observed = await this.driver.inspect(this.owner(row));
      if (!observed?.running && row.status !== "failed") {
        this.db.run(
          "UPDATE sandbox_runtimes SET status=?,error_code=?,updated_at=? WHERE id=? AND status=?",
          observed ? "stopped" : "failed",
          observed ? null : "SANDBOX_MISSING",
          now(),
          row.id,
          row.status,
        );
      }
    }
    return this.output(this.row(actor.tenantId, runtimeId));
  }
  async enqueue(
    actor: Actor,
    runtimeId: string,
    code: string,
    timeoutMs: number,
  ) {
    this.available();
    if (this.stopped) fail(503, "SHUTTING_DOWN", "服务正在关闭");
    const row = this.row(actor.tenantId, runtimeId);
    this.authorize(actor, row);
    if (!(await this.driver!.inspect(this.owner(row)))?.running)
      fail(409, "SANDBOX_STOPPED", "沙箱未运行");
    return this.db.transaction(() => {
      const latest = this.row(actor.tenantId, runtimeId);
      this.authorize(
        currentActor(this.db, actor.tenantId, actor.userId),
        latest,
      );
      if (latest.status !== "ready" || latest.expires_at - now() < 100)
        fail(409, "SANDBOX_NOT_READY", "Runtime 未就绪或已到期");
      if (
        this.db.get(
          "SELECT id FROM sandbox_executions WHERE runtime_id=? AND status IN ('queued','running')",
          runtimeId,
        )
      )
        fail(409, "SANDBOX_BUSY", "Runtime 已有执行任务");
      const executionId = id();
      this.db.run(
        "INSERT INTO sandbox_executions(id,tenant_id,runtime_id,user_id,status,code,timeout_ms,created_at) VALUES(?,?,?,?,?,?,?,?)",
        executionId,
        actor.tenantId,
        runtimeId,
        actor.userId,
        "queued",
        this.vault.seal(code, `${actor.tenantId}:${executionId}:sandbox-code`),
        Math.min(timeoutMs, latest.expires_at - now()),
        now(),
      );
      audit(this.db, actor, "sandbox.enqueue", executionId);
      return executionId;
    });
  }
  private execution(actor: Actor, executionId: string) {
    const row = this.db.get<SandboxExecutionRow>(
      "SELECT * FROM sandbox_executions WHERE tenant_id=? AND id=?",
      actor.tenantId,
      executionId,
    );
    if (!row) fail(404, "NOT_FOUND", "执行任务不存在");
    if (row.user_id !== actor.userId) requirePermission(actor, "read");
    else requirePermission(actor, "execute");
    return row;
  }
  getExecution(actor: Actor, executionId: string) {
    const row = this.execution(actor, executionId);
    return {
      ...row,
      code: this.vault.open(
        row.code,
        `${row.tenant_id}:${row.id}:sandbox-code`,
      ),
      stdout: row.stdout
        ? this.vault.open(
            row.stdout,
            `${row.tenant_id}:${row.id}:sandbox-stdout`,
          )
        : null,
      stderr: row.stderr
        ? this.vault.open(
            row.stderr,
            `${row.tenant_id}:${row.id}:sandbox-stderr`,
          )
        : null,
    };
  }
  executions(
    actor: Actor,
    page: number,
    pageSize: number,
    runtimeId?: string,
    status?: string,
  ) {
    requirePermission(actor, "read");
    const args = [
      actor.tenantId,
      ...(runtimeId ? [runtimeId] : []),
      ...(status ? [status] : []),
    ];
    const where = `tenant_id=?${runtimeId ? " AND runtime_id=?" : ""}${status ? " AND status=?" : ""}`;
    return {
      items: this.db.all(
        `SELECT id,runtime_id,user_id,status,exit_code,error_code,timeout_ms,created_at,started_at,finished_at FROM sandbox_executions WHERE ${where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?`,
        ...args,
        pageSize,
        (page - 1) * pageSize,
      ),
      total: this.db.get<{ n: number }>(
        `SELECT count(*) n FROM sandbox_executions WHERE ${where}`,
        ...args,
      )!.n,
      page,
      pageSize,
    };
  }
  async cancel(actor: Actor, executionId: string) {
    const row = this.execution(actor, executionId);
    if (row.user_id !== actor.userId) requirePermission(actor, "write");
    if (row.status === "queued") {
      this.db.run(
        "UPDATE sandbox_executions SET status='cancelled',error_code='CANCELLED',finished_at=? WHERE id=? AND status='queued'",
        now(),
        row.id,
      );
    } else if (row.status === "running") {
      const active = this.active.get(row.id);
      if (!active) fail(409, "SANDBOX_RECOVERING", "执行任务正在恢复");
      active.controller.abort("cancelled");
      await active.promise;
    }
    audit(this.db, actor, "sandbox.cancel", executionId);
    return this.getExecution(actor, executionId);
  }
  async stopRuntime(actor: Actor, runtimeId: string, remove = false) {
    requirePermission(actor, "write");
    this.row(actor.tenantId, runtimeId);
    this.db.run(
      "UPDATE sandbox_runtimes SET status='stopping',updated_at=? WHERE tenant_id=? AND id=? AND status='provisioning'",
      now(),
      actor.tenantId,
      runtimeId,
    );
    return this.serialize(runtimeId, async () => {
      await this.provisions.get(runtimeId)?.catch(() => undefined);
      const row = this.row(actor.tenantId, runtimeId);
      const driver = this.available();
      this.db.run(
        "UPDATE sandbox_runtimes SET status='stopping',updated_at=? WHERE id=?",
        now(),
        row.id,
      );
      this.db.run(
        "UPDATE sandbox_executions SET status='cancelled',error_code='RUNTIME_STOPPED',finished_at=? WHERE runtime_id=? AND status='queued'",
        now(),
        row.id,
      );
      const work = [...this.active.values()].filter(
        (r) => r.runtimeId === row.id,
      );
      for (const item of work) item.controller.abort("runtime-stopped");
      try {
        await driver.stop(this.owner(row));
        await Promise.all(work.map((w) => w.promise));
        if (remove) await driver.remove(this.owner(row));
        this.db.run(
          "UPDATE sandbox_runtimes SET status=?,error_code=NULL,updated_at=? WHERE id=?",
          remove ? "deleted" : "stopped",
          now(),
          row.id,
        );
        audit(
          this.db,
          actor,
          remove ? "sandbox.delete" : "sandbox.stop",
          row.id,
        );
      } catch (error) {
        this.db.run(
          "UPDATE sandbox_runtimes SET status='failed',error_code='STOP_UNCONFIRMED',updated_at=? WHERE id=?",
          now(),
          row.id,
        );
        throw error;
      }
    });
  }
  pump() {
    if (this.stopped) return;
    for (const active of this.active.values()) {
      try {
        this.authorize(
          currentActor(this.db, active.row.tenant_id, active.row.user_id),
          this.row(active.row.tenant_id, active.runtimeId),
        );
      } catch {
        active.controller.abort("revoked");
      }
    }
    for (const row of this.db.all<SandboxExecutionRow>(
      "SELECT * FROM sandbox_executions WHERE status='queued' ORDER BY created_at,id LIMIT 100",
    )) {
      if (this.active.size >= 4) break;
      if (
        !this.db.transaction(() => {
          if (
            !this.db.run(
              "UPDATE sandbox_executions SET status='running',started_at=? WHERE id=? AND status='queued'",
              now(),
              row.id,
            ).changes
          )
            return false;
          this.db.run(
            "UPDATE sandbox_runtimes SET status='busy',updated_at=? WHERE id=? AND status='ready'",
            now(),
            row.runtime_id,
          );
          return true;
        })
      )
        continue;
      const controller = new AbortController();
      const promise = this.run(row, controller)
        .catch(() => {
          this.failure = "SANDBOX_STORAGE_FAILURE";
        })
        .finally(() => {
          this.active.delete(row.id);
        });
      this.active.set(row.id, {
        runtimeId: row.runtime_id,
        controller,
        promise,
        row,
      });
    }
    if (!this.reaper)
      this.reaper = this.reap()
        .catch(() => {
          this.failure = "SANDBOX_REAPER_FAILURE";
        })
        .finally(() => {
          this.reaper = undefined;
        });
  }
  async drain() {
    while (!this.stopped) {
      this.pump();
      if (!this.active.size) break;
      await Promise.all([...this.active.values()].map((w) => w.promise));
    }
    await this.reaper;
  }
  async stop() {
    this.stopped = true;
    for (const item of this.active.values()) item.controller.abort("shutdown");
    await Promise.all([...this.active.values()].map((w) => w.promise));
    await Promise.allSettled(this.provisions.values());
    await Promise.allSettled(this.lifecycle.values());
    await this.reaper;
  }
  purgeFinished(tenantId: string, before: number) {
    return Number(
      this.db.run(
        "DELETE FROM sandbox_executions WHERE tenant_id=? AND finished_at<? AND status NOT IN ('queued','running')",
        tenantId,
        before,
      ).changes,
    );
  }
  private async reap() {
    const driver = this.driver;
    if (!driver) return;
    for (const row of this.db.all<SandboxRuntimeRow>(
      "SELECT * FROM sandbox_runtimes WHERE expires_at<=? AND status<>'deleted' AND (status<>'stopped' OR container_id IS NOT NULL)",
      now(),
    )) {
      if ([...this.active.values()].some((a) => a.runtimeId === row.id))
        continue;
      await this.serialize(row.id, async () => {
        await this.provisions.get(row.id)?.catch(() => undefined);
        const latest = this.db.get<SandboxRuntimeRow>(
          "SELECT * FROM sandbox_runtimes WHERE id=?",
          row.id,
        );
        if (
          !latest ||
          latest.status === "deleted" ||
          [...this.active.values()].some((a) => a.runtimeId === row.id)
        )
          return;
        try {
          await driver.remove(this.owner(row));
          this.db.run(
            "UPDATE sandbox_runtimes SET status='stopped',container_id=NULL,error_code='RUNTIME_EXPIRED',updated_at=? WHERE id=?",
            now(),
            row.id,
          );
        } catch {
          this.db.run(
            "UPDATE sandbox_runtimes SET status='failed',error_code='STOP_UNCONFIRMED',updated_at=? WHERE id=?",
            now(),
            row.id,
          );
        }
      });
    }
  }
  private async run(job: SandboxExecutionRow, controller: AbortController) {
    const timer = setTimeout(() => controller.abort("timeout"), job.timeout_ms);
    let runtime: SandboxRuntimeRow | undefined;
    try {
      runtime = this.row(job.tenant_id, job.runtime_id);
      this.authorize(
        currentActor(this.db, job.tenant_id, job.user_id),
        runtime,
      );
      if (runtime.expires_at <= now())
        fail(409, "RUNTIME_EXPIRED", "Runtime 已到期");
      const output = await this.available().execute(
        this.owner(runtime),
        this.vault.open(job.code, `${job.tenant_id}:${job.id}:sandbox-code`),
        controller.signal,
      );
      controller.signal.throwIfAborted();
      this.db.run(
        "UPDATE sandbox_executions SET status=?,stdout=?,stderr=?,exit_code=?,finished_at=? WHERE id=? AND status='running'",
        output.exitCode === 0 ? "succeeded" : "failed",
        this.vault.seal(
          output.stdout,
          `${job.tenant_id}:${job.id}:sandbox-stdout`,
        ),
        this.vault.seal(
          output.stderr,
          `${job.tenant_id}:${job.id}:sandbox-stderr`,
        ),
        output.exitCode,
        now(),
        job.id,
      );
    } catch (error) {
      let stopped = true;
      if (controller.signal.aborted && runtime) {
        try {
          await this.available().stop(this.owner(runtime));
        } catch {
          stopped = false;
        }
      }
      const reason = controller.signal.reason;
      const status =
        stopped && controller.signal.aborted
          ? reason === "timeout"
            ? "timed_out"
            : "cancelled"
          : "failed";
      const code = !stopped
        ? "STOP_UNCONFIRMED"
        : controller.signal.aborted
          ? reason === "revoked"
            ? "ACCESS_REVOKED"
            : reason === "timeout"
              ? "TIMEOUT"
              : "CANCELLED"
          : error instanceof ApiError
            ? error.code
            : "SANDBOX_EXECUTION_FAILED";
      this.db.run(
        "UPDATE sandbox_executions SET status=?,error_code=?,finished_at=? WHERE id=? AND status='running'",
        status,
        code,
        now(),
        job.id,
      );
    } finally {
      clearTimeout(timer);
      if (runtime) {
        try {
          const observed = await this.available().inspect(this.owner(runtime));
          this.db.run(
            "UPDATE sandbox_runtimes SET status=?,updated_at=? WHERE id=? AND status='busy'",
            observed?.running ? "ready" : "stopped",
            now(),
            runtime.id,
          );
        } catch {
          this.db.run(
            "UPDATE sandbox_runtimes SET status='failed',error_code='STATE_UNCONFIRMED',updated_at=? WHERE id=? AND status='busy'",
            now(),
            runtime.id,
          );
        }
      }
    }
  }
}
