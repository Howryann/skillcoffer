import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { Store } from "../dist/store.js";

function writeSkill(dir, name, extra = "") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n${extra}`);
}

function git(cwd, args, config) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test("collection add installs one-level skill roots", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-collection-"));
  try {
    const col = join(root, "skills");
    writeSkill(join(col, "pdf"), "pdf", "pdf-body");
    writeSkill(join(col, "xlsx"), "xlsx", "xlsx-body");
    writeFileSync(join(col, "README.md"), "not a skill\n");

    const store = new Store(join(root, "home"));
    const result = store.addFromFile(col);
    assert.deepEqual(
      result.added.map((m) => m.localId),
      ["pdf", "xlsx"],
    );
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failed.length, 0);
    assert.equal(readFileSync(join(store.workDir("pdf", "main"), "SKILL.md"), "utf8").includes("pdf-body"), true);
    assert.equal(store.status("pdf").manifest.upstream.sourcePath, join(col, "pdf"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("nested SKILL.md under a skill root is not a second skill", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-nested-"));
  try {
    const col = join(root, "skills");
    writeSkill(join(col, "outer"), "outer");
    writeSkill(join(col, "outer", "inner"), "inner");
    writeSkill(join(col, "other"), "other");

    const store = new Store(join(root, "home"));
    const result = store.addFromFile(col);
    assert.deepEqual(
      result.added.map((m) => m.localId).sort(),
      ["other", "outer"],
    );
    assert.equal(store.hasSkill("inner"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("duplicate names in a collection fail before writing", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-dup-"));
  try {
    const col = join(root, "skills");
    writeSkill(join(col, "a"), "pdf");
    writeSkill(join(col, "b"), "pdf");
    const store = new Store(join(root, "home"));
    assert.throws(() => store.addFromFile(col), /duplicate skill name in collection: pdf/);
    assert.equal(store.hasSkill("pdf"), false);
    assert.deepEqual(store.list(), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("existing local ids are skipped and not overwritten", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-skip-"));
  try {
    const first = join(root, "first");
    writeSkill(first, "pdf", "keep-me");
    const col = join(root, "skills");
    writeSkill(join(col, "pdf"), "pdf", "new-pdf");
    writeSkill(join(col, "xlsx"), "xlsx", "xlsx-body");

    const store = new Store(join(root, "home"));
    store.addFromFile(first);
    const result = store.addFromFile(col);
    assert.deepEqual(
      result.added.map((m) => m.localId),
      ["xlsx"],
    );
    assert.deepEqual(
      result.skipped.map((s) => s.localId),
      ["pdf"],
    );
    assert.equal(readFileSync(join(store.workDir("pdf", "main"), "SKILL.md"), "utf8").includes("keep-me"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("name override is rejected for a collection", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-name-"));
  try {
    const col = join(root, "skills");
    writeSkill(join(col, "pdf"), "pdf");
    writeSkill(join(col, "xlsx"), "xlsx");
    const store = new Store(join(root, "home"));
    assert.throws(() => store.addFromFile(col, { name: "bundle" }), /name override requires a single skill/);
    assert.deepEqual(store.list(), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a broken skill in a collection does not roll back the rest", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-partial-"));
  try {
    const col = join(root, "skills");
    writeSkill(join(col, "ok"), "ok");
    writeSkill(join(col, "bad"), "bad");
    symlinkSync(join(root, "nowhere"), join(col, "bad", "link"));

    const store = new Store(join(root, "home"));
    const result = store.addFromFile(col);
    assert.deepEqual(
      result.added.map((m) => m.localId),
      ["ok"],
    );
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].path, "bad");
    assert.match(result.failed[0].error, /symlink/);
    assert.equal(store.hasSkill("ok"), true);
    assert.equal(store.hasSkill("bad"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("github collection records per-skill upstream paths", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-gh-col-"));
  const oldGlobal = process.env.GIT_CONFIG_GLOBAL;
  const oldNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  try {
    const remote = join(root, "skills.git");
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
        "https://github.com/fixture/skills.git",
      ],
      config,
    );
    process.env.GIT_CONFIG_GLOBAL = config;
    process.env.GIT_CONFIG_NOSYSTEM = "1";

    git(root, ["init", "--bare", "--initial-branch=main", remote], config);
    const seed = join(root, "seed");
    git(root, ["init", "--initial-branch=main", seed], config);
    writeSkill(join(seed, "skills", "pdf"), "pdf", "from-gh");
    writeSkill(join(seed, "skills", "xlsx"), "xlsx");
    git(seed, ["add", "."], config);
    git(seed, ["commit", "-m", "skills"], config);
    git(seed, ["remote", "add", "origin", remote], config);
    git(seed, ["push", "origin", "main"], config);

    const store = new Store(join(root, "home"));
    const result = store.addFromGithub("fixture/skills/skills");
    assert.deepEqual(
      result.added.map((m) => m.localId),
      ["pdf", "xlsx"],
    );
    const pdf = store.status("pdf").manifest;
    assert.equal(pdf.upstream.remote, "github");
    assert.equal(pdf.upstream.repo, "fixture/skills");
    assert.equal(pdf.upstream.path, "skills/pdf");
    assert.equal(pdf.upstream.requestedRef, "main");
    assert.equal(store.status("xlsx").manifest.upstream.path, "skills/xlsx");
    assert.equal(
      readFileSync(join(store.workDir("pdf", "main"), "SKILL.md"), "utf8").includes("from-gh"),
      true,
    );
  } finally {
    if (oldGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = oldGlobal;
    if (oldNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = oldNoSystem;
    rmSync(root, { recursive: true, force: true });
  }
});
