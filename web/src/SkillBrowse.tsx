import { useEffect, useMemo, useState } from "react";
import { Diff, Hunk, parseDiff, type FileData } from "react-diff-view";
import {
  fetchDiff,
  fetchSkillFile,
  fetchSkillFiles,
  type DiffResult,
  type SkillFileContent,
  type SkillFileEntry,
} from "./api";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Drop absolute store noise; keep path after work/tree. */
function shortPath(p: string): string {
  const markers = ["/work/", "/tree/"];
  for (const m of markers) {
    const i = p.indexOf(m);
    if (i >= 0) return p.slice(i + m.length) || p;
  }
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 3) return parts.join("/") || p;
  return parts.slice(-3).join("/");
}

/**
 * `diff -ruN` absolute paths break react-diff-view's parser.
 * Normalize each file block to git-style unified so parseDiff works.
 */
function normalizeToGitDiff(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("diff ")) {
      i += 1;
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("Only in ")) {
      out.push(line);
      i += 1;
      continue;
    }
    if (line.startsWith("--- ")) {
      const oldRaw = line.slice(4).split("\t")[0];
      const newLine = lines[i + 1] || "";
      if (!newLine.startsWith("+++ ")) {
        i += 1;
        continue;
      }
      const newRaw = newLine.slice(4).split("\t")[0];
      const oldNull = oldRaw === "/dev/null" || oldRaw.endsWith("dev/null");
      const newNull = newRaw === "/dev/null" || newRaw.endsWith("dev/null");
      const oldPath = oldNull ? "/dev/null" : shortPath(oldRaw.replace(/^[ab]\//, ""));
      const newPath = newNull ? "/dev/null" : shortPath(newRaw.replace(/^[ab]\//, ""));
      const name = newPath !== "/dev/null" ? newPath : oldPath;
      const a = oldNull ? name : oldPath;
      const b = newNull ? name : newPath;
      out.push(`diff --git a/${a} b/${b}`);
      out.push(`--- ${oldNull ? "/dev/null" : `a/${oldPath}`}`);
      out.push(`+++ ${newNull ? "/dev/null" : `b/${newPath}`}`);
      i += 2;
      while (i < lines.length && !lines[i].startsWith("--- ") && !lines[i].startsWith("diff ")) {
        out.push(lines[i]);
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join("\n");
}

function fileKey(f: FileData): string {
  return f.newPath && f.newPath !== "/dev/null" ? f.newPath : f.oldPath || "file";
}

function fileStats(f: FileData): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const h of f.hunks) {
    for (const c of h.changes) {
      if (c.type === "insert") adds += 1;
      else if (c.type === "delete") dels += 1;
    }
  }
  return { adds, dels };
}

function typeLabel(t: FileData["type"]): { letter: string; word: string; className: string } {
  switch (t) {
    case "add":
      return { letter: "A", word: "新增", className: "text-accent" };
    case "delete":
      return { letter: "D", word: "删除", className: "text-danger" };
    case "rename":
      return { letter: "R", word: "重命名", className: "text-pin" };
    case "copy":
      return { letter: "C", word: "复制", className: "text-pin" };
    default:
      return { letter: "M", word: "修改", className: "text-warn" };
  }
}

function parseFiles(text: string): FileData[] {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("no diff") || trimmed.includes("两边一致")) return [];
  const normalized = normalizeToGitDiff(text);
  if (!normalized.trim()) return [];
  try {
    return parseDiff(normalized);
  } catch {
    // last resort: wrap as single synthetic modify if hunks alone
    try {
      return parseDiff(`diff --git a/file b/file\n--- a/file\n+++ b/file\n${text}`);
    } catch {
      return [];
    }
  }
}

export function DiffPane({
  diff,
  onClose,
}: {
  diff: DiffResult;
  onClose: () => void;
}) {
  const files = useMemo(() => parseFiles(diff.text), [diff.text]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setSelected(files[0] ? fileKey(files[0]) : null);
  }, [files]);

  const current = files.find((f) => fileKey(f) === selected) ?? files[0] ?? null;
  const empty = files.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 text-xs">
        <span className="font-mono text-muted">{shortPath(diff.leftLabel)}</span>
        <span className="text-muted">→</span>
        <span className="font-mono text-text">{shortPath(diff.rightLabel)}</span>
        <span className="text-muted">· {files.length} 个文件</span>
        <button
          type="button"
          className="ml-auto text-muted underline hover:text-text"
          onClick={onClose}
        >
          关闭
        </button>
      </div>

      {empty ? (
        <p className="p-4 text-sm text-muted">{diff.text.trim() || "无差异"}</p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[15rem_1fr]">
          {/* GitHub-style changed files */}
          <nav
            className="min-h-0 overflow-y-auto border-b border-border bg-surface md:border-b-0 md:border-r"
            aria-label="变更文件"
          >
            <p className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">
              变更文件
            </p>
            <ul className="pb-2">
              {files.map((f) => {
                const key = fileKey(f);
                const { adds, dels } = fileStats(f);
                const tl = typeLabel(f.type);
                const active = current && fileKey(current) === key;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className={[
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                        active ? "bg-surface-2 text-text" : "text-text/90 hover:bg-surface-2/70",
                      ].join(" ")}
                      onClick={() => setSelected(key)}
                    >
                      <span className={`w-3 shrink-0 font-mono font-medium ${tl.className}`}>
                        {tl.letter}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono" title={key}>
                        {key}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums">
                        {adds ? <span className="text-accent">+{adds}</span> : null}
                        {adds && dels ? " " : null}
                        {dels ? <span className="text-danger">−{dels}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* One file at a time — single scroll container so gutters stay aligned */}
          <div className="diff-host min-h-0 overflow-auto">
            {current ? (
              <>
                <div className="sticky top-0 z-10 border-b border-border bg-surface px-3 py-2 font-mono text-xs text-text">
                  {fileKey(current)}
                  <span className="ml-2 text-muted">{typeLabel(current.type).word}</span>
                </div>
                <Diff
                  viewType="unified"
                  diffType={current.type}
                  hunks={current.hunks}
                  className="diff-rdv"
                  gutterType="default"
                >
                  {(hunks) =>
                    hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)
                  }
                </Diff>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

type TreeProps = {
  skillId: string;
  headId?: string;
  versions: { id: string; note?: string; heads: string[] }[];
  onSelectPath?: (path: string | null) => void;
  selectedPath?: string | null;
};

function useRefOptions(headId: string | undefined, versions: TreeProps["versions"]) {
  return useMemo(() => {
    const opts = [{ value: "work", label: "工作区" }];
    if (headId) opts.push({ value: "head", label: "当前存档" });
    for (const v of versions.slice(0, 20)) {
      opts.push({
        value: v.id,
        label: `${v.id.slice(0, 16)}…${v.note ? ` ${v.note}` : ""}${v.heads.length ? " · HEAD" : ""}`,
      });
    }
    return opts;
  }, [headId, versions]);
}

export function SkillFiles({ skillId, headId, versions, onSelectPath, selectedPath }: TreeProps) {
  const [ref, setRef] = useState("work");
  const [files, setFiles] = useState<SkillFileEntry[]>([]);
  const [treeLabel, setTreeLabel] = useState("");
  const [selected, setSelected] = useState<string | null>(selectedPath ?? null);
  const [file, setFile] = useState<SkillFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refOptions = useRefOptions(headId, versions);

  const pick = (path: string | null) => {
    setSelected(path);
    onSelectPath?.(path);
  };

  const loadFiles = (r: string) => {
    setBusy(true);
    setError(null);
    void fetchSkillFiles(skillId, r)
      .then((res) => {
        setFiles(res.files);
        setTreeLabel(res.label);
        setRef(r);
        const prefer =
          res.files.find((f) => f.path === "SKILL.md")?.path ?? res.files[0]?.path ?? null;
        setSelected((cur) => {
          const next = cur && res.files.some((f) => f.path === cur) ? cur : prefer;
          onSelectPath?.(next);
          return next;
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    loadFiles("work");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillId]);

  useEffect(() => {
    if (!selected) {
      setFile(null);
      return;
    }
    let alive = true;
    setBusy(true);
    void fetchSkillFile(skillId, selected, ref)
      .then((f) => {
        if (alive) setFile(f);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [skillId, selected, ref]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          树
          <select
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text"
            value={ref}
            onChange={(e) => loadFiles(e.target.value)}
          >
            {refOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted">{treeLabel}</span>
        <span className="text-xs text-muted">{files.length} 个文件</span>
        {busy ? <span className="text-xs text-muted">…</span> : null}
      </div>

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border border-border md:grid-cols-[16rem_1fr]">
        <nav
          className="min-h-0 overflow-y-auto border-b border-border bg-surface md:border-b-0 md:border-r"
          aria-label="文件列表"
        >
          {files.length === 0 ? (
            <p className="p-3 text-xs text-muted">{busy ? "加载中…" : "无文件"}</p>
          ) : (
            <ul className="py-1">
              {files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className={[
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs",
                      selected === f.path ? "bg-surface-2 text-accent" : "text-text hover:bg-surface-2/60",
                    ].join(" ")}
                    onClick={() => pick(f.path)}
                  >
                    <span className="min-w-0 flex-1 truncate">{f.path}</span>
                    <span className="shrink-0 text-[11px] text-muted">{fmtSize(f.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="flex min-h-0 flex-col bg-bg">
          {!file ? (
            <p className="p-4 text-sm text-muted">选择左侧文件（只读预览）</p>
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
                <span className="font-mono text-text">{file.path}</span>
                <span className="text-muted">{fmtSize(file.size)}</span>
                <span className="text-muted">{file.label}</span>
                {file.truncated ? <span className="text-warn">已截断前 512KB</span> : null}
              </div>
              {file.binary ? (
                <p className="p-4 text-sm text-muted">二进制文件，无法预览</p>
              ) : (
                <div
                  className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[13px] leading-relaxed text-text whitespace-pre-wrap"
                  translate="yes"
                >
                  {file.content}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type DiffProps = {
  skillId: string;
  dirty: boolean;
  headId?: string;
  versions: TreeProps["versions"];
  hasGithubUpstream: boolean;
  diff: DiffResult | null;
  onDiff: (d: DiffResult | null) => void;
  path?: string | null;
};

export function SkillDiff({
  skillId,
  dirty,
  headId,
  versions,
  hasGithubUpstream,
  diff,
  onDiff,
  path,
}: DiffProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cmpLeft, setCmpLeft] = useState("head");
  const [cmpRight, setCmpRight] = useState("work");
  const refOptions = useRefOptions(headId, versions);

  const runDiff = (opts: Parameters<typeof fetchDiff>[1]) => {
    setBusy(true);
    setError(null);
    void fetchDiff(skillId, opts)
      .then(onDiff)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (diff || !dirty) return;
    runDiff({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillId]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        {dirty ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-50"
            onClick={() => runDiff({})}
          >
            未存档修改
          </button>
        ) : (
          <span className="text-xs text-muted">工作区与存档一致</span>
        )}
        {path ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-text hover:border-accent/40 disabled:opacity-50"
            onClick={() => runDiff({ left: "head", right: "work", path })}
            title={path}
          >
            此文件
          </button>
        ) : null}
        {hasGithubUpstream ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:text-text disabled:opacity-50"
            onClick={() => runDiff({ upstream: true })}
          >
            上游
          </button>
        ) : null}
        <span className="mx-1 hidden h-4 w-px bg-border sm:inline-block" aria-hidden />
        <select
          className="max-w-[10rem] rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text"
          value={cmpLeft}
          onChange={(e) => setCmpLeft(e.target.value)}
          aria-label="对比左侧"
        >
          {refOptions.map((o) => (
            <option key={`L${o.value}`} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">→</span>
        <select
          className="max-w-[10rem] rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text"
          value={cmpRight}
          onChange={(e) => setCmpRight(e.target.value)}
          aria-label="对比右侧"
        >
          {refOptions.map((o) => (
            <option key={`R${o.value}`} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-text hover:border-accent/40 disabled:opacity-50"
          onClick={() =>
            runDiff({
              left: cmpLeft,
              right: cmpRight,
              path: path ?? undefined,
            })
          }
        >
          跑对比
        </button>
        {busy ? <span className="text-xs text-muted">对比中…</span> : null}
      </div>

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {diff ? (
        <DiffPane diff={diff} onClose={() => onDiff(null)} />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted">
          选上方快捷对比，或自定义左右侧后「跑对比」
        </div>
      )}
    </div>
  );
}
