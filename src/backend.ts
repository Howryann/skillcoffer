import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGithubSpec, runGit } from "./github.js";
import {
  createStoreSnapshot,
  restoreStoreSnapshot,
  validateStoreSnapshot,
} from "./snapshot.js";
import { Store } from "./store.js";

export type BackendState = {
  schemaVersion: 1;
  repo: string;
  ref: string;
  commit: string;
  snapshotHash: string;
};

export type BackendResult = BackendState & { changed: boolean };

type BackendCheckout = {
  dir: string;
  remoteRef: string;
  commit?: string;
  snapshotDir?: string;
  snapshotHash?: string;
  hasOtherRefs: boolean;
  cleanup: () => void;
};

function backendStatePath(store: Store): string {
  return join(store.home, "backend.json");
}

export function readBackendState(store: Store): BackendState | undefined {
  const path = backendStatePath(store);
  if (!existsSync(path)) return undefined;
  const state = JSON.parse(readFileSync(path, "utf8")) as BackendState;
  if (
    state.schemaVersion !== 1 ||
    typeof state.repo !== "string" ||
    typeof state.ref !== "string" ||
    typeof state.commit !== "string" ||
    typeof state.snapshotHash !== "string"
  ) {
    throw new Error("invalid backend state");
  }
  return state;
}

function writeBackendState(store: Store, state: BackendState): void {
  mkdirSync(store.home, { recursive: true, mode: 0o700 });
  const path = backendStatePath(store);
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

function backendTarget(target: string | undefined, ref: string | undefined): { repo: string; ref: string } {
  if (!target) throw new Error("backend repository required the first time");
  const spec = parseGithubSpec(target, ref ?? "main");
  if (spec.path) throw new Error("backend target must be owner/repo without a path");
  const refCheck = runGit(["check-ref-format", `refs/heads/${spec.requestedRef}`]);
  if (refCheck.code !== 0) throw new Error(`invalid backend ref: ${spec.requestedRef}`);
  return { repo: spec.repo, ref: spec.requestedRef };
}

function checkoutBackend(repo: string, ref: string): BackendCheckout {
  const dir = mkdtempSync(join(tmpdir(), "skillcoffer-backend-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    let result = runGit(["init", "--quiet"], dir);
    if (result.code !== 0) throw new Error(`git init failed: ${result.err}`);
    result = runGit(["remote", "add", "origin", `https://github.com/${repo}.git`], dir);
    if (result.code !== 0) throw new Error(`git remote add failed: ${result.err}`);

    result = runGit(["ls-remote", "origin"], dir);
    if (result.code !== 0) throw new Error(`cannot read backend ${repo}: ${result.err || result.out}`);
    const refs = result.out ? result.out.split("\n") : [];
    const remoteRef = `refs/heads/${ref}`;
    const line = refs.find((entry) => entry.endsWith(`\t${remoteRef}`));
    if (!line) return { dir, remoteRef, hasOtherRefs: refs.length > 0, cleanup };

    result = runGit(["fetch", "--depth", "1", "origin", remoteRef], dir);
    if (result.code !== 0) throw new Error(`git fetch failed: ${result.err || result.out}`);
    result = runGit(["checkout", "--quiet", "--detach", "FETCH_HEAD"], dir);
    if (result.code !== 0) throw new Error(`git checkout failed: ${result.err || result.out}`);
    const entries = readdirSync(dir).filter((name) => name !== ".git");
    if (entries.length !== 1 || entries[0] !== "snapshot") {
      throw new Error("backend repository does not contain a valid snapshot");
    }
    const snapshotDir = join(dir, "snapshot");
    return {
      dir,
      remoteRef,
      commit: line.split(/\s/)[0],
      snapshotDir,
      snapshotHash: validateStoreSnapshot(snapshotDir),
      hasOtherRefs: refs.length > 1,
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function commitAndPush(checkout: BackendCheckout): string {
  const hooks = join(checkout.dir, ".skillcoffer-hooks");
  mkdirSync(hooks, { mode: 0o700 });
  let result = runGit(["add", "--all"], checkout.dir);
  if (result.code !== 0) throw new Error(`git add failed: ${result.err || result.out}`);
  result = runGit(
    [
      "-c",
      `core.hooksPath=${hooks}`,
      "-c",
      "commit.gpgSign=false",
      "commit",
      "--quiet",
      "-m",
      "Store skillcoffer snapshot",
    ],
    checkout.dir,
  );
  if (result.code !== 0) throw new Error(`git commit failed: ${result.err || result.out}`);
  result = runGit(["push", "origin", `HEAD:${checkout.remoteRef}`], checkout.dir);
  if (result.code !== 0) throw new Error(`git push failed: ${result.err || result.out}`);
  result = runGit(["rev-parse", "HEAD"], checkout.dir);
  if (result.code !== 0 || !result.out) throw new Error(`cannot resolve backend commit: ${result.err}`);
  return result.out;
}

export function backendPush(
  store: Store,
  target?: string,
  opts: { ref?: string } = {},
): BackendResult {
  if (readBackendState(store)) throw new Error("backend is already configured");
  const selected = backendTarget(target, opts.ref);
  const snapshot = createStoreSnapshot(store);
  const checkout = checkoutBackend(selected.repo, selected.ref);
  try {
    let commit: string;
    let changed = false;
    if (checkout.commit) {
      if (checkout.snapshotHash !== snapshot.hash) {
        throw new Error("backend already contains a different snapshot");
      }
      commit = checkout.commit;
    } else {
      if (checkout.hasOtherRefs) throw new Error("backend repository is not empty");
      cpSync(snapshot.dir, join(checkout.dir, "snapshot"), { recursive: true });
      commit = commitAndPush(checkout);
      changed = true;
    }
    const state: BackendState = {
      schemaVersion: 1,
      repo: selected.repo,
      ref: selected.ref,
      commit,
      snapshotHash: snapshot.hash,
    };
    writeBackendState(store, state);
    return { ...state, changed };
  } finally {
    checkout.cleanup();
    snapshot.cleanup();
  }
}

export function backendPull(
  store: Store,
  target?: string,
  opts: { ref?: string } = {},
): BackendResult {
  if (readBackendState(store)) throw new Error("backend is already configured");
  if (store.list().length || store.bundleList().length) {
    throw new Error("first backend pull requires an empty Store");
  }
  const selected = backendTarget(target, opts.ref);
  const checkout = checkoutBackend(selected.repo, selected.ref);
  try {
    if (!checkout.commit || !checkout.snapshotDir || !checkout.snapshotHash) {
      throw new Error("backend has no snapshot on the requested ref");
    }
    restoreStoreSnapshot(store, checkout.snapshotDir);
    const state: BackendState = {
      schemaVersion: 1,
      repo: selected.repo,
      ref: selected.ref,
      commit: checkout.commit,
      snapshotHash: checkout.snapshotHash,
    };
    writeBackendState(store, state);
    return { ...state, changed: true };
  } finally {
    checkout.cleanup();
  }
}
