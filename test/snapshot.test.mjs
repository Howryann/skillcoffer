import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  createStoreSnapshot,
  restoreStoreSnapshot,
  validateStoreSnapshot,
} from "../dist/snapshot.js";
import { Store } from "../dist/store.js";

test("portable snapshots round-trip store state without external links", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-snapshot-test-"));
  let snapshot;
  let emptySnapshot;
  try {
    const source = join(root, "source");
    mkdirSync(source);
    writeFileSync(join(source, "SKILL.md"), "---\nname: alpha\n---\n");
    writeFileSync(join(source, "marker.txt"), "v1\n");
    writeFileSync(join(source, "run.sh"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(source, "run.sh"), 0o700);

    const original = new Store(join(root, "original"));
    original.addFromFile(source);
    writeFileSync(join(original.workDir("alpha", "main"), "marker.txt"), "v2\n");
    original.save("alpha", { note: "second" });
    original.branchNew("alpha", "draft");
    original.workOn("alpha", "draft");
    writeFileSync(join(original.workDir("alpha", "draft"), "marker.txt"), "dirty\n");
    original.bundleCreate("empty");
    original.bundleCreate("kit");
    original.bundleAdd("kit", "alpha", { pin: true });
    original.link("alpha", join(root, "original-link"), { ref: "main" });

    snapshot = createStoreSnapshot(original);
    assert.equal(validateStoreSnapshot(snapshot.dir), snapshot.hash);

    const restored = new Store(join(root, "restored"));
    restoreStoreSnapshot(restored, snapshot.dir);
    const status = restored.status("alpha");
    assert.equal(status.manifest.activeBranch, "draft");
    assert.equal(status.dirty.draft, true);
    assert.equal(status.versions.length, 2);
    assert.equal(status.manifest.links.length, 0);
    assert.deepEqual(restored.bundleList().map((bundle) => bundle.name), ["empty", "kit"]);
    assert.deepEqual(restored.bundleList()[1].members, [{ skill: "alpha", mode: "pin" }]);
    const bundleMember = join(restored.bundlePath("kit"), "alpha");
    assert.ok(resolve(dirname(bundleMember), readlinkSync(bundleMember)).startsWith(restored.home));

    const head = status.manifest.branches.main.head;
    const restoredScript = join(restored.versionTree("alpha", head), "run.sh");
    assert.equal(statSync(restoredScript).mode & 0o222, 0);
    assert.notEqual(statSync(restoredScript).mode & 0o100, 0);
    const roundTrip = createStoreSnapshot(restored);
    try {
      assert.equal(roundTrip.hash, snapshot.hash);
    } finally {
      roundTrip.cleanup();
    }

    const restoredLink = join(root, "restored-link");
    restored.link("alpha", restoredLink, { ref: "main" });
    restoreStoreSnapshot(restored, snapshot.dir);
    assert.equal(restored.status("alpha").manifest.links.length, 1);
    assert.equal(existsSync(restoredLink), true);

    const empty = new Store(join(root, "empty"));
    emptySnapshot = createStoreSnapshot(empty);
    assert.throws(
      () => restoreStoreSnapshot(restored, emptySnapshot.dir),
      /pull would remove linked skill/,
    );
    assert.equal(restored.hasSkill("alpha"), true);

    const versionTree = join(
      snapshot.dir,
      "skills",
      "alpha",
      "versions",
      head,
      "tree",
      "marker.txt",
    );
    chmodSync(versionTree, 0o600);
    writeFileSync(versionTree, "tampered\n");
    assert.throws(() => validateStoreSnapshot(snapshot.dir), /version tree hash mismatch/);
  } finally {
    snapshot?.cleanup();
    emptySnapshot?.cleanup();
    rmSync(root, { recursive: true, force: true });
  }
});
