import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Store } from "../dist/store.js";

test("removing a bundle deletes its empty directory but keeps its skills", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-bundle-remove-"));
  try {
    const source = join(root, "source");
    mkdirSync(source);
    writeFileSync(join(source, "SKILL.md"), "---\nname: demo\n---\n");

    const store = new Store(join(root, "home"));
    store.addFromFile(source);
    store.bundleCreate("test-pack");
    store.bundleAdd("test-pack", "demo");

    store.bundleRemove("test-pack");

    assert.equal(existsSync(store.bundleDir("test-pack")), false);
    assert.equal(store.hasSkill("demo"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
