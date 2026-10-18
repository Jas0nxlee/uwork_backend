import test from "node:test";
import assert from "node:assert/strict";
import {
  SHARE_API,
  canonical,
  publication,
  sha,
  shareFixture,
} from "./member-sharing-fixture.js";

function artifact(bytes = Buffer.from("OWNED_SHARED_MARKDOWN\n"), number = 1) {
  const descriptor = {
    artifact_id: `share-artifact-${number}`,
    logical_artifact_key: `share-artifact-key-${number}`,
    producer_product_turn_id: "share-product-turn-1",
    artifact_version: 1,
    state: "current",
    ref: `zcode-artifact://share/share-artifact-${number}`,
    artifact_type: "md",
    display_name: `owned-${number}.md`,
    extension: "md",
    mime_type: "text/markdown",
    size_bytes: bytes.length,
    sha256: sha(bytes),
  };
  return { descriptor, content_base64: bytes.toString("base64"), bytes };
}

test("organization attachments require complete uploads and every download rechecks member and file policy", async (t) => {
  const f = await shareFixture(t);
  await f.configure("sharing", { files: true });
  const a = artifact();
  const prepared = await f.prepare(publication([a.descriptor]));
  const endpoint = `${SHARE_API}/preparations/${prepared.preparationId}`;
  const incomplete = await f.app.inject({
    method: "POST",
    url: `${endpoint}/confirm`,
    headers: f.headers,
    payload: prepared.confirm,
  });
  assert.equal(incomplete.statusCode, 409, incomplete.body);
  const upload = () =>
    f.app.inject({
      method: "POST",
      url: `${endpoint}/artifacts`,
      headers: f.headers,
      payload: { descriptor: a.descriptor, content_base64: a.content_base64 },
    });
  const first = await upload();
  assert.equal(first.statusCode, 201, first.body);
  assert.equal((await upload()).statusCode, 200);
  const share = await f.confirm(prepared);
  const url = `${SHARE_API}/${share.share_code}/artifacts/${a.descriptor.artifact_id}`;
  const json = await f.app.inject({ url, headers: f.member });
  assert.equal(json.statusCode, 200, json.body);
  assert.deepEqual(json.json().descriptor, a.descriptor);
  assert.deepEqual(Buffer.from(json.json().content_base64, "base64"), a.bytes);
  const content = await f.app.inject({
    url: `${url}/content`,
    headers: f.member,
  });
  assert.equal(content.statusCode, 200, content.body);
  assert.deepEqual(content.rawPayload, a.bytes);
  assert.match(String(content.headers["content-disposition"]), /^attachment;/);
  assert.equal(content.headers["content-type"], "application/octet-stream");
  assert.equal(content.headers["x-content-type-options"], "nosniff");
  for (const headers of [undefined, f.outsider, f.device]) {
    const response = await f.app.inject({
      url: `${url}/content`,
      ...(headers ? { headers } : {}),
    });
    assert.ok([401, 403, 404].includes(response.statusCode), response.body);
    assert.equal(response.body.includes("OWNED_SHARED_MARKDOWN"), false);
  }
  await f.configure("sharing", { files: false });
  for (const path of [url, `${url}/content`])
    assert.equal(
      (await f.app.inject({ url: path, headers: f.member })).statusCode,
      403,
    );
  const preview = await f.app.inject({
    url: `${SHARE_API}/${share.share_code}/preview`,
    headers: f.member,
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().artifacts.length, 1);
  assert.deepEqual(preview.json().integrity, prepared.confirm.integrity);
});

test("artifact input rejects false bytes, unsafe metadata and unsupported combinations without completing the upload", async (t) => {
  const f = await shareFixture(t);
  await f.configure("sharing", { files: true });
  const a = artifact();
  const prepared = await f.prepare(publication([a.descriptor]));
  const url = `${SHARE_API}/preparations/${prepared.preparationId}/artifacts`;
  const inputs = [
    { descriptor: a.descriptor, content_base64: "***" },
    {
      descriptor: a.descriptor,
      content_base64: Buffer.from("other bytes").toString("base64"),
    },
    {
      descriptor: { ...a.descriptor, size_bytes: a.bytes.length + 1 },
      content_base64: a.content_base64,
    },
    {
      descriptor: {
        ...a.descriptor,
        original_path: "/private/source/never-read",
      },
      content_base64: a.content_base64,
    },
    {
      descriptor: { ...a.descriptor, display_name: "bad\r\nname.md" },
      content_base64: a.content_base64,
    },
    {
      descriptor: {
        ...a.descriptor,
        artifact_type: "html",
        extension: "html",
        mime_type: "text/html",
      },
      content_base64: a.content_base64,
    },
  ];
  for (const payload of inputs) {
    const response = await f.app.inject({
      method: "POST",
      url,
      headers: f.headers,
      payload,
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  const deniedOwner = await f.app.inject({
    method: "POST",
    url,
    headers: f.outsider,
    payload: { descriptor: a.descriptor, content_base64: a.content_base64 },
  });
  assert.equal(deniedOwner.statusCode, 404, deniedOwner.body);
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url,
        headers: f.headers,
        payload: { descriptor: a.descriptor, content_base64: a.content_base64 },
      })
    ).statusCode,
    201,
  );
  const changedBytes = Buffer.from("changed artifact bytes");
  const changed = artifact(changedBytes);
  const collision = await f.app.inject({
    method: "POST",
    url,
    headers: f.headers,
    payload: {
      descriptor: changed.descriptor,
      content_base64: changed.content_base64,
    },
  });
  assert.equal(collision.statusCode, 409, collision.body);
  await f.confirm(prepared);
});

test("attachment count, per-file size and aggregate limits reject before publication", async (t) => {
  const f = await shareFixture(t);
  await f.configure("sharing", { files: true });
  const tooMany = publication();
  tooMany.preparation.artifact_count = 9;
  const rejected = await f.app.inject({
    method: "POST",
    url: `${SHARE_API}/preparations`,
    headers: f.headers,
    payload: tooMany.preparation,
  });
  assert.equal(rejected.statusCode, 400, rejected.body);
  const a = artifact(Buffer.alloc(512 * 1024 + 1, 65));
  const prepared = await f.prepare(publication([a.descriptor]));
  const upload = await f.app.inject({
    method: "POST",
    url: `${SHARE_API}/preparations/${prepared.preparationId}/artifacts`,
    headers: f.headers,
    payload: { descriptor: a.descriptor, content_base64: a.content_base64 },
  });
  assert.equal(upload.statusCode, 400, upload.body);
  const artifacts = [1, 2, 3].map((number) =>
    artifact(Buffer.alloc(400 * 1024, number), number),
  );
  const total = await f.prepare(
    publication(artifacts.map((x) => x.descriptor)),
  );
  for (let i = 0; i < artifacts.length; i++) {
    const entry = artifacts[i]!;
    const response = await f.app.inject({
      method: "POST",
      url: `${SHARE_API}/preparations/${total.preparationId}/artifacts`,
      headers: f.headers,
      payload: {
        descriptor: entry.descriptor,
        content_base64: entry.content_base64,
      },
    });
    assert.equal(response.statusCode, i < 2 ? 201 : 400, response.body);
  }
  const incomplete = await f.app.inject({
    method: "POST",
    url: `${SHARE_API}/preparations/${total.preparationId}/confirm`,
    headers: f.headers,
    payload: total.confirm,
  });
  assert.equal(incomplete.statusCode, 409, incomplete.body);
});

test("sharing rejects over-limit or deeply nested JSON without a server error", async (t) => {
  const f = await shareFixture(t);
  const prepared = await f.prepare();
  const url = `${SHARE_API}/preparations/${prepared.preparationId}/confirm`;
  const overRows = structuredClone(prepared.confirm);
  overRows.projection.rows = Array.from({ length: 2001 }, (_, rowId) => ({
    ...overRows.projection.rows[0],
    rowId,
  }));
  const deep = structuredClone(prepared.confirm);
  let value: unknown = "leaf";
  for (let depth = 0; depth < 100; depth++) value = { next: value };
  deep.projection.rows[1]!.extra = value;
  const invalidUnicode = structuredClone(prepared.confirm);
  invalidUnicode.projection.rows[1]!.text = "\ud800";
  const tooLarge = structuredClone(prepared.confirm);
  tooLarge.projection.rows[1]!.text = "x".repeat(1024 * 1024);
  for (const payload of [overRows, deep, invalidUnicode, tooLarge]) {
    const response = await f.app.inject({
      method: "POST",
      url,
      headers: f.headers,
      payload,
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  await f.confirm(prepared);
});

test("valid hashes cannot publish artifact rows whose references or bytes disagree with the uploaded descriptor", async (t) => {
  const f = await shareFixture(t);
  await f.configure("sharing", { files: true });
  for (const patch of [
    { sha256: "0".repeat(64) },
    { sizeBytes: 1 },
    { ref: "zcode-artifact://share/not-uploaded" },
  ]) {
    const a = artifact();
    const input = publication([a.descriptor]);
    Object.assign(input.confirm.projection.rows[3]!, patch);
    input.confirm.integrity.projection_sha256 = sha(
      canonical(input.confirm.projection.rows),
    );
    input.preparation.payload_sha256 = sha(canonical(input.confirm));
    const prepared = await f.prepare(input);
    const upload = await f.app.inject({
      method: "POST",
      url: `${SHARE_API}/preparations/${prepared.preparationId}/artifacts`,
      headers: f.headers,
      payload: { descriptor: a.descriptor, content_base64: a.content_base64 },
    });
    assert.equal(upload.statusCode, 201, upload.body);
    const response = await f.app.inject({
      method: "POST",
      url: `${SHARE_API}/preparations/${prepared.preparationId}/confirm`,
      headers: f.headers,
      payload: input.confirm,
    });
    assert.equal(response.statusCode, 400, response.body);
  }
});
