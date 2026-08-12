import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { looksLikeGithubSpec } from "../github.js";
import {
  Store,
  agentPresetPath,
  defaultHome,
  treeHashOf,
  type CheckResult,
} from "../store.js";
import type {
  BundleDetail,
  DoctorIssue,
  DoctorReport,
  Overview,
  OverviewBundle,
  OverviewSkill,
  SkillDetail,
} from "./contracts.js";

export function buildOverview(store: Store): Overview {
  const skills: OverviewSkill[] = store.list().map((m) => ({
    id: m.localId,
    name: m.name,
    dirty: Boolean(store.status(m.localId).dirty[m.activeBranch]),
  }));

  const skillDirty = new Map(skills.map((s) => [s.id, s.dirty]));
  const bundles: OverviewBundle[] = store.bundleList().map((b) => {
    let dirtyLiveCount = 0;
    for (const mem of b.members) {
      if (mem.mode === "live" && skillDirty.get(mem.skill)) dirtyLiveCount++;
    }
    return {
      name: b.name,
      memberCount: b.members.length,
      dirtyLiveCount,
    };
  });

  return { home: store.home, skills, bundles };
}

export function buildSkillDetail(store: Store, localId: string): SkillDetail {
  if (!store.hasSkill(localId)) throw Object.assign(new Error(`skill not found: ${localId}`), { code: "not_found" });
  const { manifest: m, dirty, versions } = store.status(localId);
  const activeBranch = m.activeBranch;
  const activeDirty = Boolean(dirty[activeBranch]);
  let liveCount = 0;
  let pinCount = 0;
  for (const l of m.links) {
    if (l.mode === "live") liveCount++;
    else pinCount++;
  }

  let source: SkillDetail["source"] = { kind: "none", label: "本地" };
  if (m.upstream?.remote === "file") {
    source = { kind: "file", label: m.upstream.sourcePath };
  } else if (m.upstream?.remote === "github") {
    const p = m.upstream.path ? `/${m.upstream.path}` : "";
    source = {
      kind: "github",
      label: `${m.upstream.repo}${p}@${m.upstream.requestedRef}`,
    };
  }

  const sorted = [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const mapVer = (v: (typeof versions)[number]) => {
    const heads: string[] = [];
    for (const [b, st] of Object.entries(m.branches)) {
      if (st.head === v.id) heads.push(b);
    }
    return {
      id: v.id,
      createdAt: v.createdAt,
      note: v.note,
      source: v.source,
      treeHashShort: v.treeHash.slice(0, 12),
      heads,
    };
  };
  const allVersions = sorted.slice(0, 100).map(mapVer);

  const headId = m.branches[activeBranch]?.head;
  const headMeta = headId ? versions.find((v) => v.id === headId) : undefined;

  const bundles = store
    .bundleList()
    .filter((b) => b.members.some((mem) => mem.skill === localId))
    .map((b) => b.name);

  return {
    id: m.localId,
    activeBranch,
    path: store.pathOf(localId),
    manifestPath: store.manifestPath(localId),
    source,
    activeDirty,
    links: m.links.map((l) => ({ to: l.to, ref: l.ref, mode: l.mode })),
    liveCount,
    pinCount,
    branches: Object.entries(m.branches).map(([name, st]) => ({
      name,
      head: st.head,
      dirty: Boolean(dirty[name]),
      active: name === activeBranch,
    })),
    versions: allVersions,
    versionCount: versions.length,
    bundles,
    headTreeHash: headMeta?.treeHash,
  };
}

function runDiffText(left: string, right: string): string {
  const r = spawnSync("diff", ["-ruN", left, right], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status === 0) return "(no diff — 两边一致)";
  if (r.status === 1) return r.stdout || "(diff empty)";
  throw new Error(r.stderr || `diff failed with ${r.status}`);
}

export function buildDoctor(store: Store): DoctorReport {
  const issues: DoctorIssue[] = [];
  const skills = store.list();
  for (const m of skills) {
    for (const [b, st] of Object.entries(m.branches)) {
      const tree = store.versionTree(m.localId, st.head);
      if (!existsSync(tree)) {
        issues.push({
          severity: "error",
          code: "broken_head_tree",
          message: `HEAD 树缺失 ${m.localId}@${b} ${st.head}`,
          skill: m.localId,
        });
      } else {
        try {
          const meta = JSON.parse(
            readFileSync(join(store.versionDir(m.localId, st.head), "version.json"), "utf8"),
          ) as { treeHash: string };
          const th = treeHashOf(tree);
          if (th !== meta.treeHash) {
            issues.push({
              severity: "error",
              code: "hash_mismatch",
              message: `treeHash 不匹配 ${m.localId} ${st.head}`,
              skill: m.localId,
            });
          }
        } catch (e) {
          issues.push({
            severity: "error",
            code: "version_meta",
            message: e instanceof Error ? e.message : String(e),
            skill: m.localId,
          });
        }
      }
    }
    for (const l of m.links) {
      try {
        const st = lstatSync(l.to);
        if (st.isSymbolicLink() && !existsSync(l.to)) {
          issues.push({
            severity: "error",
            code: "broken_link",
            message: `挂载 symlink 断开 ${l.to}`,
            skill: m.localId,
            path: l.to,
            fixable: "unlink",
          });
        }
      } catch {
        issues.push({
          severity: "error",
          code: "missing_link",
          message: `挂载记录存在但路径不可访问 ${l.to}`,
          skill: m.localId,
          path: l.to,
          fixable: "unlink",
        });
      }
    }
  }

  const bundlesRoot = store.bundlesDir();
  let bundleCount = 0;
  if (existsSync(bundlesRoot)) {
    for (const name of readdirSync(bundlesRoot)) {
      if (!store.hasBundle(name)) continue;
      bundleCount++;
      const dir = store.bundleDir(name);
      for (const skill of readdirSync(dir)) {
        const leaf = join(dir, skill);
        try {
          if (!lstatSync(leaf).isSymbolicLink()) {
            issues.push({
              severity: "warn",
              code: "bundle_not_symlink",
              message: `工具包成员不是 symlink: ${name}/${skill}`,
              bundle: name,
            });
            continue;
          }
          const target = resolve(dirname(leaf), readlinkSync(leaf));
          if (!existsSync(target)) {
            issues.push({
              severity: "error",
              code: "bundle_broken_member",
              message: `工具包成员断开: ${name}/${skill} → ${target}`,
              bundle: name,
              skill,
            });
          }
        } catch (e) {
          issues.push({
            severity: "error",
            code: "bundle_member",
            message: e instanceof Error ? e.message : String(e),
            bundle: name,
          });
        }
      }
    }
  }

  return {
    home: store.home,
    skillCount: skills.length,
    bundleCount,
    issues,
  };
}

/** Resolve a tree root: work | head | versionId */
export function resolveSkillTree(
  store: Store,
  localId: string,
  ref: string,
): { root: string; label: string } {
  const { manifest: m } = store.status(localId);
  const branch = m.activeBranch;
  if (ref === "work" || ref === "" || ref === "active") {
    return { root: store.workDir(localId, branch), label: `工作区 (${branch})` };
  }
  if (ref === "head") {
    const head = m.branches[branch]?.head;
    if (!head) throw Object.assign(new Error("no HEAD"), { code: "not_found" });
    return { root: store.versionTree(localId, head), label: `当前存档 ${head}` };
  }
  if (!existsSync(store.versionTree(localId, ref))) {
    throw Object.assign(new Error(`version not found: ${ref}`), { code: "not_found" });
  }
  return { root: store.versionTree(localId, ref), label: `存档 ${ref}` };
}

function safeRelPath(rel: string): string {
  const n = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!n || n.split("/").some((p) => p === ".." || p === "")) {
    throw Object.assign(new Error(`bad path: ${rel}`), { code: "bad_request" });
  }
  return n;
}

export function listSkillFiles(
  store: Store,
  localId: string,
  ref = "work",
): { ref: string; label: string; files: { path: string; size: number }[] } {
  if (!store.hasSkill(localId)) {
    throw Object.assign(new Error(`skill not found: ${localId}`), { code: "not_found" });
  }
  const { root, label } = resolveSkillTree(store, localId, ref);
  const files: { path: string; size: number }[] = [];
  const walk = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      if (st.isDirectory()) walk(full, rel);
      else if (st.isFile()) files.push({ path: rel, size: st.size });
    }
  };
  walk(root, "");
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { ref, label, files };
}

const MAX_VIEW_BYTES = 512 * 1024;

export function readSkillFile(
  store: Store,
  localId: string,
  relPath: string,
  ref = "work",
): {
  ref: string;
  label: string;
  path: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  content: string | null;
} {
  if (!store.hasSkill(localId)) {
    throw Object.assign(new Error(`skill not found: ${localId}`), { code: "not_found" });
  }
  const rel = safeRelPath(relPath);
  const { root, label } = resolveSkillTree(store, localId, ref);
  const full = join(root, ...rel.split("/"));
  const rootResolved = resolve(root) + sep;
  if (!resolve(full).startsWith(rootResolved) && resolve(full) !== resolve(root)) {
    throw Object.assign(new Error("path escapes tree"), { code: "bad_request" });
  }
  if (!existsSync(full) || !statSync(full).isFile()) {
    throw Object.assign(new Error(`file not found: ${rel}`), { code: "not_found" });
  }
  const size = statSync(full).size;
  const buf = readFileSync(full);
  // null byte heuristic for binary
  const sample = buf.subarray(0, Math.min(buf.length, 8000));
  const binary = sample.includes(0);
  if (binary) {
    return { ref, label, path: rel, size, binary: true, truncated: false, content: null };
  }
  const truncated = size > MAX_VIEW_BYTES;
  const slice = truncated ? buf.subarray(0, MAX_VIEW_BYTES) : buf;
  return {
    ref,
    label,
    path: rel,
    size,
    binary: false,
    truncated,
    content: slice.toString("utf8"),
  };
}

export function buildDiff(
  store: Store,
  localId: string,
  opts: {
    upstream?: boolean;
    /** left side version id, or "head"; default head when comparing to work */
    version?: string;
    left?: string;
    right?: string;
    path?: string;
  } = {},
): { text: string; leftLabel: string; rightLabel: string; path?: string } {
  const { manifest: m } = store.status(localId);
  const branch = m.activeBranch;
  const work = store.workDir(localId, branch);
  const filePath = opts.path ? safeRelPath(opts.path) : undefined;

  const pair = (leftRoot: string, rightRoot: string, leftLabel: string, rightLabel: string) => {
    const L = filePath ? join(leftRoot, ...filePath.split("/")) : leftRoot;
    const R = filePath ? join(rightRoot, ...filePath.split("/")) : rightRoot;
    // missing file: diff still works with -N if parent exists; if neither, message
    if (filePath && !existsSync(L) && !existsSync(R)) {
      return {
        text: `(两侧都没有文件 ${filePath})`,
        leftLabel,
        rightLabel,
        path: filePath,
      };
    }
    return {
      text: runDiffText(L, R),
      leftLabel: filePath ? `${leftLabel} · ${filePath}` : leftLabel,
      rightLabel: filePath ? `${rightLabel} · ${filePath}` : rightLabel,
      path: filePath,
    };
  };

  if (opts.upstream) {
    return store.withUpstreamTree(localId, (treeDir, snap) =>
      pair(
        treeDir,
        work,
        `上游 ${snap.repo}@${snap.resolvedCommit.slice(0, 7)}`,
        `工作区 (${branch})`,
      ),
    );
  }

  // explicit left/right refs: work | head | versionId
  if (opts.left || opts.right) {
    const left = resolveSkillTree(store, localId, opts.left ?? "head");
    const right = resolveSkillTree(store, localId, opts.right ?? "work");
    return pair(left.root, right.root, left.label, right.label);
  }

  if (opts.version) {
    const left = resolveSkillTree(store, localId, opts.version);
    return pair(left.root, work, left.label, `工作区 (${branch})`);
  }

  const head = m.branches[branch].head;
  return pair(
    store.versionTree(localId, head),
    work,
    `当前存档 ${head}`,
    `工作区 (${branch})`,
  );
}

export function buildBundleDetail(store: Store, name: string): BundleDetail {
  if (!store.hasBundle(name)) {
    throw Object.assign(new Error(`bundle not found: ${name}`), { code: "not_found" });
  }
  const listed = store.bundleList().find((b) => b.name === name);
  const members = (listed?.members ?? []).map((mem) => {
    let dirty = false;
    if (store.hasSkill(mem.skill)) {
      const st = store.status(mem.skill);
      dirty = Boolean(st.dirty[st.manifest.activeBranch]);
    }
    return { skill: mem.skill, mode: mem.mode, dirty };
  });
  const memberIds = new Set(members.map((m) => m.skill));
  const availableSkills = store
    .list()
    .map((m) => m.localId)
    .filter((id) => !memberIds.has(id));
  let dirtyLiveCount = 0;
  for (const m of members) if (m.mode === "live" && m.dirty) dirtyLiveCount++;
  return {
    name,
    path: store.bundlePath(name),
    members,
    dirtyLiveCount,
    availableSkills,
    piCommand: `skillcoffer pi ${name}`,
    piPrintCommand: `skillcoffer pi ${name} --print`,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  res.end(data);
}

function contentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".woff2":
      return "font/woff2";
    case ".map":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

/** Vite build output lives at dist/web; this file compiles to dist/ui/server.js. */
export function defaultUiDist(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "web");
}

function safeJoin(root: string, reqPath: string): string | null {
  const decoded = decodeURIComponent(reqPath.split("?")[0] || "/");
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\//, "");
  const full = normalize(join(root, rel));
  const rootResolved = resolve(root) + sep;
  if (!full.startsWith(rootResolved) && full !== resolve(root)) return null;
  return full;
}

function serveStatic(res: ServerResponse, uiRoot: string, urlPath: string): void {
  if (!existsSync(uiRoot)) {
    sendJson(res, 503, {
      error: "UI assets not built. Run: npm run build:ui",
      code: "ui_not_built",
    });
    return;
  }

  let filePath = safeJoin(uiRoot, urlPath);
  if (!filePath) {
    res.writeHead(403).end("forbidden");
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA fallback
    filePath = join(uiRoot, "index.html");
    if (!existsSync(filePath)) {
      sendJson(res, 503, { error: "UI index.html missing", code: "ui_not_built" });
      return;
    }
  }

  const body = readFileSync(filePath);
  res.writeHead(200, {
    "content-type": contentType(filePath),
    "content-length": body.length,
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  url: URL,
): Promise<void> {
  const path = url.pathname;
  const method = req.method || "GET";

  if (method === "GET" && path === "/api/overview") {
    sendJson(res, 200, buildOverview(store));
    return;
  }

  if (method === "GET" && path === "/api/doctor") {
    try {
      sendJson(res, 200, buildDoctor(store));
    } catch (e) {
      apiError(res, e);
    }
    return;
  }

  if (method === "POST" && path === "/api/doctor/fix") {
    const body = parseJsonBody(await readBody(req)) as {
      fix?: string;
      skill?: string;
      path?: string;
    };
    try {
      if (body.fix === "unlink" && body.skill && body.path) {
        store.unlink(body.skill, body.path);
        sendJson(res, 200, buildDoctor(store));
        return;
      }
      sendJson(res, 400, { error: "unsupported fix", code: "bad_request" });
    } catch (e) {
      apiError(res, e);
    }
    return;
  }

  if (method === "POST" && path === "/api/install") {
    const body = parseJsonBody(await readBody(req)) as {
      source?: string;
      agent?: string;
    };
    const source = body.source?.trim();
    if (!source) {
      sendJson(res, 400, { error: "source required", code: "bad_request" });
      return;
    }
    try {
      const m = looksLikeGithubSpec(source)
        ? store.addFromGithub(source)
        : store.addFromFile(source);
      if (body.agent) {
        store.link(m.localId, agentPresetPath(body.agent, m.localId), { ref: "main" });
      }
      sendJson(res, 201, {
        skill: buildSkillDetail(store, m.localId),
        overview: buildOverview(store),
      });
    } catch (e) {
      apiError(res, e);
    }
    return;
  }

  const skillFiles = path.match(/^\/api\/skills\/([^/]+)\/files$/);
  if (method === "GET" && skillFiles) {
    const id = decodeURIComponent(skillFiles[1]);
    try {
      const ref = url.searchParams.get("ref") ?? "work";
      sendJson(res, 200, listSkillFiles(store, id, ref));
    } catch (e) {
      apiError(res, e);
    }
    return;
  }

  const skillFile = path.match(/^\/api\/skills\/([^/]+)\/file$/);
  if (method === "GET" && skillFile) {
    const id = decodeURIComponent(skillFile[1]);
    try {
      const rel = url.searchParams.get("path") || "";
      const ref = url.searchParams.get("ref") ?? "work";
      if (!rel) {
        sendJson(res, 400, { error: "path required", code: "bad_request" });
        return;
      }
      sendJson(res, 200, readSkillFile(store, id, rel, ref));
    } catch (e) {
      apiError(res, e);
    }
    return;
  }

  const skillDiff = path.match(/^\/api\/skills\/([^/]+)\/diff$/);
  if (method === "GET" && skillDiff) {
    const id = decodeURIComponent(skillDiff[1]);
    try {
      const upstream = url.searchParams.get("upstream") === "1";
      const version = url.searchParams.get("version") ?? undefined;
      const left = url.searchParams.get("left") ?? undefined;
      const right = url.searchParams.get("right") ?? undefined;
      const filePath = url.searchParams.get("path") ?? undefined;
      sendJson(res, 200, buildDiff(store, id, { upstream, version, left, right, path: filePath }));
    } catch (e) {
      apiError(res, e);
    }
    return;
  }

  const skillAction = path.match(
    /^\/api\/skills\/([^/]+)\/(save|discard|link|unlink|check|update|restore)$/,
  );
  if (skillAction && method === "POST") {
    const id = decodeURIComponent(skillAction[1]);
    const action = skillAction[2];
    const body = parseJsonBody(await readBody(req)) as Record<string, unknown>;
    try {
      if (action === "save") {
        const note = typeof body.note === "string" ? body.note : undefined;
        const ver = store.save(id, { note });
        sendJson(res, 200, { version: ver, skill: buildSkillDetail(store, id) });
        return;
      }
      if (action === "discard") {
        store.discard(id);
        sendJson(res, 200, { skill: buildSkillDetail(store, id) });
        return;
      }
      if (action === "link") {
        const agent = typeof body.agent === "string" ? body.agent : undefined;
        const toRaw = typeof body.to === "string" ? body.to : undefined;
        const pin = Boolean(body.pin);
        const force = Boolean(body.force);
        const to = toRaw || (agent ? agentPresetPath(agent, id) : "");
        if (!to) {
          sendJson(res, 400, { error: "to or agent required", code: "bad_request" });
          return;
        }
        const rec = store.link(id, to, { pin, force });
        sendJson(res, 200, { link: rec, skill: buildSkillDetail(store, id) });
        return;
      }
      if (action === "unlink") {
        const to = typeof body.to === "string" ? body.to : "";
        if (!to) {
          sendJson(res, 400, { error: "to required", code: "bad_request" });
          return;
        }
        store.unlink(id, to);
        sendJson(res, 200, { skill: buildSkillDetail(store, id) });
        return;
      }
      if (action === "check") {
        const check: CheckResult = store.check(id);
        sendJson(res, 200, { check, skill: buildSkillDetail(store, id) });
        return;
      }
      if (action === "update") {
        const apply = Boolean(body.apply);
        const force = Boolean(body.force);
        if (!apply) {
          const check = store.check(id);
          let diff: { text: string; leftLabel: string; rightLabel: string } | null = null;
          if (check.status === "upstream-changed" || check.status === "local-diverged") {
            try {
              diff = buildDiff(store, id, { upstream: true });
            } catch (e) {
              diff = {
                text: e instanceof Error ? e.message : String(e),
                leftLabel: "upstream",
                rightLabel: "work",
              };
            }
          }
          sendJson(res, 200, { check, diff, skill: buildSkillDetail(store, id) });
          return;
        }
        const { version, check } = store.updateApply(id, { force });
        sendJson(res, 200, {
          version,
          check,
          skill: buildSkillDetail(store, id),
        });
        return;
      }
      if (action === "restore") {
        const versionId = typeof body.versionId === "string" ? body.versionId : "";
        if (!versionId) {
          sendJson(res, 400, { error: "versionId required", code: "bad_request" });
          return;
        }
        store.restore(id, versionId, { force: Boolean(body.force) });
        sendJson(res, 200, { skill: buildSkillDetail(store, id) });
        return;
      }
    } catch (e) {
      apiError(res, e);
    }
    return;
  }

  const skillMatch = path.match(/^\/api\/skills\/([^/]+)$/);
  if (method === "GET" && skillMatch) {
    const id = decodeURIComponent(skillMatch[1]);
    try {
      sendJson(res, 200, buildSkillDetail(store, id));
    } catch (e) {
      apiError(res, e);
    }
    return;
  }

  // POST /api/bundles  { name }
  if (method === "POST" && path === "/api/bundles") {
    const body = parseJsonBody(await readBody(req)) as { name?: string };
    if (!body.name?.trim()) {
      sendJson(res, 400, { error: "name required", code: "bad_request" });
      return;
    }
    try {
      store.bundleCreate(body.name.trim());
      sendJson(res, 201, buildBundleDetail(store, body.name.trim()));
    } catch (e) {
      apiError(res, e);
    }
    return;
  }

  const bundleMemberMatch = path.match(/^\/api\/bundles\/([^/]+)\/members(?:\/([^/]+))?$/);
  if (bundleMemberMatch) {
    const bname = decodeURIComponent(bundleMemberMatch[1]);
    const skillId = bundleMemberMatch[2] ? decodeURIComponent(bundleMemberMatch[2]) : undefined;
    if (method === "POST" && !skillId) {
      const body = parseJsonBody(await readBody(req)) as { skill?: string; pin?: boolean };
      if (!body.skill?.trim()) {
        sendJson(res, 400, { error: "skill required", code: "bad_request" });
        return;
      }
      try {
        store.bundleAdd(bname, body.skill.trim(), { pin: Boolean(body.pin) });
        sendJson(res, 200, buildBundleDetail(store, bname));
      } catch (e) {
        apiError(res, e);
      }
      return;
    }
    if (method === "DELETE" && skillId) {
      try {
        store.bundleRemoveMember(bname, skillId);
        sendJson(res, 200, buildBundleDetail(store, bname));
      } catch (e) {
        apiError(res, e);
      }
      return;
    }
    // POST .../members/:skill with { pin } to re-link mode
    if (method === "POST" && skillId) {
      const body = parseJsonBody(await readBody(req)) as { pin?: boolean };
      try {
        store.bundleAdd(bname, skillId, { pin: Boolean(body.pin) });
        sendJson(res, 200, buildBundleDetail(store, bname));
      } catch (e) {
        apiError(res, e);
      }
      return;
    }
  }

  const bundleMatch = path.match(/^\/api\/bundles\/([^/]+)$/);
  if (bundleMatch) {
    const bname = decodeURIComponent(bundleMatch[1]);
    if (method === "GET") {
      try {
        sendJson(res, 200, buildBundleDetail(store, bname));
      } catch (e) {
        apiError(res, e);
      }
      return;
    }
    if (method === "DELETE") {
      try {
        store.bundleRemove(bname);
        sendJson(res, 200, { ok: true });
      } catch (e) {
        apiError(res, e);
      }
      return;
    }
  }

  // drain unused body
  if (method !== "GET" && method !== "HEAD") await readBody(req);
  sendJson(res, 404, { error: `not found: ${method} ${path}`, code: "not_found" });
}

function parseJsonBody(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function apiError(res: ServerResponse, e: unknown): void {
  const err = e as Error & { code?: string };
  const msg = err instanceof Error ? err.message : String(e);
  if (err.code === "not_found" || /not found/.test(msg)) {
    sendJson(res, 404, { error: msg, code: "not_found" });
    return;
  }
  if (/exists|required|invalid|refusing/.test(msg)) {
    sendJson(res, 400, { error: msg, code: "bad_request" });
    return;
  }
  sendJson(res, 500, { error: msg, code: "internal" });
}

export type StartUiOptions = {
  port?: number;
  open?: boolean;
  home?: string;
};

export function startUi(opts: StartUiOptions = {}): void {
  const port = opts.port ?? 7526;
  const host = "127.0.0.1";
  const home = opts.home ?? defaultHome();
  const uiDist = defaultUiDist();
  const store = new Store(home);

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url || "/", `http://${host}:${port}`);
        if (url.pathname.startsWith("/api/")) {
          await handleApi(req, res, store, url);
          return;
        }
        serveStatic(res, uiDist, url.pathname);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!res.headersSent) sendJson(res, 500, { error: msg, code: "internal" });
        else res.end();
      }
    })();
  });

  server.listen(port, host, () => {
    const url = `http://${host}:${port}`;
    console.log(`skillcoffer ui  ${url}`);
    console.log(`store         ${home}`);
    if (!existsSync(uiDist)) {
      console.log(`warn: UI assets missing at ${uiDist} — run npm run build:ui`);
    }
    if (opts.open) openBrowser(url);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`error: port ${port} in use — try --port <other>`);
      process.exit(2);
    }
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
}

function openBrowser(url: string): void {
  const plat = process.platform;
  const cmd = plat === "darwin" ? "open" : plat === "win32" ? "cmd" : "xdg-open";
  const args = plat === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}
