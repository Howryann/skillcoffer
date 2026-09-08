export type OverviewSkill = {
  id: string;
  name: string;
  description: string;
  activeBranch: string;
  dirty: boolean;
  groupKey: string;
  groupLabel: string;
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
  description: string;
  /** The CLI default remains independent of the branch being viewed. */
  activeBranch: string;
  branch: string;
  dirty: boolean;
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
  members: {
    skill: string;
    description: string;
    mode: "live" | "pin";
    ref: string;
    dirty: boolean;
    missing: boolean;
  }[];
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
