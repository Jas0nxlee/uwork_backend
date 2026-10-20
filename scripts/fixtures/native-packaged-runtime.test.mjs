import assert from "node:assert/strict";
import test from "node:test";
import { packagedManifestInput } from "./native-packaged-runtime.mjs";

const repo = "/owned/repo";
const manifest =
  repo + "/evidence/client-macos-package-v3-manifest-20261020.json";
test("packaged mode accepts only the explicit owned manifest and experience fixture", () => {
  assert.equal(packagedManifestInput(undefined, repo, {}), null);
  assert.equal(
    packagedManifestInput(manifest, repo, {
      experience: "enabled",
      otherMode: false,
    }),
    manifest,
  );
  assert.throws(() =>
    packagedManifestInput(manifest, repo, {
      experience: "enabled",
      otherMode: true,
    }),
  );
  assert.throws(() =>
    packagedManifestInput(manifest, repo, {
      experience: undefined,
      otherMode: false,
    }),
  );
});
test("packaged mode rejects traversal, unrelated evidence and an installed application", () => {
  for (const path of [
    "../file",
    "/Applications/UWork.app",
    repo + "/evidence/../bad.json",
    repo + "/evidence/other.json",
  ])
    assert.throws(() =>
      packagedManifestInput(path, repo, {
        experience: "enabled",
        otherMode: false,
      }),
    );
});
