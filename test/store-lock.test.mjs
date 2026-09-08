import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Store } from "../dist/store.js";
import { writeSkill } from "./helpers/github-fixture.mjs";

const storeModule = new URL("../dist/store.js", import.meta.url).href;
function child(home, action) {
  return spawnSync(process.execPath, [
    "--input-type=module", "-e",
    `import { Store } from ${JSON.stringify(storeModule)};
     const store = new Store(process.argv[1]);
     try { ${action} } catch (error) { console.error(error.message); process.exitCode = 2; }`,
    home,
  ], { encoding: "utf8", timeout: 5000 });
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-lock-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new Store(join(root, "home"));
  writeSkill(join(root, "source"));
  store.addFromFile(join(root, "source"));
  return { root, store };
}

test("a second process cannot mutate a locked Store; retry preserves both updates", (t) => {
  const { store } = fixture(t);
  store.withLock(() => {
    store.branchNew("alpha", "first");
    const result = child(store.home, 'store.branchNew("alpha", "second");');
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Store busy/);
    assert.equal(store.status("alpha").manifest.branches.second, undefined);
  });
  const retry = child(store.home, 'store.branchNew("alpha", "second");');
  assert.equal(retry.status, 0, retry.stderr);
  assert.deepEqual(Object.keys(store.status("alpha").manifest.branches).sort(), ["first", "main", "second"]);
});

test("nested Store instances and home aliases retain the outer lock after errors", (t) => {
  const { root, store } = fixture(t);
  const alias = join(root, "alias");
  symlinkSync(store.home, alias);
  store.withLock(() => {
    const other = new Store(alias);
    other.branchNew("alpha", "nested");
    assert.throws(() => other.withLock(() => { throw new Error("inner failure"); }), /inner failure/);
    const result = child(alias, 'store.branchNew("alpha", "blocked");');
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Store busy/);
  });
  assert.throws(() => store.withLock(() => { throw new Error("outer failure"); }), /outer failure/);
  const retry = child(store.home, 'store.branchNew("alpha", "after-error");');
  assert.equal(retry.status, 0, retry.stderr);
});

test("crashed and incomplete locks fail closed until recovered with writers stopped", (t) => {
  const { store } = fixture(t);
  const lock = join(store.home, ".store-write.lock");
  const crash = child(store.home, 'store.withLock(() => process.exit(17));');
  assert.equal(crash.status, 17, crash.stderr);
  assert.equal(existsSync(lock), true);
  const record = readFileSync(lock, "utf8");
  assert.equal(typeof JSON.parse(record).pid, "number");
  assert.throws(() => store.branchNew("alpha", "blocked"), /stop all skillcoffer processes/);
  assert.equal(readFileSync(lock, "utf8"), record);
  // The child has exited and there are no other writers: documented manual recovery.
  unlinkSync(lock);
  store.branchNew("alpha", "recovered");
  writeFileSync(lock, "");
  assert.throws(() => store.withLock(() => assert.fail("entered")), /Store busy/);
  unlinkSync(lock);
  // The prototype's empty lock file must not block upgraded Stores.
  writeFileSync(join(store.home, "store.lock"), "");
  store.branchNew("alpha", "upgraded");
});
