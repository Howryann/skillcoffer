import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Exercise the production parser in Node without changing the web build output.
const source = readFileSync(
  new URL("../web/src/diff.ts", import.meta.url),
  "utf8",
).replace(
  'from "react-diff-view"',
  `from ${JSON.stringify(import.meta.resolve("react-diff-view"))}`,
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { parseDirectoryDiff, fileStats } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const headers =
  "diff -ruN /store/versions/v1/tree/notes.md /store/branches/main/work/notes.md\n--- /store/versions/v1/tree/notes.md\t2026-01-01 00:00:00\n+++ /store/branches/main/work/notes.md\t2026-01-02 00:00:00\n";

test("diff content containing status-like words remains visible", () => {
  const result = parseDirectoryDiff(
    headers + "@@ -1 +1 @@\n-no diff until edited\n+there is a diff now\n",
  );
  assert.equal(result.files.length, 1);
  assert.deepEqual(fileStats(result.files[0]), { adds: 1, dels: 1 });
});

test("header-looking lines inside a hunk do not create phantom files", () => {
  const result = parseDirectoryDiff(
    headers + "@@ -1 +1 @@\n--- old text\n+++ new text\n",
  );
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].newPath, "notes.md");
  assert.deepEqual(fileStats(result.files[0]), { adds: 1, dels: 1 });
});

test("binary changes are retained alongside readable text changes", () => {
  const result = parseDirectoryDiff(
    headers +
      "@@ -1 +1 @@\n-old\n+new\nBinary files /left/image.png and /right/image.png differ\n",
  );
  assert.equal(result.files.length, 1);
  assert.match(result.other, /image.png/);
});

test("new directory-diff files are identified as additions", () => {
  const result = parseDirectoryDiff(
    "--- /store/versions/v1/tree/new.md\t1970-01-01 00:00:00\n+++ /store/branches/main/work/new.md\t2026-01-01 00:00:00\n@@ -0,0 +1 @@\n+new file\n",
  );
  assert.equal(result.files[0].type, "add");
  assert.deepEqual(fileStats(result.files[0]), { adds: 1, dels: 0 });
});
