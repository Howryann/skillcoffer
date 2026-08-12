import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { Store, defaultHome } from "../dist/store.js";

function createSkill(root, id, marker) {
  const dir = join(root, `src-${id}`);
  mkdirSync(dir);
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${id}\n---\n`);
  writeFileSync(join(dir, "marker.txt"), marker);
  return dir;
}

test("default home uses the skillcoffer contract", () => {
  const before = process.env.SKILLCOFFER_HOME;
  try {
    delete process.env.SKILLCOFFER_HOME;
    assert.equal(defaultHome(), join(homedir(), ".skillcoffer"));
    process.env.SKILLCOFFER_HOME = "/tmp/custom-skillcoffer";
    assert.equal(defaultHome(), "/tmp/custom-skillcoffer");
  } finally {
    if (before === undefined) delete process.env.SKILLCOFFER_HOME;
    else process.env.SKILLCOFFER_HOME = before;
  }
});

test("store identifiers cannot escape their roots", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-paths-"));
  try {
    const home = join(root, "home");
    const otherHome = join(root, "other-home");
    const store = new Store(home);
    new Store(otherHome).addFromFile(createSkill(root, "hidden", "hidden"));

    const forgedId = relative(
      join(home, "skills"),
      join(otherHome, "skills", "hidden"),
    );
    assert.equal(store.hasSkill(forgedId), false);
    assert.throws(() => store.status(forgedId), /invalid localId/);

    const victim = join(root, "victim");
    mkdirSync(victim);
    symlinkSync(join(root, "target"), join(victim, "link"));
    assert.throws(
      () => store.bundleRemoveMember("../../victim", "link"),
      /invalid localId/,
    );
    assert.equal(lstatSync(join(victim, "link")).isSymbolicLink(), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restore accepts only versions owned by the selected skill", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-restore-"));
  try {
    const store = new Store(join(root, "home"));
    const alpha = store.addFromFile(createSkill(root, "alpha", "alpha"));
    const beta = store.addFromFile(createSkill(root, "beta", "beta"));
    const injected = `../../beta/versions/${beta.branches.main.head}`;

    assert.throws(
      () => store.restore("alpha", injected, { force: true }),
      /invalid versionId/,
    );
    assert.equal(
      readFileSync(join(store.workDir("alpha", "main"), "marker.txt"), "utf8"),
      "alpha",
    );
    assert.equal(store.status("alpha").manifest.branches.main.head, alpha.branches.main.head);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
