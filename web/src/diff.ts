import { parseDiff, type FileData } from "react-diff-view";

function relativePath(path: string) {
  for (const marker of ["/work/", "/tree/"]) {
    const index = path.indexOf(marker);
    if (index >= 0) return path.slice(index + marker.length);
  }
  return path.replace(/^[ab]\//, "");
}
/** Convert the directory diff headers to git headers without treating file contents as status. */
export function parseDirectoryDiff(text: string): {
  files: FileData[];
  other: string;
} {
  const lines = text.split("\n");
  const normalized: string[] = [];
  const other: string[] = [];
  let expectHeader = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("diff ")) {
      expectHeader = true;
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("Only in ")) {
      other.push(line);
      expectHeader = false;
      continue;
    }
    if (
      expectHeader &&
      line.startsWith("--- ") &&
      lines[i + 1]?.startsWith("+++ ")
    ) {
      expectHeader = false;
      const next = lines[++i];
      const before = line.slice(4).split("\t")[0];
      const after = next.slice(4).split("\t")[0];
      const added = before === "/dev/null" || /\t1970-01-01 /.test(line);
      const deleted = after === "/dev/null" || /\t1970-01-01 /.test(next);
      const a = added ? relativePath(after) : relativePath(before);
      const b = deleted ? relativePath(before) : relativePath(after);
      normalized.push(`diff --git a/${a} b/${b}`);
      if (added) normalized.push("new file mode 100644");
      if (deleted) normalized.push("deleted file mode 100644");
      normalized.push(
        `--- ${added ? "/dev/null" : `a/${a}`}`,
        `+++ ${deleted ? "/dev/null" : `b/${b}`}`,
      );
    } else if (normalized.length) normalized.push(line);
  }
  try {
    return {
      files: normalized.length ? parseDiff(normalized.join("\n")) : [],
      other: other.join("\n"),
    };
  } catch {
    return { files: [], other: text };
  }
}
export const fileKey = (file: FileData) =>
  file.newPath && file.newPath !== "/dev/null"
    ? file.newPath
    : file.oldPath || "file";
export function fileStats(file: FileData) {
  let adds = 0,
    dels = 0;
  for (const hunk of file.hunks)
    for (const line of hunk.changes) {
      if (line.type === "insert") adds++;
      if (line.type === "delete") dels++;
    }
  return { adds, dels };
}
