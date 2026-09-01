import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { Store } from "../dist/store.js";

function git(cwd, args, config) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createSkill(root, name, marker) {
  const source = join(root, `source-${name}`);
  mkdirSync(source);
  writeFileSync(join(source, "SKILL.md"), `---\nname: ${name}\n---\n`);
  writeFileSync(join(source, "marker.txt"), `${marker}\n`);
  return source;
}

test("publication pushes saved HEAD and rejects external target changes", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-publication-"));
  const oldGlobal = process.env.GIT_CONFIG_GLOBAL;
  const oldNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  try {
    const remote = join(root, "publication.git");
    const emptyRemote = join(root, "empty.git");
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
        "https://github.com/fixture/publication.git",
      ],
      config,
    );
    git(
      root,
      [
        "config",
        "--file",
        config,
        `url.${pathToFileURL(emptyRemote).href}.insteadOf`,
        "https://github.com/fixture/empty.git",
      ],
      config,
    );
    process.env.GIT_CONFIG_GLOBAL = config;
    process.env.GIT_CONFIG_NOSYSTEM = "1";

    git(root, ["init", "--bare", "--initial-branch=main", remote], config);
    git(root, ["init", "--bare", "--initial-branch=main", emptyRemote], config);
    const seed = join(root, "seed");
    git(root, ["init", "--initial-branch=main", seed], config);
    writeFileSync(join(seed, "README.md"), "keep me\n");
    git(seed, ["add", "README.md"], config);
    git(seed, ["commit", "-m", "seed"], config);
    git(seed, ["remote", "add", "origin", remote], config);
    git(seed, ["push", "origin", "main"], config);

    const emptyStore = new Store(join(root, "empty-home"));
    emptyStore.addFromFile(createSkill(root, "empty-skill", "first"));
    assert.equal(
      emptyStore.publish("empty-skill", "fixture/empty/skills/empty-skill").changed,
      true,
    );
    assert.equal(
      git(root, ["--git-dir", emptyRemote, "show", "main:skills/empty-skill/marker.txt"], config),
      "first",
    );

    const store = new Store(join(root, "home"));
    store.addFromFile(createSkill(root, "review", "saved-v1"));
    writeFileSync(join(store.workDir("review", "main"), "marker.txt"), "dirty-v2\n");

    const first = store.publish("review", "fixture/publication/skills/review");
    assert.equal(first.changed, true);
    assert.equal(first.dirty, true);
    assert.equal(
      git(root, ["--git-dir", remote, "show", "main:skills/review/marker.txt"], config),
      "saved-v1",
    );
    assert.equal(git(root, ["--git-dir", remote, "show", "main:README.md"], config), "keep me");

    const blocked = new Store(join(root, "blocked"));
    blocked.addFromFile(createSkill(root, "blocked", "different"));
    assert.throws(
      () => blocked.publish("blocked", "fixture/publication/skills/review"),
      /already contains different content/,
    );
    assert.equal(blocked.status("blocked").manifest.publication, undefined);

    const consumer = new Store(join(root, "consumer"));
    consumer.addFromGithub("fixture/publication/skills/review");
    assert.equal(
      readFileSync(join(consumer.workDir("review", "main"), "marker.txt"), "utf8"),
      "saved-v1\n",
    );
    assert.equal(
      consumer.publish("review", "fixture/publication/skills/review").changed,
      false,
    );

    store.save("review");
    const second = store.publish("review");
    assert.equal(second.changed, true);
    assert.equal(second.dirty, false);
    assert.equal(
      git(root, ["--git-dir", remote, "show", "main:skills/review/marker.txt"], config),
      "dirty-v2",
    );

    store.branchNew("review", "concise");
    writeFileSync(join(store.workDir("review", "concise"), "marker.txt"), "concise\n");
    store.save("review", { branch: "concise" });
    assert.equal(store.publish("review", undefined, { branch: "concise" }).branch, "concise");
    assert.equal(
      git(root, ["--git-dir", remote, "show", "main:skills/review/marker.txt"], config),
      "concise",
    );

    const external = join(root, "external");
    git(root, ["clone", "--branch", "main", remote, external], config);
    writeFileSync(join(external, "skills", "review", "marker.txt"), "external\n");
    git(external, ["add", "skills/review/marker.txt"], config);
    git(external, ["commit", "-m", "external edit"], config);
    git(external, ["push", "origin", "main"], config);

    const baseline = store.status("review").manifest.publication;
    assert.throws(
      () => store.publish("review", undefined, { branch: "main" }),
      /publication conflict/,
    );
    assert.deepEqual(store.status("review").manifest.publication, baseline);
    assert.equal(
      git(root, ["--git-dir", remote, "show", "main:skills/review/marker.txt"], config),
      "external",
    );
    assert.equal(git(root, ["--git-dir", remote, "show", "main:README.md"], config), "keep me");
  } finally {
    if (oldGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = oldGlobal;
    if (oldNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = oldNoSystem;
    rmSync(root, { recursive: true, force: true });
  }
});
