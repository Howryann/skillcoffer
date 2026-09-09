import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { acquireGithub, type GithubSnapshot } from "./github.js";
import { withStoreLock } from "./lock.js";
import { Store, treeHashOf, type CheckResult, type Manifest } from "./store.js";

type GithubUpstream = Extract<NonNullable<Manifest["upstream"]>, { remote: "github" }>;
export type UpstreamObservation = {
  source: GithubUpstream;
  checkedAt: string;
  treeHash?: string;
  resolvedCommit?: string;
  error?: string;
};
export type UpstreamCache = Record<string, UpstreamObservation>;
export type UpstreamSummary = {
  status: "available" | "current" | "failed" | "unknown";
  checkedAt: string;
  message: string;
};
export type UpstreamProgress = {
  running: boolean;
  completed: number;
  total: number;
  error?: string;
};
const cachePath = (store: Store) => join(store.home, "upstream-checks.json");
const sameSource = (a: GithubUpstream, b: GithubUpstream) =>
  a.repo === b.repo && a.path === b.path && a.requestedRef === b.requestedRef;

/** Machine-local observations, deliberately excluded from portable snapshots. */
export function readUpstreamCache(store: Store): UpstreamCache {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(store), "utf8"));
    if (parsed.schemaVersion !== 1 || !parsed.skills || typeof parsed.skills !== "object") return {};
    return Object.fromEntries(Object.entries(parsed.skills).filter(([, value]) => {
      const r = value as UpstreamObservation | null;
      return r && r.source?.remote === "github" && typeof r.source.repo === "string" &&
        typeof r.source.path === "string" && typeof r.source.requestedRef === "string" &&
        typeof r.checkedAt === "string" && Number.isFinite(Date.parse(r.checkedAt)) &&
        (typeof r.error === "string" || (typeof r.treeHash === "string" && typeof r.resolvedCommit === "string"));
    })) as UpstreamCache;
  } catch {
    return {};
  }
}

export function rememberUpstream(store: Store, id: string, observation: UpstreamObservation): void {
  withStoreLock(store.home, () => {
    const skills = readUpstreamCache(store);
    if (skills[id]?.checkedAt > observation.checkedAt) return;
    skills[id] = observation;
    const path = cachePath(store);
    const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, skills }) + "\n", { mode: 0o600, flag: "wx" });
      renameSync(tmp, path);
    } finally {
      rmSync(tmp, { force: true });
    }
  });
}

export function rememberCheck(store: Store, id: string, result: CheckResult): void {
  const source = store.status(id).manifest.upstream;
  if (source?.remote !== "github") return;
  // Cache maintenance must not turn a successful update into an API failure.
  try {
    rememberUpstream(store, id, {
      source,
      checkedAt: new Date().toISOString(),
      treeHash: result.upstreamTreeHash,
      resolvedCommit: result.resolvedCommit,
      error: result.status === "unavailable" ? result.message : undefined,
    });
  } catch (error) {
    console.warn("Could not cache upstream check:", error instanceof Error ? error.message : String(error));
  }
}

/** Re-evaluate cached remote content against the current branch, including after save/update/restore. */
export function upstreamSummary(
  store: Store,
  { manifest, versions }: Pick<ReturnType<Store["status"]>, "manifest" | "versions">,
  cache: UpstreamCache,
  { branch = manifest.activeBranch }: { branch?: string } = {},
): UpstreamSummary | undefined {
  const source = manifest.upstream;
  const observation = cache[manifest.localId];
  if (source?.remote !== "github" || !observation || !sameSource(source, observation.source)) return;
  const { checkedAt, error, treeHash, resolvedCommit } = observation;
  const baseId = manifest.branches[branch].upstreamBaseVersion;
  if (baseId) {
    const base = versions.find(v => v.id === baseId);
    // A newer import supersedes an older observation (e.g. an update from another CLI).
    if (base && base.createdAt > checkedAt && base.upstream?.resolvedCommit !== resolvedCommit) return;
  }
  if (error !== undefined) return { status: "failed", checkedAt, message: error };
  const check = store.compareUpstream(manifest.localId, treeHash!, resolvedCommit!, { branch });
  return {
    status: check.status === "equal" ? "current"
      : check.upstreamChanged === null ? "unknown"
        : check.upstreamChanged ? "available" : "current",
    checkedAt,
    message: check.upstreamChanged === null && check.status !== "equal"
      ? "缺少上次导入的基线，请查看上游差异。"
      : check.message,
  };
}

/** One fetch per repository/ref; failures remain per skill and never stop other repositories. */
export function checkAllUpstreams(
  store: Store,
  onProgress: (progress: UpstreamProgress) => void = () => {},
  acquire: typeof acquireGithub = acquireGithub,
): UpstreamProgress {
  const groups = new Map<string, { id: string; source: GithubUpstream }[]>();
  for (const m of store.list()) {
    if (m.upstream?.remote !== "github") continue;
    const key = JSON.stringify([m.upstream.repo, m.upstream.requestedRef]);
    const group = groups.get(key) ?? [];
    group.push({ id: m.localId, source: m.upstream });
    groups.set(key, group);
  }
  const progress: UpstreamProgress = {
    running: true, completed: 0,
    total: [...groups.values()].reduce((sum, group) => sum + group.length, 0),
  };
  onProgress({ ...progress });
  for (const group of groups.values()) {
    let snapshot: GithubSnapshot | undefined;
    let fetchError: string | undefined;
    const checkedAt = new Date().toISOString();
    try {
      const { repo, requestedRef } = group[0].source;
      snapshot = acquire({ repo, requestedRef, path: "" }, [...new Set(group.map(s => s.source.path))]);
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e);
    }
    try {
      for (const { id, source } of group) {
        const observation: UpstreamObservation = { source, checkedAt };
        try {
          if (!snapshot) throw new Error(fetchError);
          const candidate = join(snapshot.treeDir, source.path);
          // Validate every selected path, including symlinked ancestors.
          const rel = relative(realpathSync(snapshot.treeDir), realpathSync(candidate));
          if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
            throw new Error("github path escapes checkout");
          if (!lstatSync(join(candidate, "SKILL.md")).isFile()) throw new Error("SKILL.md not found");
          observation.treeHash = treeHashOf(candidate);
          observation.resolvedCommit = snapshot.resolvedCommit;
        } catch (e) {
          observation.error = (e as NodeJS.ErrnoException).code === "ENOENT"
            ? "上游中找不到这个 Skill，可能已移动或删除。"
            : e instanceof Error ? e.message : String(e);
        }
        rememberUpstream(store, id, observation);
        progress.completed++;
        onProgress({ ...progress });
      }
    } finally {
      snapshot?.cleanup();
    }
  }
  progress.running = false;
  onProgress({ ...progress });
  return progress;
}
