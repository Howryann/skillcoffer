import type {
  BundleDetail,
  DoctorIssue,
  DoctorReport,
  Overview,
  SkillDetail,
} from "../../src/ui/contracts";

export type {
  BundleDetail,
  DoctorIssue,
  DoctorReport,
  Overview,
  OverviewBundle,
  OverviewSkill,
  SkillDetail,
  SkillVersion,
} from "../../src/ui/contracts";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function post<T>(path: string, body: unknown = {}): Promise<T> {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const skillUrl = (id: string, suffix = "") =>
  `/api/skills/${encodeURIComponent(id)}${suffix}`;
const bundleUrl = (name: string, suffix = "") =>
  `/api/bundles/${encodeURIComponent(name)}${suffix}`;

export function fetchOverview(): Promise<Overview> {
  return request("/api/overview");
}

export function fetchDoctor(): Promise<DoctorReport> {
  return request("/api/doctor");
}

export function fixDoctorIssue(opts: {
  fix: "unlink";
  skill: string;
  path: string;
}): Promise<DoctorReport> {
  return post("/api/doctor/fix", opts);
}

export function installSkill(opts: {
  source: string;
  agent?: string;
}): Promise<{ skill: { id: string }; overview: Overview }> {
  return post("/api/install", opts);
}

export type CheckResult = {
  status: "equal" | "upstream-changed" | "local-diverged" | "unavailable";
  message: string;
  localHead?: string;
  localTreeHash?: string;
  resolvedCommit?: string;
  upstreamTreeHash?: string;
};

export type DiffResult = {
  text: string;
  leftLabel: string;
  rightLabel: string;
};

export function fetchSkill(id: string): Promise<SkillDetail> {
  return request(skillUrl(id));
}

function skillAction<T>(id: string, action: string, body?: unknown): Promise<T> {
  return post(skillUrl(id, `/${action}`), body);
}

export function saveSkill(
  id: string,
  note?: string,
): Promise<{ skill: SkillDetail; version: { id: string } }> {
  return skillAction(id, "save", note ? { note } : {});
}

export function discardSkill(id: string): Promise<{ skill: SkillDetail }> {
  return skillAction(id, "discard");
}

export function linkSkill(
  id: string,
  opts: { agent?: string; to?: string; pin?: boolean; force?: boolean },
): Promise<{ skill: SkillDetail; link: { to: string; mode: string; ref: string } }> {
  return skillAction(id, "link", opts);
}

export function unlinkSkill(id: string, to: string): Promise<{ skill: SkillDetail }> {
  return skillAction(id, "unlink", { to });
}

export function checkSkill(id: string): Promise<{ check: CheckResult; skill: SkillDetail }> {
  return skillAction(id, "check");
}

export function previewUpdate(
  id: string,
): Promise<{ check: CheckResult; diff: DiffResult | null; skill: SkillDetail }> {
  return skillAction(id, "update", { apply: false });
}

export function applyUpdate(
  id: string,
  force = false,
): Promise<{ check: CheckResult; version: { id: string }; skill: SkillDetail }> {
  return skillAction(id, "update", { apply: true, force });
}

export function restoreSkill(
  id: string,
  versionId: string,
  force = false,
): Promise<{ skill: SkillDetail }> {
  return skillAction(id, "restore", { versionId, force });
}

export function fetchDiff(
  id: string,
  opts: {
    upstream?: boolean;
    version?: string;
    left?: string;
    right?: string;
    path?: string;
  } = {},
): Promise<DiffResult> {
  const query = new URLSearchParams();
  if (opts.upstream) query.set("upstream", "1");
  if (opts.version) query.set("version", opts.version);
  if (opts.left) query.set("left", opts.left);
  if (opts.right) query.set("right", opts.right);
  if (opts.path) query.set("path", opts.path);
  const suffix = query.size ? `/diff?${query}` : "/diff";
  return request(skillUrl(id, suffix));
}

export type SkillFileEntry = { path: string; size: number };

export function fetchSkillFiles(
  id: string,
  ref = "work",
): Promise<{ ref: string; label: string; files: SkillFileEntry[] }> {
  return request(skillUrl(id, `/files?ref=${encodeURIComponent(ref)}`));
}

export type SkillFileContent = {
  ref: string;
  label: string;
  path: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  content: string | null;
};

export function fetchSkillFile(
  id: string,
  path: string,
  ref = "work",
): Promise<SkillFileContent> {
  return request(skillUrl(id, `/file?${new URLSearchParams({ path, ref })}`));
}

export function fetchBundle(name: string): Promise<BundleDetail> {
  return request(bundleUrl(name));
}

export function createBundle(name: string): Promise<BundleDetail> {
  return post("/api/bundles", { name });
}

export function addBundleMember(
  name: string,
  skill: string,
  pin = false,
): Promise<BundleDetail> {
  return post(bundleUrl(name, "/members"), { skill, pin });
}

export function setBundleMemberMode(
  name: string,
  skill: string,
  pin: boolean,
): Promise<BundleDetail> {
  return post(bundleUrl(name, `/members/${encodeURIComponent(skill)}`), { pin });
}

export function removeBundleMember(name: string, skill: string): Promise<BundleDetail> {
  return request(bundleUrl(name, `/members/${encodeURIComponent(skill)}`), {
    method: "DELETE",
  });
}

export async function deleteBundle(name: string): Promise<void> {
  await request(bundleUrl(name), { method: "DELETE" });
}
