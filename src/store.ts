import {
  createHash,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  acquireGithub,
  parseGithubSpec,
  type GithubSnapshot,
} from "./github.js";

export type LinkMode = "live" | "pin";

export type BranchState = {
  head: string;
  upstreamBaseVersion?: string;
};

export type LinkRec = {
  to: string;
  ref: string;
  mode: LinkMode;
};

export type Upstream =
  | {
      remote: "file";
      sourcePath: string;
    }
  | {
      remote: "github";
      repo: string;
      path: string;
      requestedRef: string;
    };

export type Manifest = {
  schemaVersion: 1;
  localId: string;
  name: string;
  activeBranch: string;
  upstream?: Upstream;
  branches: Record<string, BranchState>;
  links: LinkRec[];
  updatedAt: string;
};

export type VersionUpstream = {
  requestedRef: string;
  resolvedCommit: string;
};

export type VersionMeta = {
  id: string;
  treeHash: string;
  source: "file" | "local" | "upstream";
  note?: string;
  createdAt: string;
  upstream?: VersionUpstream;
};

export type CheckStatus =
  | "equal"
  | "upstream-changed"
  | "local-diverged"
  | "unavailable";

export type CheckResult = {
  status: CheckStatus;
  message: string;
  localHead?: string;
  localTreeHash?: string;
  resolvedCommit?: string;
  upstreamTreeHash?: string;
};

const LOCK_NAME = "store.lock";
const LOCAL_ID_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const VERSION_ID_RE = /^ver_[a-z0-9]+_[0-9a-f]{8}$/;

export function defaultHome(): string {
  return process.env.SKILLCOFFER_HOME?.trim() || join(homedir(), ".skillcoffer");
}

function nowIso(): string {
  return new Date().toISOString();
}

function newVersionId(): string {
  // event id, not content hash
  return `ver_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true, mode: 0o700 });
}

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

function writeJsonAtomic(p: string, data: unknown): void {
  ensureDir(dirname(p));
  const tmp = `${p}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(tmp, p);
  } finally {
    rmSync(tmp, { force: true });
  }
}

function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`symlink not allowed as skill root: ${root}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`skill root is not a directory: ${root}`);
  }
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        throw new Error(`symlink not allowed in skill tree: ${full}`);
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) out.push(full);
      else throw new Error(`unsupported file type: ${full}`);
    }
  };
  walk(root);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function treeHashOf(root: string): string {
  const h = createHash("sha256");
  for (const full of listFilesRecursive(root)) {
    const rel = relative(root, full).split(sep).join("/");
    if (rel.includes("..") || rel.startsWith("/")) {
      throw new Error(`bad path in tree: ${rel}`);
    }
    const st = statSync(full);
    const exec = (st.mode & 0o100) ? "1" : "0";
    const fileHash = createHash("sha256").update(readFileSync(full)).digest("hex");
    h.update(`${rel}\0${exec}\0${fileHash}\n`);
  }
  return h.digest("hex");
}

function copyTree(src: string, dest: string, opts: { writable?: boolean } = {}): void {
  rmSync(dest, { recursive: true, force: true });
  ensureDir(dest);
  for (const full of listFilesRecursive(src)) {
    const rel = relative(src, full);
    const target = join(dest, rel);
    ensureDir(dirname(target));
    copyFileSync(full, target);
    const mode = statSync(full).mode & 0o777;
    // Work trees add owner read/write without broadening group/other access.
    chmodSync(target, opts.writable ? mode | 0o600 : mode);
  }
}

function parseSkillName(skillRoot: string): string {
  const skillMd = join(skillRoot, "SKILL.md");
  if (!existsSync(skillMd)) throw new Error(`SKILL.md not found in ${skillRoot}`);
  const text = readFileSync(skillMd, "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error("SKILL.md missing frontmatter");
  const nameLine = m[1].split(/\r?\n/).find((l) => l.startsWith("name:"));
  if (!nameLine) throw new Error("SKILL.md frontmatter missing name");
  const name = nameLine.slice("name:".length).trim().replace(/^["']|["']$/g, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error(`invalid skill name: ${name}`);
  }
  return name;
}

function isLocalId(id: string): boolean {
  return LOCAL_ID_RE.test(id);
}

function assertLocalId(id: string): void {
  if (!isLocalId(id)) {
    throw new Error(`invalid localId: ${id}`);
  }
}

function assertVersionId(id: string): void {
  if (!VERSION_ID_RE.test(id)) {
    throw new Error(`invalid versionId: ${id}`);
  }
}

export class Store {
  readonly home: string;

  constructor(home = defaultHome()) {
    this.home = resolve(home);
  }

  skillsDir(): string {
    return join(this.home, "skills");
  }

  skillDir(localId: string): string {
    assertLocalId(localId);
    return join(this.skillsDir(), localId);
  }

  manifestPath(localId: string): string {
    return join(this.skillDir(localId), "manifest.json");
  }

  versionDir(localId: string, versionId: string): string {
    assertVersionId(versionId);
    return join(this.skillDir(localId), "versions", versionId);
  }

  versionTree(localId: string, versionId: string): string {
    return join(this.versionDir(localId, versionId), "tree");
  }

  workDir(localId: string, branch: string): string {
    assertLocalId(branch);
    return join(this.skillDir(localId), "branches", branch, "work");
  }

  withLock<T>(fn: () => T): T {
    ensureDir(this.home);
    const lockPath = join(this.home, LOCK_NAME);
    const fd = openSync(lockPath, "w", 0o600);
    try {
      // advisory lock via exclusive create loop is weak; use flock-like with O_EXCL stamp
      // Node has no flock in stable without deps — simple pid lock file for prototype
      const stamp = join(this.home, `.lock-${process.pid}`);
      writeFileSync(stamp, String(process.pid), { mode: 0o600 });
      try {
        return fn();
      } finally {
        try {
          unlinkSync(stamp);
        } catch {
          /* ignore */
        }
      }
    } finally {
      closeSync(fd);
    }
  }

  private readManifest(localId: string): Manifest {
    const p = this.manifestPath(localId);
    if (!existsSync(p)) throw new Error(`skill not found: ${localId}`);
    return readJson<Manifest>(p);
  }

  private writeManifest(m: Manifest): void {
    m.updatedAt = nowIso();
    writeJsonAtomic(this.manifestPath(m.localId), m);
  }

  private createVersionFromTree(
    localId: string,
    srcTree: string,
    meta: Omit<VersionMeta, "id" | "treeHash" | "createdAt">,
  ): VersionMeta {
    const id = newVersionId();
    const vDir = this.versionDir(localId, id);
    const tree = join(vDir, "tree");
    ensureDir(vDir);
    copyTree(srcTree, tree);
    const th = treeHashOf(tree);
    const full: VersionMeta = {
      id,
      treeHash: th,
      source: meta.source,
      note: meta.note,
      createdAt: nowIso(),
      upstream: meta.upstream,
    };
    writeJsonAtomic(join(vDir, "version.json"), full);
    // best-effort read-only tree files
    try {
      for (const f of listFilesRecursive(tree)) chmodSync(f, statSync(f).mode & ~0o222);
    } catch {
      /* ignore */
    }
    return full;
  }

  private readVersion(localId: string, versionId: string): VersionMeta {
    const p = join(this.versionDir(localId, versionId), "version.json");
    if (!existsSync(p)) throw new Error(`version not found: ${versionId}`);
    return readJson<VersionMeta>(p);
  }

  isDirty(localId: string, branch: string): boolean {
    const m = this.readManifest(localId);
    const head = m.branches[branch]?.head;
    if (!head) throw new Error(`branch not found: ${branch}`);
    const work = this.workDir(localId, branch);
    const headHash = this.readVersion(localId, head).treeHash;
    return treeHashOf(work) !== headHash;
  }

  list(): Manifest[] {
    const root = this.skillsDir();
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .filter(isLocalId)
      .filter((id) => existsSync(this.manifestPath(id)))
      .map((id) => this.readManifest(id))
      .sort((a, b) => a.localId.localeCompare(b.localId));
  }

  status(localId: string): {
    manifest: Manifest;
    dirty: Record<string, boolean>;
    versions: VersionMeta[];
  } {
    const m = this.readManifest(localId);
    const dirty: Record<string, boolean> = {};
    for (const b of Object.keys(m.branches)) dirty[b] = this.isDirty(localId, b);
    const versionsDir = join(this.skillDir(localId), "versions");
    const versions: VersionMeta[] = existsSync(versionsDir)
      ? readdirSync(versionsDir)
          .filter((id) => existsSync(join(versionsDir, id, "version.json")))
          .map((id) => this.readVersion(localId, id))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      : [];
    return { manifest: m, dirty, versions };
  }

  pathOf(localId: string, ref?: string): string {
    const m = this.readManifest(localId);
    const r = ref ?? m.activeBranch;
    if (m.branches[r]) return this.workDir(localId, r);
    if (existsSync(this.versionTree(localId, r))) return this.versionTree(localId, r);
    throw new Error(`unknown ref: ${r}`);
  }

  addFromFile(sourcePath: string, opts: { name?: string } = {}): Manifest {
    const src = resolve(sourcePath);
    return this.installSnapshot(src, {
      name: opts.name,
      source: "file",
      note: `add from ${src}`,
      upstream: { remote: "file", sourcePath: src },
    });
  }

  addFromGithub(
    specInput: string,
    opts: { name?: string; ref?: string } = {},
  ): Manifest {
    const spec = parseGithubSpec(specInput, opts.ref ?? "main");
    const snap = acquireGithub(spec);
    try {
      return this.installSnapshot(snap.treeDir, {
        name: opts.name,
        source: "upstream",
        note: `add github:${snap.repo}${snap.path ? "/" + snap.path : ""}@${snap.resolvedCommit.slice(0, 7)}`,
        upstream: {
          remote: "github",
          repo: snap.repo,
          path: snap.path,
          requestedRef: snap.requestedRef,
        },
        versionUpstream: {
          requestedRef: snap.requestedRef,
          resolvedCommit: snap.resolvedCommit,
        },
      });
    } finally {
      snap.cleanup();
    }
  }

  /** Shared install from a skill directory on disk. */
  private installSnapshot(
    src: string,
    opts: {
      name?: string;
      source: VersionMeta["source"];
      note: string;
      upstream: Upstream;
      versionUpstream?: VersionUpstream;
    },
  ): Manifest {
    return this.withLock(() => {
      if (!lstatSync(src).isDirectory()) throw new Error(`not a directory: ${src}`);
      const name = parseSkillName(src);
      const localId = opts.name ?? name;
      assertLocalId(localId);
      if (existsSync(this.manifestPath(localId))) {
        throw new Error(`skill already exists: ${localId}`);
      }

      ensureDir(this.skillDir(localId));
      const ver = this.createVersionFromTree(localId, src, {
        source: opts.source,
        note: opts.note,
        upstream: opts.versionUpstream,
      });
      copyTree(this.versionTree(localId, ver.id), this.workDir(localId, "main"), {
        writable: true,
      });
      const m: Manifest = {
        schemaVersion: 1,
        localId,
        name,
        activeBranch: "main",
        upstream: opts.upstream,
        branches: {
          main: { head: ver.id, upstreamBaseVersion: ver.id },
        },
        links: [],
        updatedAt: nowIso(),
      };
      this.writeManifest(m);
      return m;
    });
  }

  private requireGithubUpstream(m: Manifest): Extract<Upstream, { remote: "github" }> {
    if (!m.upstream || m.upstream.remote !== "github") {
      throw new Error(`skill ${m.localId} has no github upstream`);
    }
    return m.upstream;
  }

  /** Fetch upstream into temp dir; caller must cleanup. */
  fetchUpstream(localId: string): GithubSnapshot & { treeHash: string } {
    const m = this.readManifest(localId);
    const up = this.requireGithubUpstream(m);
    const snap = acquireGithub({
      repo: up.repo,
      path: up.path,
      requestedRef: up.requestedRef,
    });
    try {
      const th = treeHashOf(snap.treeDir);
      return { ...snap, treeHash: th };
    } catch (e) {
      snap.cleanup();
      throw e;
    }
  }

  check(localId: string, opts: { branch?: string } = {}): CheckResult {
    const m = this.readManifest(localId);
    if (!m.upstream || m.upstream.remote !== "github") {
      return {
        status: "unavailable",
        message: "no github upstream (file source or missing upstream)",
      };
    }
    const branch = opts.branch ?? m.activeBranch;
    const st = m.branches[branch];
    if (!st) throw new Error(`branch not found: ${branch}`);
    const headMeta = this.readVersion(localId, st.head);

    let snap: (GithubSnapshot & { treeHash: string }) | undefined;
    try {
      snap = this.fetchUpstream(localId);
    } catch (e) {
      return {
        status: "unavailable",
        message: e instanceof Error ? e.message : String(e),
        localHead: st.head,
        localTreeHash: headMeta.treeHash,
      };
    }
    try {
      const upHash = snap.treeHash;
      const base = st.upstreamBaseVersion;
      const localMoved = base !== undefined && base !== st.head;

      if (upHash === headMeta.treeHash) {
        return {
          status: "equal",
          message: "local HEAD tree matches upstream",
          localHead: st.head,
          localTreeHash: headMeta.treeHash,
          resolvedCommit: snap.resolvedCommit,
          upstreamTreeHash: upHash,
        };
      }
      if (localMoved) {
        return {
          status: "local-diverged",
          message:
            "local branch has saves after last upstream apply, and upstream tree differs — open a branch or update --force",
          localHead: st.head,
          localTreeHash: headMeta.treeHash,
          resolvedCommit: snap.resolvedCommit,
          upstreamTreeHash: upHash,
        };
      }
      return {
        status: "upstream-changed",
        message: "upstream tree differs from local HEAD",
        localHead: st.head,
        localTreeHash: headMeta.treeHash,
        resolvedCommit: snap.resolvedCommit,
        upstreamTreeHash: upHash,
      };
    } finally {
      snap.cleanup();
    }
  }

  /**
   * Hard-reset branch to a new upstream version.
   * Rejects dirty work; rejects local-diverged unless force.
   */
  updateApply(
    localId: string,
    opts: { branch?: string; force?: boolean } = {},
  ): { version: VersionMeta; check: CheckResult } {
    return this.withLock(() => {
      const m = this.readManifest(localId);
      const up = this.requireGithubUpstream(m);
      const branch = opts.branch ?? m.activeBranch;
      const st = m.branches[branch];
      if (!st) throw new Error(`branch not found: ${branch}`);
      if (this.isDirty(localId, branch)) {
        throw new Error(`dirty work on ${branch}; save or discard first`);
      }

      const snap = acquireGithub({
        repo: up.repo,
        path: up.path,
        requestedRef: up.requestedRef,
      });
      try {
        const upHash = treeHashOf(snap.treeDir);
        const headMeta = this.readVersion(localId, st.head);
        const localMoved =
          st.upstreamBaseVersion !== undefined && st.upstreamBaseVersion !== st.head;

        if (upHash === headMeta.treeHash) {
          return {
            version: headMeta,
            check: {
              status: "equal",
              message: "already equal to upstream; nothing applied",
              localHead: st.head,
              localTreeHash: headMeta.treeHash,
              resolvedCommit: snap.resolvedCommit,
              upstreamTreeHash: upHash,
            },
          };
        }
        if (localMoved && !opts.force) {
          throw new Error(
            `local-diverged: HEAD moved since last upstream apply. ` +
              `Create a branch, or pass --force to hard-reset onto upstream`,
          );
        }

        const ver = this.createVersionFromTree(localId, snap.treeDir, {
          source: "upstream",
          note: `update ${snap.repo}@${snap.resolvedCommit.slice(0, 7)}`,
          upstream: {
            requestedRef: snap.requestedRef,
            resolvedCommit: snap.resolvedCommit,
          },
        });
        copyTree(this.versionTree(localId, ver.id), this.workDir(localId, branch), {
          writable: true,
        });
        m.branches[branch] = {
          head: ver.id,
          upstreamBaseVersion: ver.id,
        };
        this.writeManifest(m);
        return {
          version: ver,
          check: {
            status: "upstream-changed",
            message: "applied upstream hard-reset",
            localHead: ver.id,
            localTreeHash: ver.treeHash,
            resolvedCommit: snap.resolvedCommit,
            upstreamTreeHash: upHash,
          },
        };
      } finally {
        snap.cleanup();
      }
    });
  }

  /** Materialize upstream tree for diff; returns path + cleanup. */
  withUpstreamTree<T>(localId: string, fn: (treeDir: string, snap: GithubSnapshot) => T): T {
    const snap = this.fetchUpstream(localId);
    try {
      return fn(snap.treeDir, snap);
    } finally {
      snap.cleanup();
    }
  }

  save(localId: string, opts: { branch?: string; note?: string } = {}): VersionMeta {
    return this.withLock(() => {
      const m = this.readManifest(localId);
      const branch = opts.branch ?? m.activeBranch;
      const st = m.branches[branch];
      if (!st) throw new Error(`branch not found: ${branch}`);
      const work = this.workDir(localId, branch);
      const headMeta = this.readVersion(localId, st.head);
      const th = treeHashOf(work);
      if (th === headMeta.treeHash) {
        return headMeta; // clean no-op return head
      }
      const ver = this.createVersionFromTree(localId, work, {
        source: "local",
        note: opts.note,
      });
      m.branches[branch] = { ...st, head: ver.id };
      this.writeManifest(m);
      return ver;
    });
  }

  restore(
    localId: string,
    versionId: string,
    opts: { branch?: string; force?: boolean } = {},
  ): Manifest {
    return this.withLock(() => {
      const m = this.readManifest(localId);
      const branch = opts.branch ?? m.activeBranch;
      const st = m.branches[branch];
      if (!st) throw new Error(`branch not found: ${branch}`);
      this.readVersion(localId, versionId); // exists
      if (!opts.force && this.isDirty(localId, branch)) {
        throw new Error(`dirty work on ${branch}; save or discard first`);
      }
      copyTree(this.versionTree(localId, versionId), this.workDir(localId, branch), {
        writable: true,
      });
      m.branches[branch] = { ...st, head: versionId };
      this.writeManifest(m);
      return m;
    });
  }

  discard(localId: string, opts: { branch?: string } = {}): void {
    this.withLock(() => {
      const m = this.readManifest(localId);
      const branch = opts.branch ?? m.activeBranch;
      const st = m.branches[branch];
      if (!st) throw new Error(`branch not found: ${branch}`);
      copyTree(this.versionTree(localId, st.head), this.workDir(localId, branch), {
        writable: true,
      });
    });
  }

  branchNew(
    localId: string,
    branchName: string,
    opts: { from?: string } = {},
  ): Manifest {
    return this.withLock(() => {
      assertLocalId(branchName);
      const m = this.readManifest(localId);
      if (m.branches[branchName]) throw new Error(`branch exists: ${branchName}`);
      let fromVer = m.branches[m.activeBranch]?.head;
      if (opts.from) {
        if (m.branches[opts.from]) fromVer = m.branches[opts.from].head;
        else {
          this.readVersion(localId, opts.from);
          fromVer = opts.from;
        }
      }
      if (!fromVer) throw new Error("no source version");
      // from HEAD tree, not dirty work
      copyTree(this.versionTree(localId, fromVer), this.workDir(localId, branchName), {
        writable: true,
      });
      m.branches[branchName] = { head: fromVer };
      this.writeManifest(m);
      return m;
    });
  }

  workOn(localId: string, branchName: string): Manifest {
    return this.withLock(() => {
      const m = this.readManifest(localId);
      if (!m.branches[branchName]) throw new Error(`branch not found: ${branchName}`);
      m.activeBranch = branchName;
      this.writeManifest(m);
      return m;
    });
  }

  private resolvePinVersion(m: Manifest, ref: string): string {
    if (m.branches[ref]) return m.branches[ref].head;
    this.readVersion(m.localId, ref);
    return ref;
  }

  private linkTarget(localId: string, link: Pick<LinkRec, "ref" | "mode">): string {
    if (link.mode === "live") {
      if (!this.readManifest(localId).branches[link.ref]) {
        throw new Error(`live ref must be a branch: ${link.ref}`);
      }
      return this.workDir(localId, link.ref);
    }
    const vid = this.resolvePinVersion(this.readManifest(localId), link.ref);
    return this.versionTree(localId, vid);
  }

  link(
    localId: string,
    to: string,
    opts: { ref?: string; pin?: boolean; force?: boolean; repin?: boolean } = {},
  ): LinkRec {
    return this.withLock(() => {
      const m = this.readManifest(localId);
      const leaf = resolve(to);
      const ref = opts.ref ?? "main";

      let finalMode: LinkMode;
      let finalRef: string;
      if (opts.repin || opts.pin || !m.branches[ref]) {
        // pin to version: branch name -> its HEAD, or explicit version id
        finalMode = "pin";
        finalRef = this.resolvePinVersion(m, ref);
      } else {
        finalMode = "live";
        finalRef = ref;
      }

      const target =
        finalMode === "live"
          ? this.workDir(localId, finalRef)
          : this.versionTree(localId, finalRef);

      if (opts.repin && !m.links.some((l) => l.to === leaf)) {
        throw new Error(`no existing link at ${leaf} to repin`);
      }

      ensureDir(dirname(leaf));
      if (this.isSymlink(leaf)) {
        const cur = readlinkSync(leaf);
        const ours =
          m.links.some((l) => l.to === leaf) || cur.includes(this.skillDir(localId));
        if (!ours && !opts.force) {
          throw new Error(`path exists (symlink): ${leaf} (use --force to replace symlink)`);
        }
        unlinkSync(leaf);
      } else if (existsSync(leaf)) {
        throw new Error(`path exists and is not a symlink: ${leaf}`);
      }

      symlinkSync(target, leaf);
      const rec: LinkRec = { to: leaf, ref: finalRef, mode: finalMode };
      m.links = m.links.filter((l) => l.to !== leaf);
      m.links.push(rec);
      this.writeManifest(m);
      return rec;
    });
  }

  private isSymlink(p: string): boolean {
    try {
      return lstatSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  }

  unlink(localId: string, to: string): void {
    this.withLock(() => {
      const m = this.readManifest(localId);
      const leaf = resolve(to);
      const rec = m.links.find((l) => l.to === leaf);
      if (!rec) throw new Error(`no link record for ${leaf}`);
      if (this.isSymlink(leaf)) {
        const target = readlinkSync(leaf);
        const absTarget = resolve(dirname(leaf), target);
        let expected = "";
        try {
          expected = this.linkTarget(localId, rec);
        } catch {
          /* head/version may be missing; still allow cleanup */
        }
        const skillRoot = this.skillDir(localId);
        const pointsAtSkill =
          (expected && (absTarget === expected || target === expected)) ||
          absTarget.startsWith(skillRoot + sep) ||
          absTarget === skillRoot ||
          target.includes(skillRoot);
        // existsSync follows symlink → false when dangling
        const dangling = !existsSync(leaf);
        if (pointsAtSkill || dangling) {
          unlinkSync(leaf);
        } else {
          throw new Error(
            `symlink at ${leaf} does not point at this skill; refuse to remove`,
          );
        }
      } else if (existsSync(leaf)) {
        throw new Error(`path exists and is not a symlink: ${leaf}`);
      }
      // missing path: only drop manifest record
      m.links = m.links.filter((l) => l.to !== leaf);
      this.writeManifest(m);
    });
  }

  remove(localId: string, opts: { force?: boolean } = {}): void {
    this.withLock(() => {
      const m = this.readManifest(localId);
      if (m.links.length && !opts.force) {
        throw new Error(`skill has links; unlink first or pass --force`);
      }
      for (const l of [...m.links]) {
        try {
          if (this.isSymlink(l.to)) unlinkSync(l.to);
        } catch {
          /* ignore */
        }
      }
      rmSync(this.skillDir(localId), { recursive: true, force: true });
    });
  }

  // ---- bundles (named groups of skills for pi --skill) ----

  bundlesDir(): string {
    return join(this.home, "bundles");
  }

  bundleDir(name: string): string {
    assertLocalId(name);
    return join(this.bundlesDir(), name);
  }

  /** Resolve skill tree path: live=main work, pin=main HEAD tree. */
  skillTarget(localId: string, opts: { pin?: boolean; branch?: string } = {}): string {
    const m = this.readManifest(localId);
    const branch = opts.branch ?? "main";
    const st = m.branches[branch];
    if (!st) throw new Error(`branch not found: ${branch}`);
    if (opts.pin) return this.versionTree(localId, st.head);
    return this.workDir(localId, branch);
  }

  hasSkill(localId: string): boolean {
    if (!isLocalId(localId)) return false;
    return existsSync(this.manifestPath(localId));
  }

  hasBundle(name: string): boolean {
    if (!isLocalId(name)) return false;
    const dir = this.bundleDir(name);
    return existsSync(dir) && statSync(dir).isDirectory();
  }

  bundleCreate(name: string): void {
    this.withLock(() => {
      assertLocalId(name);
      const dir = this.bundleDir(name);
      if (existsSync(dir)) throw new Error(`bundle exists: ${name}`);
      ensureDir(dir);
    });
  }

  bundleAdd(
    bundleName: string,
    skillId: string,
    opts: { pin?: boolean } = {},
  ): void {
    this.withLock(() => {
      assertLocalId(bundleName);
      if (!this.hasSkill(skillId)) throw new Error(`skill not found: ${skillId}`);
      const dir = this.bundleDir(bundleName);
      ensureDir(dir);
      const target = this.skillTarget(skillId, { pin: opts.pin });
      const leaf = join(dir, skillId);
      if (this.isSymlink(leaf) || existsSync(leaf)) {
        if (this.isSymlink(leaf)) unlinkSync(leaf);
        else throw new Error(`bundle member path exists and is not symlink: ${leaf}`);
      }
      symlinkSync(target, leaf);
    });
  }

  bundlePath(name: string): string {
    const dir = this.bundleDir(name);
    if (!this.hasBundle(name)) throw new Error(`bundle not found: ${name}`);
    return dir;
  }

  bundleRemoveMember(bundleName: string, skillId: string): void {
    this.withLock(() => {
      assertLocalId(bundleName);
      assertLocalId(skillId);
      if (!this.hasBundle(bundleName)) throw new Error(`bundle not found: ${bundleName}`);
      const leaf = join(this.bundleDir(bundleName), skillId);
      if (!this.isSymlink(leaf)) throw new Error(`bundle member not found: ${skillId}`);
      unlinkSync(leaf);
    });
  }

  /** Remove bundle directory (members are symlinks only; skills stay). */
  bundleRemove(bundleName: string): void {
    this.withLock(() => {
      if (!this.hasBundle(bundleName)) throw new Error(`bundle not found: ${bundleName}`);
      const dir = this.bundleDir(bundleName);
      for (const name of readdirSync(dir)) {
        const leaf = join(dir, name);
        if (this.isSymlink(leaf)) unlinkSync(leaf);
        else throw new Error(`refusing to delete non-symlink in bundle: ${leaf}`);
      }
      rmdirSync(dir);
    });
  }

  bundleList(): { name: string; members: { skill: string; mode: LinkMode }[] }[] {
    const root = this.bundlesDir();
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .filter((name) => this.hasBundle(name))
      .map((name) => {
        const dir = this.bundleDir(name);
        const members = readdirSync(dir)
          .filter((skill) => isLocalId(skill) && this.isSymlink(join(dir, skill)))
          .sort()
          .map((skill) => {
            const leaf = join(dir, skill);
            const target = resolve(dirname(leaf), readlinkSync(leaf));
            const mode: LinkMode =
              target === this.workDir(skill, "main") ? "live" : "pin";
            return { skill, mode };
          });
        return { name, members };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Paths to pass as pi --skill (bundle dir or single skill tree). */
  resolvePiSkillPaths(names: string[], opts: { pin?: boolean } = {}): string[] {
    if (!names.length) throw new Error("need at least one skill or bundle name");
    const out: string[] = [];
    for (const n of names) {
      if (this.hasBundle(n)) {
        out.push(this.bundlePath(n));
      } else if (this.hasSkill(n)) {
        out.push(this.skillTarget(n, { pin: opts.pin }));
      } else {
        throw new Error(`not a skill or bundle: ${n}`);
      }
    }
    return out;
  }

  describeVersion(v: VersionMeta, m: Manifest): string {
    const tags: string[] = [];
    for (const [b, st] of Object.entries(m.branches)) {
      if (st.head === v.id) tags.push(`HEAD ${b}`);
    }
    const tag = tags.length ? ` (${tags.join(", ")})` : "";
    return `${v.id}  ${v.createdAt.slice(0, 19)}  ${v.source}  tree:${v.treeHash.slice(0, 12)}${tag}${v.note ? `  ${v.note}` : ""}`;
  }
}

export function agentPresetPath(agent: string, localId: string): string {
  assertLocalId(localId);
  const home = homedir();
  switch (agent) {
    case "pi":
      return join(home, ".pi", "agent", "skills", localId);
    case "agents":
      return join(home, ".agents", "skills", localId);
    case "claude":
      return join(home, ".claude", "skills", localId);
    default:
      throw new Error(`unknown agent preset: ${agent} (pi|agents|claude)`);
  }
}

export function printLiveWarning(mode: LinkMode): string {
  if (mode === "live") {
    return "LIVE — edits to work apply to all sessions using this mount";
  }
  return "PINNED — frozen until you repin/relink";
}
