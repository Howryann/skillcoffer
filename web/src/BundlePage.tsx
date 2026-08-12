import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  addBundleMember,
  deleteBundle,
  fetchBundle,
  removeBundleMember,
  setBundleMemberMode,
  type BundleDetail,
} from "./api";
import { CopyBtn, ModeBadge } from "./Controls";
import { usePolling } from "./usePolling";

export default function BundlePage({ onChanged }: { onChanged?: () => void }) {
  const { name } = useParams();
  const nav = useNavigate();
  const { data, error, setData, reload, setError } = usePolling(name, fetchBundle, {
    clearOnError: true,
  });
  const [busy, setBusy] = useState(false);
  const [addPin, setAddPin] = useState(false);
  const [addFilter, setAddFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (error) {
    return (
      <p className="text-sm text-danger" role="alert">
        {error}
      </p>
    );
  }
  if (!data) return <p className="text-sm text-muted">加载中…</p>;

  const run = async (fn: () => Promise<BundleDetail | void>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next) setData(next);
      else reload();
      onChanged?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. 身份 */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{data.name}</h1>
          <span className="text-sm text-muted">{data.members.length} 个 skill</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface px-2 py-1.5 font-mono text-xs">
            {data.path}
          </code>
          <CopyBtn text={data.path} label="复制 path" />
        </div>
      </div>

      {/* 2. 启动卡 */}
      <section
        className="space-y-2 rounded-lg border border-border bg-surface px-4 py-3"
        aria-label="启动会话"
      >
        <p className="text-xs text-muted">启动会话（复制到终端，不在此执行）</p>
        <pre className="overflow-x-auto font-mono text-sm text-accent">{data.piCommand}</pre>
        <div className="flex flex-wrap gap-2">
          <CopyBtn text={data.piCommand} label="复制命令" />
          <CopyBtn text={data.piPrintCommand} label="复制 --print" />
        </div>
        <p className="text-xs text-muted">
          session 级 <span className="font-mono">--skill</span>，不改全局挂载。工具包 ≠ 挂载。
        </p>
        {data.dirtyLiveCount > 0 ? (
          <p className="text-xs text-warn" role="status">
            {data.dirtyLiveCount} 个跟随成员有未存档修改，会进入 pi session。
          </p>
        ) : null}
      </section>

      {/* 3. 成员 */}
      <section className="space-y-2 border-t border-border pt-4">
        <h2 className="text-xs font-medium text-muted">成员</h2>
        {data.members.length === 0 ? (
          <p className="text-sm text-muted">还没有成员，在下方添加 skill。</p>
        ) : (
          <ul className="space-y-2">
            {data.members.map((m) => (
              <li
                key={m.skill}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                <span
                  className={[
                    "inline-block h-1.5 w-1.5 rounded-full",
                    m.dirty && m.mode === "live" ? "bg-warn" : "bg-accent",
                  ].join(" ")}
                  aria-hidden
                />
                <Link
                  to={`/skills/${encodeURIComponent(m.skill)}`}
                  className="font-medium text-text hover:text-accent"
                >
                  {m.skill}
                </Link>
                <ModeBadge mode={m.mode} />
                {m.dirty && m.mode === "live" ? (
                  <span className="text-[11px] text-warn">未存档</span>
                ) : null}
                <div className="ml-auto flex flex-wrap gap-1">
                  {m.mode === "live" ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:text-text disabled:opacity-50"
                      onClick={() => void run(() => setBundleMemberMode(data.name, m.skill, true))}
                    >
                      改为固定
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted hover:text-text disabled:opacity-50"
                      onClick={() => void run(() => setBundleMemberMode(data.name, m.skill, false))}
                    >
                      改为跟随
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-md border border-border px-2 py-0.5 text-[11px] text-danger/90 hover:border-danger/40 disabled:opacity-50"
                    onClick={() => void run(() => removeBundleMember(data.name, m.skill))}
                  >
                    移出
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. 添加：点一下就加，不走下拉 */}
      <section className="space-y-2 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xs font-medium text-muted">添加 skill</h2>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={addPin}
              onChange={(e) => setAddPin(e.target.checked)}
            />
            以固定存档加入
          </label>
        </div>
        {data.availableSkills.length === 0 ? (
          <p className="text-sm text-muted">没有可添加的 skill（都已在包内，或商店为空）。</p>
        ) : (
          <>
            {data.availableSkills.length > 6 ? (
              <input
                className="w-full max-w-xs rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text placeholder:text-muted"
                placeholder="过滤 skill…"
                value={addFilter}
                onChange={(e) => setAddFilter(e.target.value)}
              />
            ) : null}
            <ul className="space-y-1">
              {data.availableSkills
                .filter((s) => {
                  const q = addFilter.trim().toLowerCase();
                  return !q || s.toLowerCase().includes(q);
                })
                .map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      disabled={busy}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm text-text hover:border-accent/50 disabled:opacity-50"
                      onClick={() =>
                        void run(async () => {
                          const d = await addBundleMember(data.name, s, addPin);
                          setAddFilter("");
                          return d;
                        })
                      }
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{s}</span>
                      <span className="shrink-0 text-xs text-accent">
                        {addPin ? "固定加入" : "跟随加入"}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>

      {/* 5. 危险区 */}
      <details className="border-t border-border pt-4">
        <summary className="cursor-pointer text-xs font-medium text-muted">危险区</summary>
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted">删除工具包不会删除 skill 本体。</p>
          {!confirmDelete ? (
            <button
              type="button"
              className="rounded-md border border-danger/40 px-2 py-1 text-xs text-danger"
              onClick={() => setConfirmDelete(true)}
            >
              删除工具包…
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-danger">确认删除 {data.name}？</span>
              <button
                type="button"
                disabled={busy}
                className="rounded-md bg-danger px-2 py-1 text-xs font-medium text-bg disabled:opacity-50"
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      await deleteBundle(data.name);
                      onChanged?.();
                      nav("/");
                    } catch (e: unknown) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(false);
                      setConfirmDelete(false);
                    }
                  })()
                }
              >
                确认删除
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs text-muted"
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
