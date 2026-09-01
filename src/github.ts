import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, sep } from "node:path";

export type GithubSpec = {
  repo: string; // owner/name
  path: string; // skill subdir, may be ""
  requestedRef: string;
};

export type GithubSnapshot = {
  treeDir: string; // absolute path to skill root with SKILL.md
  cleanup: () => void;
  repo: string;
  path: string;
  requestedRef: string;
  resolvedCommit: string;
};

export type GithubPublicationResult = {
  commit: string;
  treeOid: string;
  changed: boolean;
};

function runGit(args: string[], cwd?: string): { code: number; out: string; err: string } {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return {
    code: r.status ?? 1,
    out: (r.stdout || "").trim(),
    err: (r.stderr || "").trim(),
  };
}

function checkedGithubSpec(
  repo: string,
  path: string,
  requestedRef: string,
): GithubSpec {
  if (!requestedRef || requestedRef.startsWith("-") || /[\0\r\n]/.test(requestedRef)) {
    throw new Error(`invalid github ref: ${requestedRef}`);
  }
  if (
    path &&
    path
      .split("/")
      .some((part) => !part || part === "." || part === ".." || /[\\\0\r\n]/.test(part))
  ) {
    throw new Error(`invalid github path: ${path}`);
  }
  return { repo, path, requestedRef };
}

/** Parse owner/repo[/path] or github URL into repo+path. */
export function parseGithubSpec(input: string, ref = "main"): GithubSpec {
  let s = input.trim();
  let requestedRef = ref;

  // https://github.com/owner/repo[/tree/ref/path]
  const url = s.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.*))?)?\/?$/i,
  );
  if (url) {
    const owner = url[1];
    const name = url[2].replace(/\.git$/, "");
    if (url[3]) requestedRef = url[3];
    const path = (url[4] || "").replace(/\/SKILL\.md$/i, "").replace(/\/$/, "");
    return checkedGithubSpec(`${owner}/${name}`, path, requestedRef);
  }

  // owner/repo[/path...]  or owner/repo@ref
  s = s.replace(/^github:/i, "");
  const at = s.match(/^([^@]+)@([^@]+)$/);
  if (at) {
    s = at[1];
    requestedRef = at[2];
  }

  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`invalid github spec: ${input} (want owner/repo[/path])`);
  }
  const repo = `${parts[0]}/${parts[1].replace(/\.git$/, "")}`;
  let path = parts.slice(2).join("/");
  path = path.replace(/\/SKILL\.md$/i, "").replace(/\/$/, "");
  return checkedGithubSpec(repo, path, requestedRef);
}

export function looksLikeGithubSpec(input: string): boolean {
  if (/^https?:\/\/github\.com\//i.test(input)) return true;
  if (/^github:/i.test(input)) return true;
  // owner/repo... but not a local path that exists
  if (existsSync(input)) return false;
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/|$)/.test(input)) return true;
  return false;
}

/**
 * Public repo only: resolve ref -> commit, sparse shallow fetch path.
 * Caller must call cleanup().
 */
export function acquireGithub(spec: GithubSpec): GithubSnapshot {
  spec = checkedGithubSpec(spec.repo, spec.path, spec.requestedRef);
  if (runGit(["--version"]).code !== 0) {
    throw new Error("git not found; required for GitHub source");
  }

  const url = `https://github.com/${spec.repo}.git`;
  const tmp = mkdtempSync(join(tmpdir(), "skillcoffer-gh-"));
  const cleanup = () => {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  try {
    let r = runGit(["init"], tmp);
    if (r.code !== 0) throw new Error(`git init failed: ${r.err}`);

    r = runGit(["remote", "add", "origin", url], tmp);
    if (r.code !== 0) throw new Error(`git remote add failed: ${r.err}`);

    // Fetch only the requested ref (branch/tag/commit-ish), depth 1
    r = runGit(
      ["fetch", "--depth", "1", "--filter=blob:none", "origin", spec.requestedRef],
      tmp,
    );
    if (r.code !== 0) {
      // retry without filter for older servers
      r = runGit(["fetch", "--depth", "1", "origin", spec.requestedRef], tmp);
    }
    if (r.code !== 0) {
      throw new Error(
        `git fetch failed for ${spec.repo}@${spec.requestedRef}: ${r.err || r.out} (public repos only)`,
      );
    }

    r = runGit(["rev-parse", "FETCH_HEAD"], tmp);
    if (r.code !== 0 || !r.out) throw new Error(`cannot resolve commit: ${r.err}`);
    const resolvedCommit = r.out;

    // sparse checkout the skill path (or whole repo if path empty)
    runGit(["sparse-checkout", "init", "--cone"], tmp);
    if (spec.path) {
      r = runGit(["sparse-checkout", "set", spec.path], tmp);
      if (r.code !== 0) throw new Error(`sparse-checkout set failed: ${r.err}`);
    }

    r = runGit(["checkout", "--force", resolvedCommit], tmp);
    if (r.code !== 0) throw new Error(`git checkout ${resolvedCommit} failed: ${r.err}`);

    const candidate = spec.path ? join(tmp, ...spec.path.split("/")) : tmp;
    if (!existsSync(candidate) || !lstatSync(candidate).isDirectory()) {
      throw new Error(`path not found in repo: ${spec.path || "(root)"} @ ${resolvedCommit.slice(0, 7)}`);
    }
    const checkoutRoot = realpathSync(tmp);
    const treeDir = realpathSync(candidate);
    const rel = relative(checkoutRoot, treeDir);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`github path escapes checkout: ${spec.path || "(root)"}`);
    }
    const skillMd = join(treeDir, "SKILL.md");
    if (!existsSync(skillMd)) {
      // case variants
      const alt = ["skill.md", "Skill.md"].map((n) => join(treeDir, n)).find((p) => existsSync(p));
      if (!alt) {
        throw new Error(`SKILL.md not found under ${spec.repo}:${spec.path || "."} @ ${resolvedCommit.slice(0, 7)}`);
      }
    }

    return {
      treeDir,
      cleanup,
      repo: spec.repo,
      path: spec.path,
      requestedRef: spec.requestedRef,
      resolvedCommit,
    };
  } catch (e) {
    cleanup();
    throw e;
  }
}

function publicationTreeOid(repoDir: string, path: string, hasHead: boolean): string | undefined {
  if (!hasHead) return undefined;
  const r = runGit(
    ["ls-tree", "-d", "-z", "HEAD", "--", `:(literal)${path}`],
    repoDir,
  );
  if (r.code !== 0) throw new Error(`cannot inspect publication target: ${r.err}`);
  if (!r.out) return undefined;
  const match = r.out.match(/^040000 tree ([0-9a-f]{40,64})\t/);
  if (!match) throw new Error(`publication target is not a directory: ${path}`);
  return match[1];
}

function preparePublicationPath(repoDir: string, path: string): string {
  let parent = repoDir;
  for (const part of path.split("/").slice(0, -1)) {
    parent = join(parent, part);
    if (existsSync(parent)) {
      const st = lstatSync(parent);
      if (st.isSymbolicLink() || !st.isDirectory()) {
        throw new Error(`unsafe publication parent: ${part}`);
      }
    } else {
      mkdirSync(parent);
    }
  }
  const target = join(repoDir, ...path.split("/"));
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`publication target is a symlink: ${path}`);
  }
  return target;
}

/** Publish one saved skill tree while preserving every other repository path. */
export function publishGithub(
  treeDir: string,
  input: GithubSpec,
  expectedTreeOid?: string,
): GithubPublicationResult {
  const spec = checkedGithubSpec(input.repo, input.path, input.requestedRef);
  if (!spec.path) throw new Error("publication target requires owner/repo/path");
  if (spec.path.split("/").includes(".git")) {
    throw new Error("publication target cannot contain .git");
  }
  const refCheck = runGit(["check-ref-format", `refs/heads/${spec.requestedRef}`]);
  if (refCheck.code !== 0) throw new Error(`invalid publication ref: ${spec.requestedRef}`);
  if (!existsSync(treeDir) || !lstatSync(treeDir).isDirectory()) {
    throw new Error(`publication tree not found: ${treeDir}`);
  }

  const url = `https://github.com/${spec.repo}.git`;
  const tmp = mkdtempSync(join(tmpdir(), "skillcoffer-publish-"));
  try {
    let r = runGit(["init", "--quiet"], tmp);
    if (r.code !== 0) throw new Error(`git init failed: ${r.err}`);
    r = runGit(["remote", "add", "origin", url], tmp);
    if (r.code !== 0) throw new Error(`git remote add failed: ${r.err}`);

    const remoteRef = `refs/heads/${spec.requestedRef}`;
    r = runGit(["ls-remote", "--exit-code", "origin", remoteRef], tmp);
    const hasHead = r.code === 0;
    if (!hasHead && r.code !== 2) {
      throw new Error(`cannot read ${spec.repo}@${spec.requestedRef}: ${r.err || r.out}`);
    }
    if (hasHead) {
      r = runGit(["fetch", "--depth", "1", "origin", remoteRef], tmp);
      if (r.code !== 0) throw new Error(`git fetch failed: ${r.err || r.out}`);
      r = runGit(["checkout", "--quiet", "--detach", "FETCH_HEAD"], tmp);
      if (r.code !== 0) throw new Error(`git checkout failed: ${r.err || r.out}`);
    }

    const currentTreeOid = publicationTreeOid(tmp, spec.path, hasHead);
    if (expectedTreeOid !== undefined && currentTreeOid !== expectedTreeOid) {
      throw new Error(`publication conflict: ${spec.repo}/${spec.path} changed since last publish`);
    }

    const target = preparePublicationPath(tmp, spec.path);
    rmSync(target, { recursive: true, force: true });
    cpSync(treeDir, target, {
      recursive: true,
      filter: (source) => {
        if (basename(source) === ".git") {
          throw new Error("skill tree cannot publish .git metadata");
        }
        return true;
      },
    });

    const pathspec = `:(literal)${spec.path}`;
    r = runGit(["add", "--all", "--force", "--", pathspec], tmp);
    if (r.code !== 0) throw new Error(`git add failed: ${r.err || r.out}`);
    r = runGit(["diff", "--cached", "--quiet", "--", pathspec], tmp);
    const changed = r.code === 1;
    if (!changed && r.code !== 0) throw new Error(`git diff failed: ${r.err || r.out}`);
    if (expectedTreeOid === undefined && currentTreeOid !== undefined && changed) {
      throw new Error(`publication target already contains different content: ${spec.repo}/${spec.path}`);
    }

    if (changed) {
      const hooks = join(tmp, ".skillcoffer-hooks");
      mkdirSync(hooks);
      r = runGit(
        [
          "-c",
          `core.hooksPath=${hooks}`,
          "-c",
          "commit.gpgSign=false",
          "commit",
          "--quiet",
          "-m",
          `Publish ${spec.path}`,
        ],
        tmp,
      );
      if (r.code !== 0) throw new Error(`git commit failed: ${r.err || r.out}`);
      r = runGit(["push", "origin", `HEAD:${remoteRef}`], tmp);
      if (r.code !== 0) throw new Error(`git push failed: ${r.err || r.out}`);
    }

    const commit = runGit(["rev-parse", "HEAD"], tmp);
    if (commit.code !== 0 || !commit.out) throw new Error(`cannot resolve published commit: ${commit.err}`);
    if (!changed) {
      const latest = runGit(["ls-remote", "--exit-code", "origin", remoteRef], tmp);
      const latestCommit = latest.out.split(/\s/)[0];
      if (latest.code !== 0 || latestCommit !== commit.out) {
        throw new Error("publication remote changed during publish; retry");
      }
    }
    const treeOid = publicationTreeOid(tmp, spec.path, true);
    if (!treeOid) throw new Error(`published target missing: ${spec.path}`);
    return { commit: commit.out, treeOid, changed };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
