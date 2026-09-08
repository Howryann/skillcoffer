import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import test from "node:test";
import { backendPull, backendPush, backendStatus, readBackendState } from "../dist/backend.js";
import { Store } from "../dist/store.js";
import { githubFixture, writeSkill } from "./helpers/github-fixture.mjs";

test("backend sync retains the Store lock during remote operations and baseline writes", (t) => {
  const { root, repository } = githubFixture(t);
  const remote = repository("vault");
  const store = new Store(join(root, "original"));
  writeSkill(join(root, "source"));
  store.addFromFile(join(root, "source"));
  const restored = new Store(join(root, "restored"));
  const originalPath = process.env.PATH;
  const previousProbe = process.env.SKILLCOFFER_TEST_PROBE_HOME;
  const realGit = realpathSync(originalPath.split(delimiter).map((dir) => join(dir, "git")).find(existsSync));
  const bin = join(root, "bin");
  const log = join(root, "probes.log");
  mkdirSync(bin);
  const moduleUrl = new URL("../dist/store.js", import.meta.url).href;
  // Probe from an actual second process at deterministic points in the Git
  // transport, after snapshot creation and before state is committed locally.
  writeFileSync(join(bin, "git"), `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');
(async () => {
  const args = process.argv.slice(2);
  if (args[0] === 'ls-remote' || args[0] === 'push') {
    const { Store } = await import(${JSON.stringify(moduleUrl)});
    try {
      new Store(process.env.SKILLCOFFER_TEST_PROBE_HOME).bundleCreate('unexpected-writer');
      console.error('second writer entered during backend ' + args[0]);
      process.exit(91);
    } catch (error) {
      if (!error.message.includes('Store busy')) throw error;
      appendFileSync(${JSON.stringify(log)}, args[0] + '\\n');
    }
  }
  const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
})().catch(error => { console.error(error); process.exit(92); });
`, { mode: 0o755 });
  process.env.PATH = `${bin}${delimiter}${originalPath}`;
  t.after(() => {
    process.env.PATH = originalPath;
    if (previousProbe === undefined) delete process.env.SKILLCOFFER_TEST_PROBE_HOME;
    else process.env.SKILLCOFFER_TEST_PROBE_HOME = previousProbe;
  });

  process.env.SKILLCOFFER_TEST_PROBE_HOME = store.home;
  const pushed = backendPush(store, remote.spec);
  assert.equal(readBackendState(store).commit, pushed.commit);
  assert.equal(backendStatus(store).status, "synced");
  process.env.SKILLCOFFER_TEST_PROBE_HOME = restored.home;
  backendPull(restored, remote.spec);
  assert.equal(restored.hasSkill("alpha"), true);
  assert.equal(readBackendState(restored).commit, pushed.commit);

  writeFileSync(join(store.workDir("alpha", "main"), "notes.md"), "next snapshot\n");
  process.env.SKILLCOFFER_TEST_PROBE_HOME = store.home;
  const next = backendPush(store);
  process.env.SKILLCOFFER_TEST_PROBE_HOME = restored.home;
  backendPull(restored);
  assert.equal(readBackendState(restored).commit, next.commit);
  assert.equal(readFileSync(join(restored.workDir("alpha", "main"), "notes.md"), "utf8"), "next snapshot\n");
  assert.match(readFileSync(log, "utf8"), /ls-remote/);
  assert.match(readFileSync(log, "utf8"), /push/);
  assert.equal(store.hasBundle("unexpected-writer"), false);
  assert.equal(restored.hasBundle("unexpected-writer"), false);
  // The outer lock is released after both sync success and failure.
  restored.bundleCreate("after-sync");
  assert.throws(() => backendPull(restored, "fixture/other"), /already bound/);
  restored.bundleCreate("after-error");
});
