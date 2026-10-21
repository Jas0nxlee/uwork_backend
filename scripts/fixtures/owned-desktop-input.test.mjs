import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  desktopInputHashes,
  loadOwnedDesktopInput,
} from "./owned-desktop-input.mjs";
import { copyNativeOutSnapshot } from "./native-out-snapshot.mjs";

async function fixture(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-out-input-contract-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = join(root, "repo"),
    base = join(root, "owned-cache"),
    cache = join(base, "build");
  await mkdir(join(repository, "clients/uwork/packages/ui/src"), {
    recursive: true,
  });
  await mkdir(join(repository, "clients/uwork/apps/zcode-cli/packages"), {
    recursive: true,
  });
  await mkdir(join(repository, "clients/uwork/packages/desktop/out/main"), {
    recursive: true,
  });
  for (const file of ["package.json", "pnpm-lock.yaml"])
    await writeFile(join(repository, "clients/uwork", file), "owned");
  for (const file of ["vite.config.ts", "tsup.config.ts"])
    await writeFile(
      join(repository, "clients/uwork/packages/desktop", file),
      "owned",
    );
  const input = join(repository, "clients/uwork/packages/ui/src/view.ts");
  await writeFile(input, "export const owned = 1;");
  await writeFile(
    join(repository, "clients/uwork/packages/desktop/out/main/index.js"),
    "owned-built-bytes",
  );
  await mkdir(cache, { recursive: true, mode: 0o700 });
  await mkdir(join(cache, "app"), { mode: 0o700 });
  const snapshot = await copyNativeOutSnapshot({
    source: join(repository, "clients/uwork/packages/desktop/out"),
    ownedRoot: cache,
  });
  const manifestPath = join(cache, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema: 1,
      repository,
      inputs: await desktopInputHashes(repository),
      snapshot,
    }),
    { mode: 0o600 },
  );
  return { root, repository, cacheBase: base, cache, manifestPath, input };
}
test("frozen input verifies exact copied bytes and detects cache tampering", async (t) => {
  const f = await fixture(t);
  const loaded = await loadOwnedDesktopInput(f);
  const first = join(f.root, "runtime1");
  await mkdir(join(first, "app"), { recursive: true });
  await loaded.verify(
    await copyNativeOutSnapshot({ source: loaded.source, ownedRoot: first }),
  );
  await writeFile(join(loaded.source, "main/index.js"), "tampered bytes");
  const second = join(f.root, "runtime2");
  await mkdir(join(second, "app"), { recursive: true });
  const actual = await copyNativeOutSnapshot({
    source: loaded.source,
    ownedRoot: second,
  });
  await assert.rejects(
    loaded.verify(actual),
    /frozen desktop artifact bytes differ/,
  );
});
test("changed source is rejected before the original app is launched", async (t) => {
  const f = await fixture(t);
  await writeFile(f.input, "export const owned = 2;");
  await assert.rejects(
    loadOwnedDesktopInput(f),
    /desktop sources differ from frozen build/,
  );
});
test("an otherwise valid manifest outside the declared cache base is rejected", async (t) => {
  const f = await fixture(t);
  const outside = join(f.root, "outside.json");
  await writeFile(outside, "{}");
  await assert.rejects(
    loadOwnedDesktopInput({ ...f, manifestPath: outside }),
    /cache manifest outside owned base/,
  );
});
