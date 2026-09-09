import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Store, treeHashOf } from "../dist/store.js";
import { readUpstreamCache } from "../dist/upstream.js";
import { githubFixture, writeSkill } from "./helpers/github-fixture.mjs";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
function cli(store, args, env = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, SKILLCOFFER_HOME: store.home, ...env },
    timeout: 15000,
  });
}
function setup(t) {
  const fixture = githubFixture(t);
  const repo = fixture.repository("updates", seed => {
    writeSkill(join(seed, "skills/alpha"), "alpha");
    writeSkill(join(seed, "skills/beta"), "beta");
  });
  const store = new Store(join(fixture.root, "store"));
  store.addFromGithub(`${repo.spec}/skills`);
  return { ...fixture, repo, store };
}

test("CLI batch shares fetches, reports content changes, preserves work, and caches results", t => {
  const { root, repo, store, commit } = setup(t);
  writeSkill(join(root, "local"), "local");
  store.addFromFile(join(root, "local"));
  writeFileSync(join(store.workDir("beta", "main"), "saved.md"), "local saved change\n");
  store.save("beta");
  writeFileSync(join(store.workDir("alpha", "main"), "dirty.md"), "unsaved change\n");
  writeFileSync(join(repo.seed, "skills/alpha/remote.md"), "upstream change\n");
  const commitId = commit(repo);
  const before = store.list().map(m => [
    readFileSync(store.manifestPath(m.localId), "utf8"),
    treeHashOf(store.workDir(m.localId, m.activeBranch)),
  ]);
  const trace = join(root, "git-trace");
  const result = cli(store, ["check", "--all", "-v"], { GIT_TRACE: trace });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /alpha@main\tavailable\t/);
  assert.match(result.stdout, /beta@main\tcurrent\tupstream is unchanged/);
  assert.match(result.stdout, /local@main\tskipped\tno github upstream/);
  assert.match(result.stdout, /summary: 1 available, 1 current, 0 unknown, 1 skipped, 0 failed/);
  assert.ok(result.stdout.includes(`upstream commit: ${commitId}`));
  const fetches = readFileSync(trace, "utf8").match(/built-in: git fetch --depth 1 --filter=blob:none origin main/g);
  assert.equal(fetches?.length, 1);
  assert.equal(readUpstreamCache(store).alpha.resolvedCommit, commitId);
  assert.deepEqual(store.list().map(m => [
    readFileSync(store.manifestPath(m.localId), "utf8"),
    treeHashOf(store.workDir(m.localId, m.activeBranch)),
  ]), before);
});

test("CLI batch reports missing paths and unknown baselines without losing successful results", t => {
  const { repo, store, commit } = setup(t);
  writeFileSync(join(store.workDir("alpha", "main"), "saved.md"), "local\n");
  store.save("alpha");
  const manifest = store.status("alpha").manifest;
  delete manifest.branches.main.upstreamBaseVersion;
  writeFileSync(store.manifestPath("alpha"), JSON.stringify(manifest));
  rmSync(join(repo.seed, "skills/beta"), { recursive: true });
  commit(repo);
  const result = cli(store, ["check", "--all"]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /alpha@main\tunknown\t/);
  assert.match(result.stdout, /beta@main\tfailed\t/);
  assert.match(result.stdout, /summary: 0 available, 0 current, 1 unknown, 0 skipped, 1 failed/);
});

test("CLI batch continues to other repositories after a fetch fails", t => {
  const { repository, repo, store } = setup(t);
  const other = repository("other", seed => writeSkill(join(seed, "gamma"), "gamma"));
  store.addFromGithub(`${other.spec}/gamma`);
  rmSync(repo.remote, { recursive: true });
  const result = cli(store, ["check", "--all"]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /alpha@main\tfailed\t/);
  assert.match(result.stdout, /beta@main\tfailed\t/);
  assert.match(result.stdout, /gamma@main\tcurrent\t/);
  assert.match(result.stdout, /summary: 0 available, 1 current, 0 unknown, 0 skipped, 2 failed/);
});

test("CLI batch selects active or explicit branches without switching and reports missing branches", t => {
  const { repo, store, commit } = setup(t);
  store.branchNew("alpha", "custom");
  store.workOn("alpha", "custom");
  writeFileSync(join(repo.seed, "skills/alpha/remote.md"), "new upstream\n");
  commit(repo);
  store.updateApply("alpha", { branch: "main" });
  let result = cli(store, ["check", "--all"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /alpha@custom\tavailable\t/);
  result = cli(store, ["check", "--all", "--branch", "main"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /alpha@main\tcurrent\t/);
  assert.match(result.stdout, /summary: 0 available, 2 current, 0 unknown, 0 skipped, 0 failed/);
  result = cli(store, ["check", "--all", "--branch", "custom"]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /alpha@custom\tavailable\t/);
  assert.match(result.stdout, /beta@custom\tfailed\tbranch not found: custom/);
  assert.equal(store.status("alpha").manifest.activeBranch, "custom");
  assert.equal(store.status("beta").manifest.activeBranch, "main");
});

test("CLI batch handles empty/local stores and validates arguments without changing single-skill defaults", t => {
  const { root } = githubFixture(t);
  const store = new Store(join(root, "store"));
  let result = cli(store, ["check", "--all"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /summary: 0 available, 0 current, 0 unknown, 0 skipped, 0 failed/);
  result = cli(store, ["check"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /check <skill> or check --all/);
  writeSkill(join(root, "local"), "all");
  store.addFromFile(join(root, "local"));
  for (const args of [["check"], ["check", "all"]]) {
    result = cli(store, args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /status: unavailable/);
    assert.doesNotMatch(result.stdout, /summary:/);
  }
  result = cli(store, ["check", "--all"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /all@main\tskipped\t/);
  result = cli(store, ["check", "all", "--all"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /mutually exclusive/);
  result = cli(store, ["check", "all", "extra"]);
  assert.equal(result.status, 2);
  result = cli(store, ["update", "--all", "--apply"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--all is only supported by check/);
  writeSkill(join(root, "second"), "second");
  store.addFromFile(join(root, "second"));
  result = cli(store, ["check"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /check <skill> or check --all/);
});
