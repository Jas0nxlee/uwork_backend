import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { Runtime, Run } from "./runtime.js";
import type { Vault } from "./vault.js";
import { authenticate, requirePermission } from "./access.js";
import { audit } from "./events.js";
import { fail, id, now, text } from "./core.js";

const casesSchema = z
  .array(
    z
      .object({
        input: z.string().min(1).max(10000),
        expected: z.string().max(10000),
        match: z.enum(["exact", "contains"]).default("exact"),
      })
      .strict(),
  )
  .min(1)
  .max(50);
type Case = z.infer<typeof casesSchema>[number];
interface Report {
  cases: {
    runId: string;
    expected: string;
    match: string;
    passed?: boolean;
    status?: string;
  }[];
  passRate?: number;
  passed?: number;
  total?: number;
}
interface Evaluation {
  id: string;
  tenant_id: string;
  user_id: string;
  agent_id: string;
  dataset_id: string;
  status: string;
  report: string;
  created_at: number;
  finished_at: number | null;
}
export class EvaluationWorker {
  constructor(
    private db: Db,
    private runtime: Runtime,
    private vault: Vault,
  ) {}
  report(row: Evaluation) {
    return {
      ...row,
      report: JSON.parse(
        this.vault.open(row.report, `${row.tenant_id}:${row.id}:evaluation`),
      ) as Report,
    };
  }
  tick() {
    for (const row of this.db.all<Evaluation>(
      "SELECT * FROM evaluations WHERE status='running'",
    )) {
      const report = this.report(row).report;
      let finished = true,
        passed = 0;
      for (const c of report.cases) {
        const stored = this.db.get<Run>(
          "SELECT * FROM runs WHERE tenant_id=? AND id=?",
          row.tenant_id,
          c.runId,
        )!;
        if (["queued", "running"].includes(stored.status)) {
          finished = false;
          break;
        }
        const run = this.runtime.decode(stored);
        c.passed =
          run.status === "succeeded" &&
          (c.match === "contains"
            ? (run.output ?? "").includes(c.expected)
            : run.output === c.expected);
        c.status = run.status;
        if (c.passed) passed++;
      }
      if (finished) {
        report.passed = passed;
        report.total = report.cases.length;
        report.passRate = passed / report.cases.length;
        this.db.run(
          "UPDATE evaluations SET status='succeeded',report=?,finished_at=? WHERE id=? AND status='running'",
          this.vault.seal(
            JSON.stringify(report),
            `${row.tenant_id}:${row.id}:evaluation`,
          ),
          now(),
          row.id,
        );
      }
    }
  }
  async drain() {
    await this.runtime.drain();
    this.tick();
  }
}
export function evaluationRoutes(
  app: FastifyInstance,
  db: Db,
  runtime: Runtime,
  vault: Vault,
  evaluation: EvaluationWorker,
) {
  const p = "/api/tenants/:tenantId";
  app.get(`${p}/datasets`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    return db.all<{ id: string; name: string; created_at: number }>(
      "SELECT id,name,created_at FROM datasets WHERE tenant_id=? ORDER BY created_at DESC",
      a.tenantId,
    );
  });
  app.post(`${p}/datasets`, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const d = z
      .object({ name: text, cases: casesSchema })
      .strict()
      .parse(req.body);
    const datasetId = id();
    db.run(
      "INSERT INTO datasets VALUES(?,?,?,?,?)",
      datasetId,
      a.tenantId,
      d.name,
      vault.seal(JSON.stringify(d.cases), `${a.tenantId}:${datasetId}:dataset`),
      now(),
    );
    audit(db, a, "evaluation.dataset.create", datasetId);
    reply.code(201);
    return { id: datasetId };
  });
  app.get(`${p}/datasets/:id`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const { id } = req.params as { id: string };
    const row = db.get<{ name: string; cases: string }>(
      "SELECT name,cases FROM datasets WHERE tenant_id=? AND id=?",
      a.tenantId,
      id,
    );
    if (!row) fail(404, "NOT_FOUND", "数据集不存在");
    return {
      id,
      name: row.name,
      cases: JSON.parse(
        vault.open(row.cases, `${a.tenantId}:${id}:dataset`),
      ) as Case[],
    };
  });
  app.delete(`${p}/datasets/:id`, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const { id } = req.params as { id: string };
    if (
      db.get(
        "SELECT id FROM evaluations WHERE tenant_id=? AND dataset_id=?",
        a.tenantId,
        id,
      )
    )
      fail(409, "DATASET_IN_USE", "数据集已用于评测");
    if (
      !db.run("DELETE FROM datasets WHERE tenant_id=? AND id=?", a.tenantId, id)
        .changes
    )
      fail(404, "NOT_FOUND", "数据集不存在");
    reply.code(204);
  });
  app.post(`${p}/evaluations`, async (req, reply) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const d = z
      .object({ agentId: text, datasetId: text })
      .strict()
      .parse(req.body);
    runtime.agent(a, d.agentId);
    const dataset = db.get<{ cases: string }>(
      "SELECT cases FROM datasets WHERE tenant_id=? AND id=?",
      a.tenantId,
      d.datasetId,
    );
    if (!dataset) fail(404, "NOT_FOUND", "数据集不存在");
    const cases = casesSchema.parse(
      JSON.parse(
        vault.open(dataset.cases, `${a.tenantId}:${d.datasetId}:dataset`),
      ),
    );
    const evaluationId = id();
    const report: Report = { cases: [] };
    db.transaction(() => {
      for (const [index, c] of cases.entries()) {
        const runId = runtime.enqueue(
          a,
          d.agentId,
          c.input,
          1800000,
          undefined,
          `evaluation:${evaluationId}:${index}`,
        );
        report.cases.push({ runId, expected: c.expected, match: c.match });
      }
      db.run(
        "INSERT INTO evaluations VALUES(?,?,?,?,?,?,?,?,NULL)",
        evaluationId,
        a.tenantId,
        a.userId,
        d.agentId,
        d.datasetId,
        "running",
        vault.seal(
          JSON.stringify(report),
          `${a.tenantId}:${evaluationId}:evaluation`,
        ),
        now(),
      );
      audit(db, a, "evaluation.create", evaluationId);
    });
    reply.code(202);
    return { id: evaluationId };
  });
  app.get(`${p}/evaluations`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    return db
      .all<Evaluation>(
        "SELECT * FROM evaluations WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100",
        a.tenantId,
      )
      .map((row) => evaluation.report(row));
  });
  app.get(`${p}/evaluations/:id`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "read");
    const row = db.get<Evaluation>(
      "SELECT * FROM evaluations WHERE tenant_id=? AND id=?",
      a.tenantId,
      (req.params as { id: string }).id,
    );
    if (!row) fail(404, "NOT_FOUND", "评测不存在");
    return evaluation.report(row);
  });
  app.post(`${p}/evaluations/:id/cancel`, async (req) => {
    const a = authenticate(db, req);
    requirePermission(a, "write");
    const row = db.get<Evaluation>(
      "SELECT * FROM evaluations WHERE tenant_id=? AND id=?",
      a.tenantId,
      (req.params as { id: string }).id,
    );
    if (!row) fail(404, "NOT_FOUND", "评测不存在");
    for (const c of evaluation.report(row).report.cases)
      runtime.cancel(a, c.runId);
    db.run(
      "UPDATE evaluations SET status='cancelled',finished_at=? WHERE id=? AND status='running'",
      now(),
      row.id,
    );
    return { ok: true };
  });
}
