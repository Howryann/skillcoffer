import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  applyUpdate,
  checkSkill,
  discardSkill,
  fetchDiff,
  fetchSkill,
  linkSkill,
  previewUpdate,
  restoreSkill,
  saveSkill,
  unlinkSkill,
  type CheckResult,
  type DiffResult,
  type SkillDetail,
} from "./api";
import { SkillDiff, SkillFiles } from "./SkillBrowse";
import { CopyBtn, ModeBadge } from "./Controls";
import { usePolling } from "./usePolling";

type Tab = "overview" | "files" | "diff";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h2 className="text-xs font-medium text-muted">{title}</h2>
      {children}
    </section>
  );
}

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 19);
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s 前`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m 前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h 前`;
  return `${Math.floor(sec / 86400)}d 前`;
}

export default function SkillPage({ onChanged }: { onChanged?: () => void }) {
  const { id } = useParams();
  const { data, error, setData, setError, reload } = usePolling(id, fetchSkill, {
    clearOnError: true,
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [unlinkTo, setUnlinkTo] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [activeDiff, setActiveDiff] = useState<DiffResult | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [filePath, setFilePath] = useState<string | null>(null);

  useEffect(() => {
    setTab("overview");
    setActiveDiff(null);
    setFilePath(null);
    setCheck(null);
    setConfirmApply(false);
    setRestoreId(null);
    setNote("");
    setConfirmDiscard(false);
  }, [id]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const openDiff = (d: DiffResult) => {
    setActiveDiff(d);
    setTab("diff");
  };

  const run = async (fn: () => Promise<SkillDetail>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      setData(next);
      onChanged?.();
      return next;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <p className="text-sm text-danger" role="alert">
        {error}
      </p>
    );
  }
  if (!data) return <p className="text-sm text-muted">加载中…</p>;

  const sourceKind =
    data.source.kind === "github" ? "github" : data.source.kind === "file" ? "file" : "local";
  const headId = data.branches.find((b) => b.active)?.head;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4">
      {error ? (
        <p className="shrink-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {toast ? (
        <p
          className="shrink-0 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent"
          role="status"
        >
          {toast}
        </p>
      ) : null}

      {/* 1. 身份行 */}
      <div className="shrink-0 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{data.id}</h1>
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
            {sourceKind}
          </span>
        </div>
        <p className="truncate font-mono text-xs text-muted" title={data.source.label}>
          来源 {data.source.label}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface px-2 py-1.5 font-mono text-xs text-text">
            {data.path}
          </code>
          <CopyBtn text={data.path} label="复制 path" />
        </div>
      </div>

      {/* 2. 健康条 */}
      <div
        className={[
          "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm",
          data.activeDirty
            ? "border-warn/40 bg-warn/10 text-warn"
            : "border-border bg-surface text-text",
        ].join(" ")}
        role="status"
      >
        <span>{data.activeDirty ? "有未存档修改" : "工作区干净"}</span>
        <span className="text-muted">·</span>
        <span>
          编辑 <span className="font-mono text-xs">{data.activeBranch}</span>
        </span>
        <span className="text-muted">·</span>
        <span>
          挂载 {data.links.length}
          {data.liveCount ? ` · 跟随 ${data.liveCount}` : ""}
          {data.pinCount ? ` · 固定 ${data.pinCount}` : ""}
        </span>
        {data.activeDirty ? (
          <>
            <span className="text-muted">·</span>
            <button
              type="button"
              className="underline hover:text-text"
              onClick={() => setTab("diff")}
            >
              看未存档 diff
            </button>
          </>
        ) : null}
      </div>

      {data.activeDirty && data.liveCount > 0 ? (
        <p className="shrink-0 text-xs text-warn">跟随中的挂载会看到未存档修改。</p>
      ) : null}

      {/* 3. 主操作 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {data.activeDirty ? (
          <>
            <input
              className="min-w-[12rem] flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text"
              placeholder="存档说明（可选）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              disabled={busy}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-50"
              onClick={() =>
                void run(async () => {
                  const r = await saveSkill(data.id, note.trim() || undefined);
                  setNote("");
                  setConfirmDiscard(false);
                  setActiveDiff(null);
                  flash(`已存档 ${r.version.id} · 固定挂载未改动`);
                  return r.skill;
                })
              }
            >
              存档
            </button>
            {!confirmDiscard ? (
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-text disabled:opacity-50"
                onClick={() => setConfirmDiscard(true)}
              >
                丢弃未存档
              </button>
            ) : (
              <span className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-danger">确认丢弃未存档修改？</span>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-md bg-danger px-2 py-1 font-medium text-bg disabled:opacity-50"
                  onClick={() =>
                    void run(async () => {
                      const r = await discardSkill(data.id);
                      setConfirmDiscard(false);
                      setActiveDiff(null);
                      flash("已丢弃未存档修改");
                      return r.skill;
                    })
                  }
                >
                  确认丢弃
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-2 py-1 text-muted"
                  onClick={() => setConfirmDiscard(false)}
                >
                  取消
                </button>
              </span>
            )}
          </>
        ) : data.links.length === 0 ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-50"
            onClick={() =>
              void run(async () => {
                const r = await linkSkill(data.id, { agent: "pi" });
                flash(`已挂载跟随 @${r.link.ref} → ${r.link.to}`);
                return r.skill;
              })
            }
          >
            挂到 pi
          </button>
        ) : (
          <span className="text-xs text-muted">工作区干净</span>
        )}
      </div>

      {/* tabs */}
      <div
        className="flex shrink-0 gap-1 border-b border-border"
        role="tablist"
        aria-label="Skill 分段"
      >
        {(
          [
            ["overview", "概况"],
            ["files", "文件"],
            ["diff", "对比"],
          ] as const
        ).map(([key, label]) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              className={[
                "relative -mb-px rounded-t-md px-3 py-2 text-sm",
                active
                  ? "border border-b-bg border-border bg-bg font-medium text-text"
                  : "text-muted hover:text-text",
              ].join(" ")}
              onClick={() => setTab(key)}
            >
              {label}
              {key === "diff" && data.activeDirty ? (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        className={
          tab === "overview"
            ? "min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
            : "flex min-h-0 flex-1 flex-col overflow-hidden"
        }
      >
      {tab === "files" ? (
        <SkillFiles
          skillId={data.id}
          headId={headId}
          versions={data.versions}
          selectedPath={filePath}
          onSelectPath={setFilePath}
        />
      ) : null}

      {tab === "diff" ? (
        <SkillDiff
          skillId={data.id}
          dirty={data.activeDirty}
          headId={headId}
          versions={data.versions}
          hasGithubUpstream={data.source.kind === "github"}
          diff={activeDiff}
          onDiff={setActiveDiff}
          path={filePath}
        />
      ) : null}

      {tab === "overview" ? (
        <>
          {/* 上游 */}
          <Section title="上游">
            {data.source.kind === "none" ? (
              <p className="text-sm text-muted">无远程上游（file/local）</p>
            ) : data.source.kind === "file" ? (
              <p className="text-sm text-muted">
                file 来源 · <span className="font-mono text-xs">{data.source.label}</span>
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm">
                  <span className="text-muted">记录 </span>
                  <span className="font-mono text-xs">{data.source.label}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-text hover:border-accent/40 disabled:opacity-50"
                    onClick={() =>
                      void (async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          const r = await checkSkill(data.id);
                          setCheck(r.check);
                          setData(r.skill);
                          setConfirmApply(false);
                        } catch (e: unknown) {
                          setError(e instanceof Error ? e.message : String(e));
                        } finally {
                          setBusy(false);
                        }
                      })()
                    }
                  >
                    检查上游
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-text hover:border-accent/40 disabled:opacity-50"
                    onClick={() =>
                      void (async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          const r = await previewUpdate(data.id);
                          setCheck(r.check);
                          setData(r.skill);
                          setConfirmApply(false);
                          onChanged?.();
                          if (r.diff) openDiff(r.diff);
                          else setTab("diff");
                        } catch (e: unknown) {
                          setError(e instanceof Error ? e.message : String(e));
                        } finally {
                          setBusy(false);
                        }
                      })()
                    }
                  >
                    预览更新
                  </button>
                </div>
                {check ? (
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                    <p>
                      <span className="text-muted">状态 </span>
                      <span className="font-mono text-xs">{check.status}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted">{check.message}</p>
                    {check.resolvedCommit ? (
                      <p className="mt-1 font-mono text-[11px] text-muted">
                        commit {check.resolvedCommit.slice(0, 12)}
                      </p>
                    ) : null}
                    {check.status === "upstream-changed" || check.status === "local-diverged" ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {!confirmApply ? (
                          <button
                            type="button"
                            disabled={busy || data.activeDirty}
                            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-50"
                            title={data.activeDirty ? "请先存档或丢弃未存档" : undefined}
                            onClick={() => setConfirmApply(true)}
                          >
                            应用更新{check.status === "local-diverged" ? "（需 force）" : ""}
                          </button>
                        ) : (
                          <span className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-danger">
                              确认 hard-reset 工作区到上游？固定挂载不动。
                            </span>
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded-md bg-danger px-2 py-1 font-medium text-bg disabled:opacity-50"
                              onClick={() =>
                                void run(async () => {
                                  const r = await applyUpdate(
                                    data.id,
                                    check.status === "local-diverged",
                                  );
                                  setCheck(r.check);
                                  setActiveDiff(null);
                                  setConfirmApply(false);
                                  flash(`已应用上游 · HEAD ${r.version.id}`);
                                  return r.skill;
                                })
                              }
                            >
                              确认应用
                            </button>
                            <button
                              type="button"
                              className="rounded-md border border-border px-2 py-1 text-muted"
                              onClick={() => setConfirmApply(false)}
                            >
                              取消
                            </button>
                          </span>
                        )}
                        {data.activeDirty ? (
                          <span className="text-[11px] text-warn">有未存档修改，无法 apply</span>
                        ) : null}
                        {activeDiff ? (
                          <button
                            type="button"
                            className="text-xs text-muted underline hover:text-text"
                            onClick={() => setTab("diff")}
                          >
                            查看预览 diff
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </Section>

          {/* 挂载 */}
          <Section title="挂载">
            {data.links.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted">尚未挂载。</p>
                <div className="flex flex-wrap gap-2">
                  {(["pi", "agents", "claude"] as const).map((agent) => (
                    <button
                      key={agent}
                      type="button"
                      disabled={busy}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm text-text hover:border-accent/40 disabled:opacity-50"
                      onClick={() =>
                        void run(async () => {
                          const r = await linkSkill(data.id, { agent });
                          flash(`已挂载跟随 → ${r.link.to}`);
                          return r.skill;
                        })
                      }
                    >
                      挂到 {agent}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-text disabled:opacity-50"
                    onClick={() =>
                      void run(async () => {
                        const r = await linkSkill(data.id, { agent: "pi", pin: true });
                        flash(`已固定挂载 → ${r.link.to}`);
                        return r.skill;
                      })
                    }
                  >
                    固定挂到 pi
                  </button>
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {data.links.map((l) => (
                  <li
                    key={l.to}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <ModeBadge mode={l.mode} />
                      <span className="font-mono text-xs text-muted">@{l.ref}</span>
                      <div className="ml-auto">
                        {unlinkTo === l.to ? (
                          <span className="flex items-center gap-1 text-xs">
                            <span className="text-danger">确认卸下？</span>
                            <button
                              type="button"
                              disabled={busy}
                              className="rounded-md bg-danger px-2 py-1 text-bg disabled:opacity-50"
                              onClick={() =>
                                void run(async () => {
                                  const r = await unlinkSkill(data.id, l.to);
                                  setUnlinkTo(null);
                                  flash("已卸下挂载");
                                  return r.skill;
                                })
                              }
                            >
                              确认
                            </button>
                            <button
                              type="button"
                              className="rounded-md border border-border px-2 py-1 text-muted"
                              onClick={() => setUnlinkTo(null)}
                            >
                              取消
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text"
                            onClick={() => setUnlinkTo(l.to)}
                          >
                            卸下
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-text" title={l.to}>
                      {l.to}
                    </p>
                    {l.mode === "live" ? (
                      <p className="mt-1 text-xs text-muted">编辑会影响使用此挂载的 session</p>
                    ) : (
                      <p className="mt-1 text-xs text-muted">锁在存档，直到再次固定</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 工作线 */}
          <Section title="工作线">
            <ul className="space-y-1 text-sm">
              {data.branches.map((b) => (
                <li key={b.name} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{b.active ? "●" : "○"}</span>
                  <span className={b.active ? "font-medium" : "text-muted"}>{b.name}</span>
                  {b.active ? <span className="text-[11px] text-accent">正在编辑</span> : null}
                  {b.dirty ? <span className="text-[11px] text-warn">未存档</span> : null}
                  <span className="font-mono text-[11px] text-muted">{b.head}</span>
                </li>
              ))}
            </ul>
          </Section>

          {/* 存档时间线 */}
          <Section title="存档">
            {data.versions.length === 0 ? (
              <p className="text-sm text-muted">无存档</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {(showAllVersions ? data.versions : data.versions.slice(0, 3)).map((v) => (
                  <li
                    key={v.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-xs">{v.id}</span>
                    <span className="text-xs text-muted">{relTime(v.createdAt)}</span>
                    {v.note ? (
                      <span className="max-w-[12rem] truncate text-muted">“{v.note}”</span>
                    ) : null}
                    {v.heads.length ? (
                      <span className="text-[11px] text-accent">HEAD {v.heads.join(", ")}</span>
                    ) : null}
                    <div className="ml-auto">
                      {v.heads.includes(data.activeBranch) ? (
                        <span className="text-[11px] text-muted">当前</span>
                      ) : restoreId === v.id ? (
                        <span className="flex flex-wrap items-center gap-1 text-xs">
                          <span className="text-danger">
                            重置工作区到此存档？{data.activeDirty ? "将丢弃未存档" : ""}
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            className="rounded-md bg-danger px-2 py-1 text-bg disabled:opacity-50"
                            onClick={() =>
                              void run(async () => {
                                const r = await restoreSkill(data.id, v.id, data.activeDirty);
                                setRestoreId(null);
                                setActiveDiff(null);
                                flash(`已重置到 ${v.id}`);
                                return r.skill;
                              })
                            }
                          >
                            确认重置
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-border px-2 py-1 text-muted"
                            onClick={() => setRestoreId(null)}
                          >
                            取消
                          </button>
                        </span>
                      ) : (
                        <span className="flex gap-1">
                          <button
                            type="button"
                            className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text"
                            onClick={() => {
                              setBusy(true);
                              void fetchDiff(data.id, { version: v.id })
                                .then(openDiff)
                                .catch((e: unknown) =>
                                  setError(e instanceof Error ? e.message : String(e)),
                                )
                                .finally(() => setBusy(false));
                            }}
                          >
                            对比工作区
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text"
                            onClick={() => setRestoreId(v.id)}
                          >
                            重置到此
                          </button>
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {data.versionCount > 3 ? (
              <button
                type="button"
                className="text-xs text-muted underline"
                onClick={() => setShowAllVersions((v) => !v)}
              >
                {showAllVersions ? "只看最近 3 条" : `全部 ${data.versionCount} 条`}
              </button>
            ) : null}
          </Section>

          {data.bundles.length > 0 ? (
            <Section title="所在工具包">
              <div className="flex flex-wrap gap-2">
                {data.bundles.map((b) => (
                  <Link
                    key={b}
                    to={`/bundles/${encodeURIComponent(b)}`}
                    className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-text hover:border-accent/40"
                  >
                    {b}
                  </Link>
                ))}
              </div>
            </Section>
          ) : null}

          <details className="border-t border-border pt-4">
            <summary className="cursor-pointer text-xs font-medium text-muted">高级</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
              <dt className="text-muted">manifest</dt>
              <dd className="truncate text-text" title={data.manifestPath}>
                {data.manifestPath}
              </dd>
              <dt className="text-muted">treeHash</dt>
              <dd className="truncate text-text">{data.headTreeHash ?? "—"}</dd>
            </dl>
            <button
              type="button"
              className="mt-2 text-[11px] text-muted underline"
              onClick={() => reload()}
            >
              刷新
            </button>
          </details>
        </>
      ) : null}
      </div>
    </div>
  );
}
