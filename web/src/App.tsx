import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { createBundle, fetchDoctor, fetchOverview, type Overview } from "./api";
import BundlePage from "./BundlePage";
import DoctorPage from "./DoctorPage";
import InstallForm from "./InstallForm";
import SkillPage from "./SkillPage";
import { usePolling } from "./usePolling";

function Shell({
  overview,
  error,
  reload,
}: {
  overview: Overview | null;
  error: string | null;
  reload: () => void;
}) {
  const nav = useNavigate();
  const { data: doctor } = usePolling("doctor", fetchDoctor, { intervalMs: 15000 });
  const doctorErrors = doctor?.issues.filter((issue) => issue.severity === "error").length ?? 0;
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [searchEl, setSearchEl] = useState<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchEl?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchEl]);

  const skills = useMemo(() => {
    const list = overview?.skills ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((x) => x.id.toLowerCase().includes(s) || x.name.toLowerCase().includes(s));
  }, [overview, q]);

  const bundles = useMemo(() => {
    const list = overview?.bundles ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((x) => x.name.toLowerCase().includes(s));
  }, [overview, q]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <NavLink to="/" className="text-sm font-semibold tracking-tight text-text">
          skillcoffer
        </NavLink>
        <label className="relative min-w-0 flex-1 max-w-sm">
          <span className="sr-only">搜索 skill 或工具包</span>
          <input
            ref={setSearchEl}
            className="w-full rounded-md border border-border bg-bg px-2 py-1 text-xs text-text placeholder:text-muted"
            placeholder="搜索…  (/)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <NavLink
          to="/doctor"
          className={({ isActive }) =>
            [
              "rounded-md px-2 py-1 text-xs",
              isActive ? "bg-surface-2 text-text" : "text-muted hover:text-text",
            ].join(" ")
          }
        >
          Doctor
          {doctorErrors > 0 ? (
            <span className="ml-1 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-medium text-bg">
              {doctorErrors}
            </span>
          ) : null}
        </NavLink>
        <div className="max-w-[40%] truncate font-mono text-xs text-muted" title={overview?.home}>
          {overview?.home ?? "…"}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface">
          <SectionLabel>Skills</SectionLabel>
          <nav className="px-2 pb-2" aria-label="Skills">
            {skills.length ? (
              skills.map((s) => (
                <SideLink key={s.id} to={`/skills/${s.id}`} dirty={s.dirty}>
                  {s.id}
                </SideLink>
              ))
            ) : (
              <EmptyHint>{overview?.skills.length ? "无匹配" : "还没有 skill"}</EmptyHint>
            )}
          </nav>

          <SectionLabel>Bundles</SectionLabel>
          <nav className="px-2 pb-1" aria-label="Bundles">
            {bundles.length ? (
              bundles.map((b) => (
                <SideLink
                  key={b.name}
                  to={`/bundles/${b.name}`}
                  dirty={b.dirtyLiveCount > 0}
                  label={`${b.name}，${b.memberCount} 个成员`}
                >
                  <span>{b.name}</span>
                  <span className="ml-auto text-[11px] text-muted">{b.memberCount}</span>
                </SideLink>
              ))
            ) : (
              <EmptyHint>{overview?.bundles.length ? "无匹配" : "还没有工具包"}</EmptyHint>
            )}
          </nav>
          <div className="px-2 pb-3">
            {!creating ? (
              <button
                type="button"
                className="w-full rounded-lg border border-dashed border-border px-2 py-1.5 text-left text-xs text-muted hover:border-accent/40 hover:text-text"
                onClick={() => {
                  setCreating(true);
                  setCreateErr(null);
                }}
              >
                + 新建工具包
              </button>
            ) : (
              <form
                className="space-y-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newName.trim();
                  if (!name) return;
                  void createBundle(name)
                    .then(() => {
                      setNewName("");
                      setCreating(false);
                      reload();
                      nav(`/bundles/${encodeURIComponent(name)}`);
                    })
                    .catch((err: unknown) =>
                      setCreateErr(err instanceof Error ? err.message : String(err)),
                    );
                }}
              >
                <input
                  autoFocus
                  className="w-full rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-text"
                  placeholder="名称"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                {createErr ? <p className="text-[11px] text-danger">{createErr}</p> : null}
                <div className="flex gap-1">
                  <button
                    type="submit"
                    className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-bg"
                  >
                    创建
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted"
                    onClick={() => {
                      setCreating(false);
                      setCreateErr(null);
                    }}
                  >
                    取消
                  </button>
                </div>
              </form>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-6">
          {/* One content column for every route — pages must not set their own max-w */}
          <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col">
            {error ? (
              <p className="mb-3 shrink-0 text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
              <Routes>
                <Route path="/" element={<Home overview={overview} onInstalled={reload} />} />
                <Route path="/skills/:id" element={<SkillPage onChanged={reload} />} />
                <Route path="/bundles/:name" element={<BundlePage onChanged={reload} />} />
                <Route path="/doctor" element={<DoctorPage />} />
                <Route path="*" element={<p className="text-sm text-muted">未找到页面</p>} />
              </Routes>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted">
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-xs text-muted">{children}</p>;
}

function SideLink({
  to,
  dirty,
  children,
  label,
}: {
  to: string;
  dirty?: boolean;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      className={({ isActive }) =>
        [
          "mb-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
          isActive ? "bg-surface-2 text-text" : "text-text/90 hover:bg-surface-2/70",
        ].join(" ")
      }
    >
      <span
        className={[
          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
          dirty ? "bg-warn" : "bg-accent",
        ].join(" ")}
        aria-hidden
      />
      {children}
    </NavLink>
  );
}

function Home({
  overview,
  onInstalled,
}: {
  overview: Overview | null;
  onInstalled?: () => void;
}) {
  if (!overview) return <p className="text-sm text-muted">加载中…</p>;
  const n = overview.skills.length;
  const b = overview.bundles.length;
  const dirty = overview.skills.filter((s) => s.dirty).length;

  if (n === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">还没有 skill</h1>
        <p className="text-sm text-muted">从本机目录或公开 GitHub 安装一个。</p>
        <InstallForm onInstalled={onInstalled} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">总览</h1>
      <p className="text-sm text-muted">
        {n} 个 skill · {b} 个工具包
        {dirty ? ` · ${dirty} 个有未存档修改` : ""}
      </p>
      <p className="text-sm text-muted">选 skill 看状态，或打开工具包复制 pi 启动命令。</p>
      <details className="border-t border-border pt-4">
        <summary className="cursor-pointer text-xs font-medium text-muted">安装更多 skill</summary>
        <div className="mt-3">
          <InstallForm onInstalled={onInstalled} />
        </div>
      </details>
    </div>
  );
}

export default function App() {
  const { data, error, reload } = usePolling("overview", fetchOverview);
  return <Shell overview={data} error={error} reload={reload} />;
}
