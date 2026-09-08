import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// A new name avoids confusing the prototype's permanently empty store.lock
// with a lock owned by a writer. Old and new CLI versions must not run together.
const LOCK_NAME = ".store-write.lock";
const heldLocks = new Set<string>();

function busyError(path: string): Error {
  let owner = "";
  try {
    const record = JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown };
    if (typeof record.pid === "number") owner = ` (PID ${record.pid})`;
  } catch {
    // Another writer may still be writing its owner record. Fail closed.
  }
  return new Error(
    `Store busy: write lock exists at ${path}${owner}. ` +
      "If a writer crashed, stop all skillcoffer processes using this Store " +
      "before removing this lock file and retrying.",
  );
}

/** Synchronous, reentrant within this process, exclusive across processes. */
export function withStoreLock<T>(home: string, fn: () => T): T {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = join(realpathSync(home), LOCK_NAME);
  if (heldLocks.has(path)) return fn();

  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw busyError(path);
    throw error;
  }

  const identity = fstatSync(fd);
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + "\n");
    heldLocks.add(path);
    return fn();
  } finally {
    heldLocks.delete(path);
    try {
      // Do not delete a replacement lock if an operator changed the path.
      const current = lstatSync(path);
      if (current.dev === identity.dev && current.ino === identity.ino) unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    } finally {
      closeSync(fd);
    }
  }
}
