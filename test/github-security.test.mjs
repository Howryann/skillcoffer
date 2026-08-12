import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseGithubSpec } from "../dist/github.js";
import { Store } from "../dist/store.js";

test("github specs reject checkout escapes and option-like refs", () => {
  assert.throws(
    () => parseGithubSpec("owner/repo/skill/../.."),
    /invalid github path/,
  );
  assert.throws(
    () => parseGithubSpec("owner/repo@--upload-pack=/tmp/helper"),
    /invalid github ref/,
  );
});

test("skill roots cannot be symbolic links", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-symlink-"));
  try {
    const target = join(root, "target");
    const source = join(root, "source");
    mkdirSync(target);
    writeFileSync(join(target, "SKILL.md"), "---\nname: escaped\n---\n");
    writeFileSync(join(target, "private.txt"), "local-only");
    symlinkSync(target, source);

    const store = new Store(join(root, "home"));
    assert.throws(() => store.addFromFile(source), /not a directory|symlink/);
    assert.equal(store.hasSkill("escaped"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
