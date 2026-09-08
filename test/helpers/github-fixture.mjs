import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function writeSkill(dir, name = "alpha") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\nSkill ${name}\n`);
}

/** All GitHub URLs resolve to local bare repositories; never uses credentials/network. */
export function githubFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-regression-"));
  const config = join(root, "gitconfig");
  writeFileSync(config, '[user]\n name = Skillcoffer Test\n email = test@skillcoffer.local\n');
  const previous = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  };
  process.env.GIT_CONFIG_GLOBAL = config;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  const git = (cwd, ...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  const commit = (repo, message = "change") => {
    git(repo.seed, "add", ".");
    git(repo.seed, "commit", "-m", message);
    git(repo.seed, "push", "origin", "main");
    return git(repo.seed, "rev-parse", "HEAD");
  };
  const repository = (name, seedFiles) => {
    const remote = join(root, `${name}.git`);
    const seed = join(root, `seed-${name}`);
    const spec = `fixture/${name}`;
    git(root, "init", "--bare", "--initial-branch=main", remote);
    git(root, "config", "--file", config, `url.${pathToFileURL(remote).href}.insteadOf`, `https://github.com/${spec}.git`);
    git(root, "init", "--initial-branch=main", seed);
    git(seed, "remote", "add", "origin", remote);
    const repo = { remote, seed, spec };
    if (seedFiles) {
      seedFiles(seed);
      commit(repo, "seed");
    }
    return repo;
  };
  return { root, git, commit, repository };
}
