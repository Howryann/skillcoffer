import type {
  BundleDetail,
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

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    throw new ApiError(
      body?.error || `Request failed (${res.status})`,
      res.status,
      body?.code,
    );
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
const bundleUrl = (id: string, suffix = "") =>
  `/api/bundles/${encodeURIComponent(id)}${suffix}`;
function query(opts: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(opts))
    if (value !== undefined) params.set(key, value);
  return params.size ? `?${params}` : "";
}
export const fetchOverview = (): Promise<Overview> => request("/api/overview");
export const checkUpstreams = (): Promise<NonNullable<Overview["upstreamCheck"]>> => post("/api/upstream/check");
export const fetchDoctor = (): Promise<DoctorReport> => request("/api/doctor");
export const fixDoctorIssue = (opts: {
  fix: "unlink";
  skill: string;
  path: string;
}): Promise<DoctorReport> => post("/api/doctor/fix", opts);
export type InstallResult = {
  skills: { id: string }[];
  skipped: { localId: string; reason: string }[];
  failed: { path: string; error: string }[];
  overview: Overview;
};
export const installSkill = (opts: {
  source: string;
  agent?: string;
}): Promise<InstallResult> => post("/api/install", opts);
export type CheckResult = {
  status: "equal" | "upstream-changed" | "local-diverged" | "unavailable";
  message: string;
  localHead?: string;
  localTreeHash?: string;
  resolvedCommit?: string;
  upstreamTreeHash?: string;
  upstreamChanged?: boolean | null;
  localChanged?: boolean;
};
export type DiffResult = {
  text: string;
  leftLabel: string;
  rightLabel: string;
  path?: string;
  resolvedCommit?: string;
};
export const fetchSkill = (id: string, branch?: string): Promise<SkillDetail> =>
  request(skillUrl(id, query({ branch })));
type SkillResult = { skill: SkillDetail };
export const saveSkill = (
  id: string,
  note?: string,
  branch?: string,
): Promise<SkillResult & { version: { id: string } }> =>
  post(skillUrl(id, "/save"), { note, branch });
export const discardSkill = (
  id: string,
  branch?: string,
): Promise<SkillResult> => post(skillUrl(id, "/discard"), { branch });
export type LinkOptions = {
  agent?: string;
  to?: string;
  pin?: boolean;
  force?: boolean;
  ref?: string;
  repin?: boolean;
  branch?: string;
};
export const linkSkill = (
  id: string,
  opts: LinkOptions,
): Promise<SkillResult & { link: { to: string; mode: string; ref: string } }> =>
  post(skillUrl(id, "/link"), opts);
export const unlinkSkill = (
  id: string,
  to: string,
  branch?: string,
): Promise<SkillResult> => post(skillUrl(id, "/unlink"), { to, branch });
export const checkSkill = (
  id: string,
  branch?: string,
): Promise<SkillResult & { check: CheckResult }> =>
  post(skillUrl(id, "/check"), { branch });
export type UpdatePreview = SkillResult & {
  check: CheckResult;
  diff: DiffResult | null;
};
export const previewUpdate = (
  id: string,
  branch?: string,
): Promise<UpdatePreview> =>
  post(skillUrl(id, "/update"), { apply: false, branch });
export const applyUpdate = (
  id: string,
  opts: {
    branch: string;
    force?: boolean;
    expectedCommit: string;
    expectedHead: string;
  },
): Promise<SkillResult & { check: CheckResult; version: { id: string } }> =>
  post(skillUrl(id, "/update"), { ...opts, apply: true });
export const restoreSkill = (
  id: string,
  versionId: string,
  force = false,
  branch?: string,
): Promise<SkillResult> =>
  post(skillUrl(id, "/restore"), { versionId, force, branch });
export type DiffOptions = {
  upstream?: boolean;
  version?: string;
  left?: string;
  right?: string;
  path?: string;
  branch?: string;
};
export const fetchDiff = (
  id: string,
  opts: DiffOptions = {},
): Promise<DiffResult> =>
  request(
    skillUrl(
      id,
      `/diff${query({ ...opts, upstream: opts.upstream ? "1" : undefined })}`,
    ),
  );
export type SkillFileEntry = { path: string; size: number };
export type SkillFileContent = {
  ref: string;
  label: string;
  path: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  content: string | null;
};
export const fetchSkillFiles = (
  id: string,
  ref = "work",
  branch?: string,
): Promise<{ ref: string; label: string; files: SkillFileEntry[] }> =>
  request(skillUrl(id, `/files${query({ ref, branch })}`));
export const fetchSkillFile = (
  id: string,
  path: string,
  ref = "work",
  branch?: string,
): Promise<SkillFileContent> =>
  request(skillUrl(id, `/file${query({ path, ref, branch })}`));
export const fetchBundle = (name: string): Promise<BundleDetail> =>
  request(bundleUrl(name));
export const createBundle = (name: string): Promise<BundleDetail> =>
  post("/api/bundles", { name });
export const addBundleMember = (
  name: string,
  skill: string,
  pin = false,
  ref?: string,
): Promise<BundleDetail> =>
  post(bundleUrl(name, "/members"), { skill, pin, ref });
export const setBundleMemberMode = (
  name: string,
  skill: string,
  pin: boolean,
  ref?: string,
): Promise<BundleDetail> =>
  post(bundleUrl(name, `/members/${encodeURIComponent(skill)}`), { pin, ref });
export const removeBundleMember = (
  name: string,
  skill: string,
): Promise<BundleDetail> =>
  request(bundleUrl(name, `/members/${encodeURIComponent(skill)}`), {
    method: "DELETE",
  });
export async function deleteBundle(name: string): Promise<void> {
  await request(bundleUrl(name), { method: "DELETE" });
}
