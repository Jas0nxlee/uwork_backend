import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixtures.js";

test("usage aggregates honor the same member, application and model filters as ledger detail", async (t) => {
  const f = await fixture(t, "http://127.0.0.1:1");
  const { db } = f.app.services;
  const insert = (
    key: string,
    user: string,
    application: string,
    model: string,
    amount: number,
    status = "settled",
  ) =>
    db.run(
      "INSERT INTO ledger(id,tenant_id,request_key,user_id,department_id,application,model_id,period,amount,reserved,status,input_tokens,output_tokens,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      key,
      f.tenantId,
      key,
      user,
      "department",
      application,
      model,
      "period",
      amount,
      amount,
      status,
      amount,
      1,
      Date.now() - 1000,
    );
  insert("selected", f.userId, "uwork", "selected-model", 7);
  insert("other-member", "other-user", "uwork", "selected-model", 11);
  insert("other-application", f.userId, "agent", "selected-model", 13);
  insert("other-model", f.userId, "uwork", "other-model", 17);
  insert("reserved", f.userId, "uwork", "selected-model", 0, "reserved");
  const filters = new URLSearchParams({
    userId: f.userId,
    application: "uwork",
    q: "selected-model",
    status: "settled",
  });
  const detail = await f.app.inject({
    url: `${f.p}/usage?${filters}`,
    headers: f.headers,
  });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().total, 1);
  for (const groupBy of ["member", "department", "application"]) {
    const aggregate = await f.app.inject({
      url: `${f.p}/usage/aggregates?${filters}&groupBy=${groupBy}`,
      headers: f.headers,
    });
    assert.equal(aggregate.statusCode, 200, aggregate.body);
    assert.equal(aggregate.json().length, 1);
    assert.equal(aggregate.json()[0].credits, detail.json().items[0].amount);
    assert.equal(aggregate.json()[0].requests, 1);
  }
});
