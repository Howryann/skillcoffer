import assert from "node:assert/strict";
import { readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Store } from "../dist/store.js";
import { githubFixture, writeSkill } from "./helpers/github-fixture.mjs";

function setup(t) {
  const fixture = githubFixture(t);
  const repo = fixture.repository("upstream", (seed) => writeSkill(join(seed, "skills", "alpha")));
  const store = new Store(join(fixture.root, "home"));
  store.addFromGithub(`${repo.spec}/skills/alpha`);
  const initial = store.status("alpha").manifest.branches.main.head;
  const edit = (branch) => {
    writeFileSync(join(store.workDir("alpha", branch), "local.txt"), "saved local change\n");
    return store.save("alpha", { branch });
  };
  const assertProtected = (branch) => {
    const state = store.status("alpha").manifest.branches[branch];
    const content = readFileSync(join(store.workDir("alpha", branch), "local.txt"), "utf8");
    assert.equal(store.check("alpha", { branch }).status, "local-diverged");
    assert.throws(() => store.updateApply("alpha", { branch }), /local-diverged/);
    assert.deepEqual(store.status("alpha").manifest.branches[branch], state);
    assert.equal(readFileSync(join(store.workDir("alpha", branch), "local.txt"), "utf8"), content);
  };
  return { ...fixture, repo, store, initial, edit, assertProtected };
}

test("new branches preserve the source upstream base and protect inherited local saves", (t) => {
  const { store, initial, edit, assertProtected } = setup(t);
  store.branchNew("alpha", "custom");
  assert.equal(store.status("alpha").manifest.branches.custom.upstreamBaseVersion, initial);
  edit("custom");
  assertProtected("custom");
  store.workOn("alpha", "custom");
  store.branchNew("alpha", "from-active");
  store.branchNew("alpha", "from-named", { from: "custom" });
  for (const branch of ["from-active", "from-named"]) {
    assert.equal(store.status("alpha").manifest.branches[branch].upstreamBaseVersion, initial);
    assertProtected(branch);
  }
});

test("unknown bases and local historical versions remain protected, including old Stores", (t) => {
  const { store, initial, edit, assertProtected } = setup(t);
  const local = edit("main");
  store.branchNew("alpha", "from-local-version", { from: local.id });
  assertProtected("from-local-version");

  const manifest = store.status("alpha").manifest;
  delete manifest.branches.main.upstreamBaseVersion;
  writeFileSync(store.manifestPath("alpha"), JSON.stringify(manifest));
  assertProtected("main");
  store.branchNew("alpha", "from-legacy", { from: "main" });
  assertProtected("from-legacy");

  store.branchNew("alpha", "from-upstream-version", { from: initial });
  assert.equal(store.status("alpha").manifest.branches["from-upstream-version"].upstreamBaseVersion, initial);
  assert.equal(store.check("alpha", { branch: "from-upstream-version" }).status, "equal");
});

test("clean upstream branches still update, equality is a no-op, and force preserves history and pins", (t) => {
  const { root, repo, store, initial, commit, edit } = setup(t);
  store.branchNew("alpha", "clean");
  const local = edit("main");
  const pin = join(root, "pin");
  store.link("alpha", pin, { pin: true });
  const pinnedTarget = readlinkSync(pin);

  writeFileSync(join(repo.seed, "skills", "alpha", "remote.txt"), "upstream update\n");
  commit(repo);
  assert.equal(store.check("alpha", { branch: "clean" }).status, "upstream-changed");
  const applied = store.updateApply("alpha", { branch: "clean" });
  assert.notEqual(applied.version.id, initial);
  assert.equal(store.status("alpha").manifest.branches.clean.upstreamBaseVersion, applied.version.id);
  assert.equal(store.updateApply("alpha", { branch: "clean" }).version.id, applied.version.id);
  assert.equal(store.check("alpha", { branch: "main" }).status, "local-diverged");
  store.updateApply("alpha", { branch: "main", force: true });
  assert.equal(store.isDirty("alpha", "main"), false);
  assert.equal(readlinkSync(pin), pinnedTarget);
  assert.equal(readFileSync(join(store.versionTree("alpha", local.id), "local.txt"), "utf8"), "saved local change\n");

  // Equal content is safe even if a legacy branch has no known base.
  const manifest = store.status("alpha").manifest;
  delete manifest.branches.main.upstreamBaseVersion;
  writeFileSync(store.manifestPath("alpha"), JSON.stringify(manifest));
  assert.equal(store.check("alpha").status, "equal");
  assert.equal(store.updateApply("alpha").check.status, "equal");
  writeFileSync(join(store.workDir("alpha", "main"), "dirty.txt"), "unsaved\n");
  assert.throws(() => store.updateApply("alpha", { force: true }), /dirty work/);
});
