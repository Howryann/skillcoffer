import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { acquireGithub } from "../dist/github.js";
import { Store } from "../dist/store.js";
import { checkAllUpstreams, readUpstreamCache, rememberCheck } from "../dist/upstream.js";
import { buildOverview } from "../dist/ui/server.js";
import { UpstreamJob } from "../dist/ui/upstream-job.js";
import { githubFixture, writeSkill } from "./helpers/github-fixture.mjs";

function setup(t) {
  const fixture = githubFixture(t);
  const repo = fixture.repository("updates", seed => {
    writeSkill(join(seed, "skills/alpha"), "alpha");
    writeSkill(join(seed, "skills/beta"), "beta");
  });
  const store = new Store(join(fixture.root, "store"));
  store.addFromGithub(`${repo.spec}/skills`);
  const state = (id = "alpha", current = store) => buildOverview(current).skills.find(s => s.id === id)?.upstream?.status;
  return { ...fixture, repo, store, state };
}

test("batch checks reuse repository/ref fetches, ignore unrelated commits and local edits, and persist results", t => {
  const { repo, store, state, commit } = setup(t);
  assert.equal(state(), undefined);
  writeFileSync(join(store.workDir("alpha", "main"), "local.md"), "local only\n");
  store.save("alpha");
  writeFileSync(join(repo.seed, "README.md"), "unrelated commit\n");
  commit(repo);
  const before = readFileSync(store.manifestPath("alpha"), "utf8");
  let fetches = 0;
  const events = [];
  checkAllUpstreams(store, progress => events.push(progress), (spec, paths) => {
    fetches++;
    assert.deepEqual(paths.sort(), ["skills/alpha", "skills/beta"]);
    return acquireGithub(spec, paths);
  });
  assert.equal(fetches, 1);
  assert.equal(state(), "current");
  assert.equal(state("beta"), "current");
  assert.equal(state("alpha", new Store(store.home)), "current");
  assert.deepEqual(events.map(p => p.completed), [0, 1, 2, 2]);
  assert.equal(events.at(-1).running, false);
  assert.equal(readFileSync(store.manifestPath("alpha"), "utf8"), before);
  const check = store.check("alpha");
  assert.equal(check.upstreamChanged, false);
  assert.equal(check.localChanged, true);
  assert.equal(check.status, "local-diverged");
});

test("remote changes are per skill, branch-aware, and clear after applying without another fetch", t => {
  const { repo, store, state, commit } = setup(t);
  store.branchNew("alpha", "custom");
  writeFileSync(join(store.workDir("alpha", "custom"), "local.md"), "custom\n");
  store.save("alpha", { branch: "custom" });
  store.workOn("alpha", "custom");
  writeFileSync(join(repo.seed, "skills/alpha/remote.md"), "new upstream\n");
  commit(repo);
  checkAllUpstreams(store);
  assert.equal(state(), "available");
  assert.equal(state("beta"), "current");
  const check = store.check("alpha");
  assert.equal(check.upstreamChanged, true);
  assert.equal(check.localChanged, true);
  assert.equal(check.status, "local-diverged");
  assert.throws(() => store.updateApply("alpha"), /local-diverged/);
  store.updateApply("alpha", { branch: "main" });
  assert.equal(state(), "available");
  store.workOn("alpha", "main");
  assert.equal(state(), "current");
  store.workOn("alpha", "custom");
  assert.equal(state(), "available");
});

test("fetch errors and missing skill paths are visible, do not abort the batch, and recover on retry", t => {
  const { repo, store, state, commit } = setup(t);
  const other = new Store(store.home);
  checkAllUpstreams(store, undefined, () => { throw new Error("offline fixture"); });
  assert.equal(state(), "failed");
  assert.match(buildOverview(other).skills[0].upstream.message, /offline fixture/);
  rmSync(join(repo.seed, "skills/alpha"), { recursive: true });
  commit(repo);
  checkAllUpstreams(store);
  assert.equal(state(), "failed");
  assert.equal(state("beta"), "current");
  writeSkill(join(repo.seed, "skills/alpha"), "alpha");
  commit(repo);
  checkAllUpstreams(store);
  assert.equal(state(), "current");
});

test("unknown baselines are not counted as updates and changing source invalidates the observation", t => {
  const { store, state } = setup(t);
  writeFileSync(join(store.workDir("alpha", "main"), "local.md"), "local\n");
  store.save("alpha");
  const m = store.status("alpha").manifest;
  delete m.branches.main.upstreamBaseVersion;
  writeFileSync(store.manifestPath("alpha"), JSON.stringify(m));
  checkAllUpstreams(store);
  assert.equal(state(), "unknown");
  assert.equal(store.check("alpha").upstreamChanged, null);
  m.upstream.requestedRef = "other";
  writeFileSync(store.manifestPath("alpha"), JSON.stringify(m));
  assert.equal(state(), undefined);
});

test("single previews refresh cached observations and a newer imported commit supersedes stale results", t => {
  const { repo, store, state, commit } = setup(t);
  checkAllUpstreams(store);
  const cache = readUpstreamCache(store);
  // Make ordering deterministic without waiting for wall-clock milliseconds.
  for (const observation of Object.values(cache)) observation.checkedAt = "2020-01-01T00:00:00.000Z";
  writeFileSync(join(store.home, "upstream-checks.json"), JSON.stringify({ schemaVersion: 1, skills: cache }));
  writeFileSync(join(repo.seed, "skills/alpha/remote.md"), "next commit\n");
  commit(repo);
  store.updateApply("alpha");
  assert.equal(state(), undefined);
  rememberCheck(store, "alpha", store.check("alpha"));
  assert.equal(state(), "current");
  writeFileSync(join(store.home, "upstream-checks.json"), "broken JSON");
  assert.equal(state(), undefined);
});

test("background job is idempotent while running and leaves the event loop responsive", async t => {
  const { store, state } = setup(t);
  const job = new UpstreamJob(store);
  const first = job.start();
  assert.equal(first.running, true);
  assert.strictEqual(job.start(), first);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(job.progress.running, true);
  const deadline = Date.now() + 15000;
  while (job.progress.running && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(job.progress.error, undefined);
  assert.equal(job.progress.running, false);
  assert.equal(job.progress.completed, 2);
  assert.equal(state(), "current");
});
