import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Store } from "../dist/store.js";
import { buildOverview } from "../dist/ui/server.js";

function writeSkill(dir, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n`);
}

function patchManifest(store, id, patch) {
  const p = store.manifestPath(id);
  const m = JSON.parse(readFileSync(p, "utf8"));
  writeFileSync(p, JSON.stringify({ ...m, ...patch }));
}

function groupsOf(store) {
  const skills = buildOverview(store).skills;
  const groups = new Map();
  for (const s of skills) {
    const cur = groups.get(s.groupKey) ?? [];
    cur.push(s);
    groups.set(s.groupKey, cur);
  }
  return { skills, groups };
}

test("overview groups github skills by repo", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-ov-gh-"));
  try {
    writeSkill(join(root, "pdf"), "pdf");
    writeSkill(join(root, "xlsx"), "xlsx");
    writeSkill(join(root, "other"), "other");
    const store = new Store(join(root, "home"));
    store.addFromFile(join(root, "pdf"));
    store.addFromFile(join(root, "xlsx"));
    store.addFromFile(join(root, "other"));
    patchManifest(store, "pdf", {
      upstream: { remote: "github", repo: "anthropics/skills", path: "skills/pdf", requestedRef: "main" },
    });
    patchManifest(store, "xlsx", {
      upstream: { remote: "github", repo: "anthropics/skills", path: "skills/xlsx", requestedRef: "main" },
    });
    patchManifest(store, "other", {
      upstream: { remote: "github", repo: "fixture/other", path: "other", requestedRef: "main" },
    });

    const { skills, groups } = groupsOf(store);
    assert.equal(skills.find((s) => s.id === "pdf").groupKey, "anthropics/skills");
    assert.equal(skills.find((s) => s.id === "pdf").groupLabel, "anthropics/skills");
    assert.deepEqual(
      groups.get("anthropics/skills").map((s) => s.id),
      ["pdf", "xlsx"],
    );
    assert.deepEqual(
      groups.get("fixture/other").map((s) => s.id),
      ["other"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("overview groups file skills by parent directory", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-ov-file-"));
  try {
    const col = join(root, "skills");
    writeSkill(join(col, "pdf"), "pdf");
    writeSkill(join(col, "xlsx"), "xlsx");
    writeSkill(join(root, "solo", "demo"), "demo");
    const store = new Store(join(root, "home"));
    store.addFromFile(col);
    store.addFromFile(join(root, "solo", "demo"));

    const { skills, groups } = groupsOf(store);
    assert.equal(skills.find((s) => s.id === "pdf").groupKey, col);
    assert.equal(skills.find((s) => s.id === "pdf").groupLabel, col);
    assert.deepEqual(
      groups.get(col).map((s) => s.id),
      ["pdf", "xlsx"],
    );
    assert.equal(skills.find((s) => s.id === "demo").groupKey, join(root, "solo"));
    assert.equal(groups.get(join(root, "solo")).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("overview maps missing upstream to 本地 and home paths to ~", () => {
  const root = mkdtempSync(join(tmpdir(), "skillcoffer-ov-local-"));
  try {
    writeSkill(join(root, "scratch"), "scratch");
    writeSkill(join(root, "homeish"), "homeish");
    const store = new Store(join(root, "home"));
    store.addFromFile(join(root, "scratch"));
    store.addFromFile(join(root, "homeish"));
    patchManifest(store, "scratch", { upstream: undefined });
    const homeSkill = join(homedir(), "proj", "skills", "homeish");
    patchManifest(store, "homeish", { upstream: { remote: "file", sourcePath: homeSkill } });

    const { skills } = groupsOf(store);
    const scratch = skills.find((s) => s.id === "scratch");
    assert.equal(scratch.groupKey, "本地");
    assert.equal(scratch.groupLabel, "本地");
    const homeish = skills.find((s) => s.id === "homeish");
    assert.equal(homeish.groupKey, join(homedir(), "proj", "skills"));
    assert.equal(homeish.groupLabel, "~/proj/skills");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
