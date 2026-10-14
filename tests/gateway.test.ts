import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/app.js';
import { bootstrap } from '../src/identity.js';
import { billingPeriod } from '../src/entitlements.js';

test('encrypted credentials, real upstream, idempotent ledger and atomic quota admission', async t => {
  let calls = 0;
  const upstream = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer upstream-test-value'); calls++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '真实 HTTP 测试响应' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 8 } }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const address = upstream.address() as { port: number };
  const app = await createApp({ database: ':memory:', masterKey: Buffer.alloc(32, 3), publicUrl: 'http://localhost:3000', allowPrivateUpstreams: true });
  t.after(() => app.close());
  const { tenantId } = await bootstrap(app.services.db, { name: 'Test', email: 'owner@example.test', password: 'test-password-long' });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'owner@example.test', password: 'test-password-long' } });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const credential = await app.inject({ method: 'POST', url: `/api/tenants/${tenantId}/credentials`, headers, payload: { name: 'upstream', value: 'upstream-test-value' } });
  assert.equal(credential.statusCode, 201, credential.body);
  assert.ok(!JSON.stringify(app.services.db.all('SELECT * FROM credentials')).includes('upstream-test-value'));
  const model = await app.inject({ method: 'POST', url: `/api/tenants/${tenantId}/models`, headers, payload: { name: 'Test Model', upstreamModel: 'test', baseUrl: `http://127.0.0.1:${address.port}/v1`, credentialId: credential.json().id, scope: { all: true }, maxOutputTokens: 128, contextWindow: 8192, inputRate: 1000, outputRate: 1000 } });
  assert.equal(model.statusCode, 201, model.body);
  const payload = { model: model.json().id, messages: [{ role: 'user', content: 'hello' }], max_tokens: 32 };
  const first = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { ...headers, 'idempotency-key': 'first' }, payload });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().choices[0].message.content, '真实 HTTP 测试响应');
  assert.equal((await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { ...headers, 'idempotency-key': 'first' }, payload })).statusCode, 200);
  assert.equal(calls, 1);
  assert.equal(app.services.db.get<{ amount: number }>('SELECT amount FROM ledger')!.amount, 18);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { ...headers, 'idempotency-key': 'first' }, payload: { ...payload, messages: [{ role: 'user', content: 'different' }] } })).statusCode, 409);
  await app.inject({ method: 'PUT', url: `/api/tenants/${tenantId}/limits`, headers, payload: { subjectType: 'tenant', subjectId: tenantId, amount: 20 } });
  const over = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { ...headers, 'idempotency-key': 'over' }, payload });
  assert.equal(over.statusCode, 402, over.body);
  assert.equal(calls, 1);
  const list = await app.inject({ url: `/api/tenants/${tenantId}/credentials`, headers });
  assert.ok(!list.body.includes('upstream-test-value'));
  await app.inject({ method: 'DELETE', url: `/api/tenants/${tenantId}/credentials/${credential.json().id}`, headers });
  assert.equal((await app.inject({ method: 'POST', url: `/api/tenants/${tenantId}/models/${model.json().id}/probe`, headers })).statusCode, 409);
  await app.close(); await new Promise<void>(resolve => upstream.close(() => resolve()));
});

test('subscription anniversary periods clamp month ends and reject private upstreams by default', async () => {
  const start = Date.UTC(2026, 0, 31, 10);
  assert.equal(billingPeriod(Date.UTC(2026, 1, 28, 11), start, 'subscription'), String(Date.UTC(2026, 1, 28, 10)));
  assert.equal(billingPeriod(Date.UTC(2026, 2, 30), start, 'subscription'), String(Date.UTC(2026, 1, 28, 10)));
  const { safeRequest } = await import('../src/network.js');
  await assert.rejects(() => safeRequest('http://127.0.0.1:1234', { method: 'GET' }, false), /HTTPS/);
  await assert.rejects(() => safeRequest('https://127.0.0.1', { method: 'GET' }, false), /私有/);
});
