import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { acquireGithub } from "../dist/github.js";
import { Store } from "../dist/store.js";
import { buildDiff } from "../dist/ui/server.js";
import { githubFixture, writeSkill } from "./helpers/github-fixture.mjs";

test("root collection discovers nested skills with per-skill upstream paths", (t) => {
  const { root, repository } = githubFixture(t);
  const repo = repository("collection", (seed) => {
    writeFileSync(join(seed, "README.md"), "collection\n");
    writeSkill(join(seed, "skills", "alpha"));
    writeSkill(join(seed, "nested", "tools", "beta"), "beta");
  });
  for (const [index, source] of [repo.spec, `https://github.com/${repo.spec}/tree/main`].entries()) {
    const store = new Store(join(root, `home-${index}`));
    const result = store.addFromGithub(source);
    assert.equal(result.failed.length, 0);
    assert.deepEqual(result.added.map((manifest) => manifest.localId).sort(), ["alpha", "beta"]);
    assert.equal(store.status("alpha").manifest.upstream.path, "skills/alpha");
    assert.equal(store.status("beta").manifest.upstream.path, "nested/tools/beta");
    assert.equal(store.check("alpha").status, "equal");
    assert.equal(store.check("beta").status, "equal");
  }
});

test("root skill retains complete content across install, diff, update and publication", (t) => {
  const { root, repository, commit, git } = githubFixture(t);
  const repo = repository("root-skill", (seed) => {
    writeSkill(seed);
    mkdirSync(join(seed, "scripts"));
    writeFileSync(join(seed, "scripts", "helper.sh"), "#!/bin/sh\necho original\n");
    chmodSync(join(seed, "scripts", "helper.sh"), 0o755);
    mkdirSync(join(seed, "references", "nested"), { recursive: true });
    writeFileSync(join(seed, "references", "nested", "guide.md"), "reference\n");
    writeFileSync(join(seed, ".gitignore"), "*.tmp\n");
  });
  const published = repository("published");
  const store = new Store(join(root, "home"));
  assert.equal(store.addFromGithub(repo.spec).added.length, 1);
  const head = store.status("alpha").manifest.branches.main.head;
  for (const tree of [store.workDir("alpha", "main"), store.versionTree("alpha", head)]) {
    assert.equal(readFileSync(join(tree, "scripts", "helper.sh"), "utf8"), "#!/bin/sh\necho original\n");
    assert.equal(readFileSync(join(tree, "references", "nested", "guide.md"), "utf8"), "reference\n");
    assert.equal(existsSync(join(tree, ".gitignore")), true);
    assert.equal(existsSync(join(tree, ".git")), false);
    assert.notEqual(statSync(join(tree, "scripts", "helper.sh")).mode & 0o100, 0);
  }
  assert.equal(store.check("alpha").status, "equal");
  assert.match(buildDiff(store, "alpha", { upstream: true }).text, /no diff/);
  assert.equal(store.updateApply("alpha").version.id, head);

  writeFileSync(join(repo.seed, "scripts", "helper.sh"), "#!/bin/sh\necho updated\n");
  commit(repo);
  assert.equal(store.check("alpha").status, "upstream-changed");
  const diff = buildDiff(store, "alpha", { upstream: true }).text;
  assert.match(diff, /helper.sh/);
  assert.match(diff, /echo updated/);
  store.updateApply("alpha");
  assert.equal(readFileSync(join(store.workDir("alpha", "main"), "scripts", "helper.sh"), "utf8"), "#!/bin/sh\necho updated\n");
  assert.equal(store.check("alpha").status, "equal");
  assert.equal(store.publish("alpha", `${published.spec}/skills/alpha`).changed, true);
  assert.equal(git(root, "--git-dir", published.remote, "show", "main:skills/alpha/scripts/helper.sh"), "#!/bin/sh\necho updated");
});

test("root acquisition excludes checkout metadata without allowing symlink skill trees", (t) => {
  const { root, repository } = githubFixture(t);
  const repo = repository("unsafe-root", (seed) => {
    writeSkill(seed);
    symlinkSync("SKILL.md", join(seed, "link"));
  });
  const store = new Store(join(root, "home"));
  const result = store.addFromGithub(repo.spec);
  assert.equal(result.added.length, 0);
  assert.match(result.failed[0].error, /symlink not allowed/);
  assert.throws(() => acquireGithub({ repo: repo.spec, path: ".git", requestedRef: "main" }), /checkout metadata/);
});
