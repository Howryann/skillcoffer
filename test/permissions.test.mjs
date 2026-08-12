import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Store } from "../dist/store.js";

const modeOf = (path) => statSync(path).mode & 0o777;

test(
  "private source permissions remain private in the store",
  { skip: process.platform === "win32" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "skillcoffer-modes-"));
    try {
      const source = join(root, "source");
      const home = join(root, "home");
      mkdirSync(source, { mode: 0o700 });
      writeFileSync(join(source, "SKILL.md"), "---\nname: private-skill\n---\n");
      writeFileSync(join(source, "secret.txt"), "secret");
      chmodSync(join(source, "SKILL.md"), 0o600);
      chmodSync(join(source, "secret.txt"), 0o600);

      const store = new Store(home);
      const manifest = store.addFromFile(source);
      const workSecret = join(store.workDir("private-skill", "main"), "secret.txt");
      const versionSecret = join(
        store.versionTree("private-skill", manifest.branches.main.head),
        "secret.txt",
      );

      assert.equal(modeOf(home) & 0o077, 0);
      assert.equal(modeOf(store.manifestPath("private-skill")), 0o600);
      assert.equal(modeOf(workSecret), 0o600);
      assert.equal(modeOf(versionSecret) & 0o077, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
