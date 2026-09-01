import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  backendPull,
  backendPush,
  backendStatus,
  readBackendState,
} from "../dist/backend.js";
import { createStoreSnapshot, restoreStoreSnapshot } from "../dist/snapshot.js";
import { Store } from "../dist/store.js";

function git(cwd, args, config) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function addSkill(store, root, marker) {
  const source = join(root, `source-${marker}`);
  mkdirSync(source);
  writeFileSync(join(source, "SKILL.md"), "---\nname: alpha\n---\n");
  writeFileSync(join(source, "marker.txt"), `${marker}\n`);
  store.addFromFile(source);
}

test("first backend push and pull bind only matching portable snapshots", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-backend-first-"));
  const oldGlobal = process.env.GIT_CONFIG_GLOBAL;
  const oldNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  let originalSnapshot;
  try {
    const remote = join(root, "vault.git");
    const config = join(root, "gitconfig");
    writeFileSync(config, "");
    git(root, ["config", "--file", config, "user.name", "Skillcoffer Test"], config);
    git(root, ["config", "--file", config, "user.email", "test@skillcoffer.local"], config);
    git(
      root,
      [
        "config",
        "--file",
        config,
        `url.${pathToFileURL(remote).href}.insteadOf`,
        "https://github.com/fixture/vault.git",
      ],
      config,
    );
    process.env.GIT_CONFIG_GLOBAL = config;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    git(root, ["init", "--bare", "--initial-branch=main", remote], config);

    const original = new Store(join(root, "original"));
    addSkill(original, root, "v1");
    original.bundleCreate("empty");
    writeFileSync(join(original.workDir("alpha", "main"), "marker.txt"), "dirty\n");
    original.link("alpha", join(root, "external-link"), { ref: "main" });

    const pushed = backendPush(original, "fixture/vault");
    assert.equal(pushed.changed, true);
    assert.equal(readBackendState(original)?.commit, pushed.commit);
    assert.equal(statSync(join(original.home, "backend.json")).mode & 0o077, 0);
    assert.match(
      git(root, ["--git-dir", remote, "show", "main:snapshot/snapshot.json"], config),
      /"schemaVersion": 1/,
    );

    const restored = new Store(join(root, "restored"));
    const pulled = backendPull(restored, "fixture/vault");
    assert.equal(pulled.snapshotHash, pushed.snapshotHash);
    assert.equal(restored.status("alpha").dirty.main, true);
    assert.deepEqual(restored.bundleList(), [{ name: "empty", members: [] }]);
    assert.equal(restored.status("alpha").manifest.links.length, 0);

    originalSnapshot = createStoreSnapshot(original);
    const restoredSnapshot = createStoreSnapshot(restored);
    try {
      assert.equal(restoredSnapshot.hash, originalSnapshot.hash);
    } finally {
      restoredSnapshot.cleanup();
    }

    const same = new Store(join(root, "same"));
    restoreStoreSnapshot(same, originalSnapshot.dir);
    assert.equal(backendPush(same, "fixture/vault").changed, false);

    const different = new Store(join(root, "different"));
    addSkill(different, root, "other");
    assert.throws(() => backendPush(different, "fixture/vault"), /different snapshot/);
    assert.equal(readBackendState(different), undefined);

    const nonempty = new Store(join(root, "nonempty"));
    addSkill(nonempty, root, "local");
    assert.throws(() => backendPull(nonempty, "fixture/vault"), /requires an empty Store/);
    assert.equal(readBackendState(nonempty), undefined);

    assert.equal(backendStatus(original).status, "synced");
    assert.equal(backendPush(original).changed, false);
    writeFileSync(join(original.workDir("alpha", "main"), "marker.txt"), "local update\n");
    assert.equal(backendStatus(original).status, "local-changed");
    assert.equal(backendPush(original).changed, true);
    assert.equal(backendStatus(original).status, "synced");

    assert.equal(backendStatus(restored).status, "remote-changed");
    const restoredLink = join(root, "restored-link");
    restored.link("alpha", restoredLink, { ref: "main" });
    assert.equal(backendPull(restored).changed, true);
    assert.equal(
      readFileSync(join(restored.workDir("alpha", "main"), "marker.txt"), "utf8"),
      "local update\n",
    );
    assert.equal(restored.status("alpha").manifest.links.length, 1);
    assert.equal(backendPull(restored).changed, false);

    backendPull(same);
    same.remove("alpha");
    assert.equal(backendPush(same).changed, true);
    const remoteChanged = backendStatus(restored);
    assert.equal(remoteChanged.status, "remote-changed", remoteChanged.message);
    const restoredBaseline = readBackendState(restored);
    assert.throws(() => backendPull(restored), /pull would remove linked skill/);
    assert.deepEqual(readBackendState(restored), restoredBaseline);
    assert.equal(restored.hasSkill("alpha"), true);

    writeFileSync(join(original.workDir("alpha", "main"), "marker.txt"), "diverged\n");
    assert.equal(backendStatus(original).status, "diverged");
    assert.throws(() => backendPush(original), /remote advanced/);
    assert.throws(() => backendPull(original), /backend diverged/);
  } finally {
    originalSnapshot?.cleanup();
    if (oldGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = oldGlobal;
    if (oldNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = oldNoSystem;
    rmSync(root, { recursive: true, force: true });
  }
});
