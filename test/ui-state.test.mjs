import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Store } from "../dist/store.js";
import {
  buildOverview,
  buildSkillDetail,
  buildBundleDetail,
  buildDiff,
  listSkillFiles,
  readSkillFile,
} from "../dist/ui/server.js";

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "skco-ui-state-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  mkdirSync(source);
  writeFileSync(
    join(source, "SKILL.md"),
    "---\nname: alpha\ndescription: >-\n  Clear interfaces\n  and useful modules.\n---\n\n# Alpha\n",
  );
  writeFileSync(join(source, "notes.md"), "Original notes\n");
  const store = new Store(join(root, "store"));
  store.addFromFile(source);
  store.branchNew("alpha", "experiment");
  store.workOn("alpha", "experiment");
  store.bundleCreate("kit");
  store.bundleAdd("kit", "alpha");
  return { root, store };
}

test("UI reads the selected branch without changing the CLI default", (t) => {
  const { store } = setup(t);
  writeFileSync(
    join(store.workDir("alpha", "experiment"), "notes.md"),
    "Experiment\n",
  );
  writeFileSync(
    join(store.workDir("alpha", "experiment"), "extra.md"),
    "Extra\n",
  );
  const detail = buildSkillDetail(store, "alpha", "main");
  assert.equal(detail.description, "Clear interfaces and useful modules.");
  assert.equal(detail.branch, "main");
  assert.equal(detail.dirty, false);
  assert.equal(detail.activeBranch, "experiment");
  assert.equal(detail.activeDirty, true);
  assert.equal(detail.path, store.workDir("alpha", "main"));
  assert.equal(
    readSkillFile(store, "alpha", "notes.md", "work", "main").content,
    "Original notes\n",
  );
  assert.equal(
    readSkillFile(store, "alpha", "notes.md", "work", "experiment").content,
    "Experiment\n",
  );
  assert.equal(listSkillFiles(store, "alpha", "work", "main").files.length, 2);
  assert.equal(
    listSkillFiles(store, "alpha", "work", "experiment").files.length,
    3,
  );
  assert.match(buildDiff(store, "alpha", { branch: "main" }).text, /两边一致/);
  assert.match(
    buildDiff(store, "alpha", { branch: "experiment" }).text,
    /Experiment/,
  );
  assert.throws(
    () => buildSkillDetail(store, "alpha", "absent"),
    /branch not found/,
  );
  assert.equal(store.status("alpha").manifest.activeBranch, "experiment");
});

test("Bundle state follows its actual live target, including non-default branches", (t) => {
  const { store } = setup(t);
  writeFileSync(
    join(store.workDir("alpha", "main"), "notes.md"),
    "Main changed\n",
  );
  assert.equal(buildOverview(store).skills[0].dirty, false);
  assert.equal(buildOverview(store).bundles[0].dirtyLiveCount, 1);
  assert.equal(buildBundleDetail(store, "kit").members[0].ref, "main");
  assert.equal(buildBundleDetail(store, "kit").members[0].dirty, true);

  store.discard("alpha", { branch: "main" });
  writeFileSync(
    join(store.workDir("alpha", "experiment"), "notes.md"),
    "Experiment changed\n",
  );
  assert.equal(buildOverview(store).skills[0].dirty, true);
  assert.equal(buildOverview(store).bundles[0].dirtyLiveCount, 0);
  assert.equal(buildBundleDetail(store, "kit").dirtyLiveCount, 0);
  store.bundleAdd("kit", "alpha", { ref: "experiment" });
  assert.equal(store.bundleList()[0].members[0].mode, "live");
  assert.equal(buildBundleDetail(store, "kit").members[0].ref, "experiment");
  assert.equal(buildBundleDetail(store, "kit").dirtyLiveCount, 1);
});

test("restoring a removed pinned member preserves the exact version after HEAD moves", (t) => {
  const { store } = setup(t);
  store.bundleAdd("kit", "alpha", { pin: true });
  const member = buildBundleDetail(store, "kit").members[0];
  const target = readlinkSync(join(store.bundlePath("kit"), "alpha"));
  store.bundleRemoveMember("kit", "alpha");
  writeFileSync(
    join(store.workDir("alpha", "main"), "notes.md"),
    "New saved main\n",
  );
  store.save("alpha", { branch: "main" });
  store.bundleAdd("kit", "alpha", { pin: true, ref: member.ref });
  assert.equal(readlinkSync(join(store.bundlePath("kit"), "alpha")), target);
  assert.equal(
    readFileSync(join(target, "notes.md"), "utf8"),
    "Original notes\n",
  );
  assert.equal(buildBundleDetail(store, "kit").members[0].ref, member.ref);
  assert.equal(buildBundleDetail(store, "kit").members[0].dirty, false);
  assert.match(
    buildBundleDetail(store, "kit").piCommand,
    /^SKILLCOFFER_HOME='/,
  );
});

test("invalid edited frontmatter does not make the resource library unavailable", (t) => {
  const { store } = setup(t);
  writeFileSync(
    join(store.workDir("alpha", "experiment"), "SKILL.md"),
    "---\nname: alpha\ndescription: [broken\n---\n",
  );
  assert.equal(buildOverview(store).skills[0].description, "");
  assert.equal(buildSkillDetail(store, "alpha").dirty, true);
});
