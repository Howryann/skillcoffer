export type OverviewSkill = {
  id: string;
  name: string;
  dirty: boolean;
};

export type OverviewBundle = {
  name: string;
  memberCount: number;
  dirtyLiveCount: number;
};

export type Overview = {
  home: string;
  skills: OverviewSkill[];
  bundles: OverviewBundle[];
};

export type SkillVersion = {
  id: string;
  createdAt: string;
  note?: string;
  source: string;
  treeHashShort: string;
  heads: string[];
};

export type SkillDetail = {
  id: string;
  activeBranch: string;
  path: string;
  manifestPath: string;
  source: { kind: "file" | "github" | "none"; label: string };
  activeDirty: boolean;
  links: { to: string; ref: string; mode: "live" | "pin" }[];
  liveCount: number;
  pinCount: number;
  branches: { name: string; head: string; dirty: boolean; active: boolean }[];
  versions: SkillVersion[];
  versionCount: number;
  bundles: string[];
  headTreeHash?: string;
};

export type BundleDetail = {
  name: string;
  path: string;
  members: { skill: string; mode: "live" | "pin"; dirty: boolean }[];
  dirtyLiveCount: number;
  availableSkills: string[];
  piCommand: string;
  piPrintCommand: string;
};

export type DoctorIssue = {
  severity: "error" | "warn";
  code: string;
  message: string;
  skill?: string;
  bundle?: string;
  path?: string;
  fixable?: "unlink";
};

export type DoctorReport = {
  home: string;
  skillCount: number;
  bundleCount: number;
  issues: DoctorIssue[];
};
