import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  Store,
  treeHashOf,
  type LinkRec,
  type Manifest,
} from "./store.js";

type SnapshotMember = {
  skill: string;
  mode: "live" | "pin";
  ref: string;
};

type SnapshotMeta = {
  schemaVersion: 1;
  bundles: { name: string; members: SnapshotMember[] }[];
};

export type StoreSnapshot = {
  dir: string;
  hash: string;
  cleanup: () => void;
};

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function copyTree(src: string, dest: string): void {
  treeHashOf(src);
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
  cpSync(src, dest, { recursive: true });
}

function snapshotBundles(store: Store, manifests: Manifest[]): SnapshotMeta["bundles"] {
  const root = store.bundlesDir();
  if (!existsSync(root)) return [];
  const skills = new Set(manifests.map((manifest) => manifest.localId));
  return readdirSync(root)
    .sort()
    .map((name) => {
      const dir = store.bundleDir(name);
      if (!lstatSync(dir).isDirectory()) throw new Error(`invalid bundle: ${name}`);
      const members = readdirSync(dir)
        .sort()
        .map((skill): SnapshotMember => {
          const leaf = join(dir, skill);
          if (!lstatSync(leaf).isSymbolicLink()) {
            throw new Error(`bundle member is not a symlink: ${name}/${skill}`);
          }
          if (!skills.has(skill)) throw new Error(`bundle references missing skill: ${skill}`);
          const target = resolve(dirname(leaf), readlinkSync(leaf));
          if (target === store.workDir(skill, "main")) {
            return { skill, mode: "live", ref: "main" };
          }
          for (const version of store.status(skill).versions) {
            if (target === store.versionTree(skill, version.id)) {
              return { skill, mode: "pin", ref: version.id };
            }
          }
          throw new Error(`bundle member has unknown target: ${name}/${skill}`);
        });
      return { name, members };
    });
}

export function createStoreSnapshot(store: Store): StoreSnapshot {
  return store.withLock(() => {
    const dir = mkdtempSync(join(tmpdir(), "skillcoffer-snapshot-"));
    const cleanup = () => rmSync(dir, { recursive: true, force: true });
    try {
      const manifests = store.list();
      mkdirSync(join(dir, "skills"), { recursive: true, mode: 0o700 });
      for (const manifest of manifests) {
        const skill = join(dir, "skills", manifest.localId);
        const status = store.status(manifest.localId);
        writeJson(join(skill, "manifest.json"), { ...manifest, links: [] });
        for (const version of status.versions) {
          const versionDir = join(skill, "versions", version.id);
          writeJson(join(versionDir, "version.json"), version);
          copyTree(store.versionTree(manifest.localId, version.id), join(versionDir, "tree"));
        }
        for (const branch of Object.keys(manifest.branches).sort()) {
          copyTree(
            store.workDir(manifest.localId, branch),
            join(skill, "branches", branch, "work"),
          );
        }
      }
      writeJson(join(dir, "snapshot.json"), {
        schemaVersion: 1,
        bundles: snapshotBundles(store, manifests),
      } satisfies SnapshotMeta);
      return { dir, hash: treeHashOf(dir), cleanup };
    } catch (error) {
      cleanup();
      throw error;
    }
  });
}

function normalizeTree(root: string, writable: boolean): void {
  chmodSync(root, 0o700);
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`symlink not allowed in snapshot: ${path}`);
    if (stat.isDirectory()) normalizeTree(path, writable);
    else if (stat.isFile()) {
      const executable = Boolean(stat.mode & 0o100);
      chmodSync(path, writable ? (executable ? 0o700 : 0o600) : executable ? 0o500 : 0o400);
    } else throw new Error(`unsupported file in snapshot: ${path}`);
  }
}

function validateStagedStore(store: Store, expectedSkillDirs: string[]): void {
  const manifests = store.list();
  if (manifests.length !== expectedSkillDirs.length) {
    throw new Error("snapshot contains invalid skill directories");
  }
  for (const manifest of manifests) {
    if (manifest.schemaVersion !== 1 || manifest.links.length || manifest.localId === "") {
      throw new Error(`invalid snapshot manifest: ${manifest.localId || "(missing id)"}`);
    }
    if (!manifest.branches[manifest.activeBranch]) {
      throw new Error(`active branch missing: ${manifest.localId}@${manifest.activeBranch}`);
    }
    const status = store.status(manifest.localId);
    const versions = new Map(status.versions.map((version) => [version.id, version]));
    const versionDirs = readdirSync(join(store.skillDir(manifest.localId), "versions")).sort();
    if (versions.size !== versionDirs.length) {
      throw new Error(`invalid version directories: ${manifest.localId}`);
    }
    for (const version of versions.values()) {
      if (treeHashOf(store.versionTree(manifest.localId, version.id)) !== version.treeHash) {
        throw new Error(`version tree hash mismatch: ${manifest.localId}/${version.id}`);
      }
      chmodSync(join(store.versionDir(manifest.localId, version.id), "version.json"), 0o600);
      normalizeTree(store.versionTree(manifest.localId, version.id), false);
    }
    for (const [branch, state] of Object.entries(manifest.branches)) {
      store.workDir(manifest.localId, branch);
      if (!versions.has(state.head)) {
        throw new Error(`branch HEAD missing: ${manifest.localId}@${branch}`);
      }
      normalizeTree(store.workDir(manifest.localId, branch), true);
    }
    chmodSync(store.manifestPath(manifest.localId), 0o600);
  }
}

function applyLocalLinks(staged: Store, links: Map<string, LinkRec[]>): void {
  for (const [skill, records] of links) {
    if (!records.length) continue;
    if (!staged.hasSkill(skill)) {
      throw new Error(`pull would remove linked skill: ${skill}`);
    }
    const status = staged.status(skill);
    const versions = new Set(status.versions.map((version) => version.id));
    for (const record of records) {
      const valid =
        record.mode === "live"
          ? Boolean(status.manifest.branches[record.ref])
          : versions.has(record.ref);
      if (!valid) throw new Error(`pull would remove linked target: ${skill}@${record.ref}`);
    }
    writeJson(staged.manifestPath(skill), { ...status.manifest, links: records });
  }
}

function stageSnapshot(snapshotDir: string, home: string, links: Map<string, LinkRec[]>): void {
  const entries = readdirSync(snapshotDir).sort();
  if (entries.join("\n") !== "skills\nsnapshot.json") {
    throw new Error("invalid snapshot root");
  }
  treeHashOf(snapshotDir);
  const meta = readJson<SnapshotMeta>(join(snapshotDir, "snapshot.json"));
  if (meta.schemaVersion !== 1 || !Array.isArray(meta.bundles)) {
    throw new Error("unsupported snapshot schema");
  }

  const skills = join(snapshotDir, "skills");
  if (!lstatSync(skills).isDirectory()) throw new Error("snapshot skills missing");
  const skillDirs = readdirSync(skills).sort();
  mkdirSync(join(home, "skills"), { recursive: true, mode: 0o700 });
  mkdirSync(join(home, "bundles"), { recursive: true, mode: 0o700 });
  const staged = new Store(home);
  for (const skill of skillDirs) {
    staged.skillDir(skill);
    const source = join(skills, skill);
    if (!lstatSync(source).isDirectory()) throw new Error(`invalid skill snapshot: ${skill}`);
    cpSync(source, staged.skillDir(skill), { recursive: true });
  }
  validateStagedStore(staged, skillDirs);

  const bundleNames = new Set<string>();
  for (const bundle of meta.bundles) {
    if (!bundle || typeof bundle.name !== "string" || !Array.isArray(bundle.members)) {
      throw new Error("invalid bundle snapshot");
    }
    if (bundleNames.has(bundle.name)) throw new Error(`duplicate bundle: ${bundle.name}`);
    bundleNames.add(bundle.name);
    const dir = staged.bundleDir(bundle.name);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const members = new Set<string>();
    for (const member of bundle.members) {
      if (members.has(member.skill)) throw new Error(`duplicate bundle member: ${member.skill}`);
      members.add(member.skill);
      if (!staged.hasSkill(member.skill)) {
        throw new Error(`bundle references missing skill: ${member.skill}`);
      }
      const manifest = staged.status(member.skill).manifest;
      let target: string;
      if (member.mode === "live" && manifest.branches[member.ref]) {
        target = staged.workDir(member.skill, member.ref);
      } else if (member.mode === "pin" && existsSync(staged.versionTree(member.skill, member.ref))) {
        target = staged.versionTree(member.skill, member.ref);
      } else {
        throw new Error(`invalid bundle target: ${bundle.name}/${member.skill}`);
      }
      symlinkSync(relative(dir, target), join(dir, member.skill));
    }
  }
  applyLocalLinks(staged, links);
}

export function validateStoreSnapshot(snapshotDir: string): string {
  const home = mkdtempSync(join(tmpdir(), "skillcoffer-validate-"));
  try {
    stageSnapshot(snapshotDir, home, new Map());
    return treeHashOf(snapshotDir);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export function restoreStoreSnapshot(store: Store, snapshotDir: string): void {
  store.withLock(() => {
    const links = new Map(store.list().map((manifest) => [manifest.localId, manifest.links]));
    const parent = dirname(store.home);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const stage = mkdtempSync(join(parent, ".skillcoffer-restore-"));
    const backup = join(stage, "backup");
    try {
      stageSnapshot(snapshotDir, stage, links);
      mkdirSync(backup, { mode: 0o700 });
      const installed: string[] = [];
      try {
        for (const name of ["skills", "bundles"]) {
          const current = join(store.home, name);
          if (existsSync(current)) renameSync(current, join(backup, name));
          renameSync(join(stage, name), current);
          installed.push(name);
        }
      } catch (error) {
        for (const name of installed.reverse()) rmSync(join(store.home, name), { recursive: true, force: true });
        for (const name of ["skills", "bundles"]) {
          const previous = join(backup, name);
          if (existsSync(previous)) renameSync(previous, join(store.home, name));
        }
        throw error;
      }
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  });
}
