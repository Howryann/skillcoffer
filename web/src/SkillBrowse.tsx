import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Diff, Hunk } from "react-diff-view";
import { useSearchParams } from "react-router-dom";
import {
  fetchDiff,
  fetchSkillFile,
  fetchSkillFiles,
  type DiffResult,
  type SkillVersion,
} from "./api";
import { ErrorMessage, shortVersion } from "./Controls";
import { Icon } from "./Icons";
import { fileKey, fileStats, parseDirectoryDiff } from "./diff";
import { usePolling } from "./usePolling";

function size(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
}
function VersionOptions({ versions }: { versions: SkillVersion[] }) {
  return (
    <>
      <option value="head">HEAD</option>
      <option value="work">work</option>
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          {shortVersion(v.id)}
          {v.note ? ` · ${v.note.slice(0, 60)}` : ""}
        </option>
      ))}
    </>
  );
}
export function SkillFiles({
  skillId,
  branch,
  versions,
}: {
  skillId: string;
  branch: string;
  versions: SkillVersion[];
}) {
  const [params, setParams] = useSearchParams();
  const ref = params.get("ref") || "work";
  const wanted = params.get("path");
  const [raw, setRaw] = useState(false);
  const tree = usePolling(JSON.stringify([skillId, branch, ref]), () =>
    fetchSkillFiles(skillId, ref, branch),
  );
  const selected =
    wanted ??
    tree.data?.files.find((f) => f.path === "SKILL.md")?.path ??
    tree.data?.files[0]?.path ??
    null;
  const content = usePolling(
    selected ? JSON.stringify([skillId, branch, ref, selected]) : undefined,
    () => fetchSkillFile(skillId, selected!, ref, branch),
  );
  const selectPath = (path: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("path", path);
        return next;
      },
      { replace: true },
    );
  const file = content.data;
  const markdown = /\.(md|markdown)$/i.test(file?.path ?? "");
  const text = file?.content ?? "";
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const localPath = (href: string) => {
    try {
      const base = new URL(selected ?? "SKILL.md", "https://skill.local/");
      const resolved = new URL(href, base);
      if (resolved.origin !== base.origin) return null;
      const path = decodeURIComponent(resolved.pathname.slice(1));
      return tree.data?.files.some((entry) => entry.path === path)
        ? path
        : null;
    } catch {
      return null;
    }
  };
  return (
    <>
      <ErrorMessage
        error={tree.error || content.error}
        retry={() => {
          tree.reload();
          content.reload();
        }}
      />
      <div className="file-workspace">
        <nav className="file-nav" aria-label="文件">
          <div className="section-label">Files</div>
          {tree.data?.files.map((entry) => (
            <button
              type="button"
              key={entry.path}
              onClick={() => selectPath(entry.path)}
              className={entry.path === selected ? "active" : ""}
              aria-pressed={entry.path === selected}
              title={entry.path}
            >
              <Icon name="file" />
              <span className="file-name">{entry.path}</span>
            </button>
          ))}
          {!tree.data ? (
            <span className="small muted">加载中…</span>
          ) : !tree.data.files.length ? (
            <span className="small muted">无文件</span>
          ) : null}
        </nav>
        <article className="article-wrap">
          <div className="article-toolbar">
            <span className="file-name" title={file?.path ?? selected ?? ""}>
              {file?.path ?? selected ?? "Files"}
            </span>
            <div className="row">
              <span>{file ? size(file.size) : ""}</span>
              <label>
                <span className="sr-only">文件版本</span>
                <select
                  className="inline-select"
                  value={ref}
                  onChange={(e) =>
                    setParams(
                      (previous) => {
                        const next = new URLSearchParams(previous);
                        next.set("ref", e.target.value);
                        return next;
                      },
                      { replace: true },
                    )
                  }
                >
                  <VersionOptions versions={versions} />
                </select>
              </label>
              {markdown ? (
                <button type="button" onClick={() => setRaw((v) => !v)}>
                  {raw ? "Preview" : "Raw"}
                </button>
              ) : null}
              <button
                className="icon-button"
                type="button"
                aria-label="刷新文件"
                onClick={() => {
                  tree.reload();
                  content.reload();
                }}
              >
                <Icon name="refresh" />
              </button>
            </div>
          </div>
          {!file ? (
            <div className="article muted">
              {selected ? "加载中…" : "选择文件"}
            </div>
          ) : file.binary ? (
            <div className="article muted">二进制文件 · {size(file.size)}</div>
          ) : (
            <div
              className={
                markdown && !raw
                  ? "article markdown-body"
                  : "article raw-content"
              }
              translate="no"
            >
              {file.truncated ? (
                <p className="truncated-note">显示前 512 KB</p>
              ) : null}
              {markdown && !raw ? (
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  components={{
                    a: ({ href, children }) => {
                      if (!href) return <span>{children}</span>;
                      if (/^(https?:|mailto:)/i.test(href))
                        return (
                          <a href={href} target="_blank" rel="noreferrer">
                            {children}
                          </a>
                        );
                      const path = localPath(href);
                      return path ? (
                        <button
                          className="markdown-link"
                          onClick={() => selectPath(path)}
                        >
                          {children}
                        </button>
                      ) : (
                        <span title={href}>{children}</span>
                      );
                    },
                    img: ({ src, alt }) =>
                      typeof src === "string" && /^https?:\/\//i.test(src) ? (
                        <img
                          src={src}
                          alt={alt ?? ""}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="muted">[Image: {alt || src}]</span>
                      ),
                  }}
                >
                  {body}
                </Markdown>
              ) : (
                <pre>{text}</pre>
              )}
            </div>
          )}
        </article>
      </div>
    </>
  );
}
export function DiffPane({
  diff,
  compact = false,
}: {
  diff: DiffResult;
  compact?: boolean;
}) {
  const parsed = useMemo(() => parseDirectoryDiff(diff.text), [diff.text]);
  const [selected, setSelected] = useState<string | null>(null);
  const files = parsed.files;
  const current = files.find((file) => fileKey(file) === selected) ?? files[0];
  const stats = current ? fileStats(current) : { adds: 0, dels: 0 };
  return (
    <>
      <div className={`file-workspace ${compact ? "compact-diff" : ""}`}>
        <nav className="file-nav" aria-label="变更文件">
          <div className="section-label">Changed files</div>
          {files.map((file) => {
            const key = fileKey(file),
              totals = fileStats(file);
            return (
              <button
                key={key}
                className={current === file ? "active" : ""}
                aria-pressed={current === file}
                title={key}
                onClick={() => setSelected(key)}
              >
                <Icon name="file" />
                <span className="file-name">{key}</span>
                <span className="change-count">
                  {totals.adds ? `+${totals.adds}` : `−${totals.dels}`}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="diff-section">
          <div className="diff-card">
            <div className="diff-file-head">
              <span className="file-name">
                {current ? fileKey(current) : "Diff"}
              </span>
              {current ? (
                <span className="diff-totals">
                  <span className="add-count">+{stats.adds}</span>
                  <span className="del-count">−{stats.dels}</span>
                </span>
              ) : null}
            </div>
            <div className="diff-host" translate="no">
              {current ? (
                <Diff
                  viewType="unified"
                  diffType={current.type}
                  hunks={current.hunks}
                  gutterType="default"
                >
                  {(hunks) =>
                    hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)
                  }
                </Diff>
              ) : (
                <pre className="diff-empty">
                  {diff.text.trim() || "No changes."}
                </pre>
              )}
            </div>
          </div>
          {parsed.other && files.length ? (
            <pre className="diff-other">{parsed.other}</pre>
          ) : null}
        </div>
      </div>
    </>
  );
}
export function SkillDiff({
  skillId,
  branch,
  versions,
  headId,
  onSave,
  dirty,
}: {
  skillId: string;
  branch: string;
  versions: SkillVersion[];
  headId: string;
  dirty: boolean;
  onSave: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const left = params.get("left") || "head",
    right = params.get("right") || "work";
  const path = params.get("scope") || undefined;
  const opts = { left, right, path, branch };
  const result = usePolling(JSON.stringify([skillId, opts, headId]), () =>
    fetchDiff(skillId, opts),
  );
  const files = usePolling(JSON.stringify([skillId, branch]), () =>
    fetchSkillFiles(skillId, "work", branch),
  );
  const paths = [
    ...new Set([
      ...(files.data?.files.map((file) => file.path) ?? []),
      ...(result.data
        ? parseDirectoryDiff(result.data.text).files.map(fileKey)
        : []),
      ...(path ? [path] : []),
    ]),
  ].sort();
  const set = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const stats = useMemo(
    () =>
      result.data
        ? parseDirectoryDiff(result.data.text).files.reduce(
            (acc, file) => {
              const n = fileStats(file);
              return {
                files: acc.files + 1,
                adds: acc.adds + n.adds,
                dels: acc.dels + n.dels,
              };
            },
            { files: 0, adds: 0, dels: 0 },
          )
        : null,
    [result.data],
  );
  return (
    <>
      <div className="compare-controls">
        <div className="row">
          <label>
            <span className="sr-only">对比左侧</span>
            <select value={left} onChange={(e) => set("left", e.target.value)}>
              <VersionOptions versions={versions} />
            </select>
          </label>
          <Icon name="arrow" />
          <label>
            <span className="sr-only">对比右侧</span>
            <select
              value={right}
              onChange={(e) => set("right", e.target.value)}
            >
              <VersionOptions versions={versions} />
            </select>
          </label>
        </div>
        <span className="mono muted compare-branch">{branch}</span>
        <div className="row">
          <label>
            <span className="sr-only">比较范围</span>
            <select
              aria-label="比较范围"
              value={path ?? ""}
              onChange={(e) => set("scope", e.target.value)}
            >
              <option value="">All files</option>
              {paths.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <button
            className="icon-button"
            aria-label="刷新 Diff"
            onClick={result.reload}
          >
            <Icon name="refresh" />
          </button>
        </div>
      </div>
      <ErrorMessage error={result.error} retry={result.reload} />
      {result.data ? (
        <>
          <DiffPane diff={result.data} />
          <div className="diff-bottom">
            <span className="mono">
              {stats?.files ?? 0} files · +{stats?.adds ?? 0} −
              {stats?.dels ?? 0}
            </span>
            {dirty ? (
              <button className="button primary" onClick={onSave}>
                保存版本 <Icon name="arrow" />
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <p className="empty">{result.error ? "" : "加载 Diff…"}</p>
      )}
    </>
  );
}
