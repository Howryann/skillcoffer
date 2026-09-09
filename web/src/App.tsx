import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { checkUpstreams, fetchOverview, type Overview } from "./api";
import {
  CopyBtn,
  Dialog,
  ErrorMessage,
  Notifications,
  dialogOpen,
  editingTarget,
  skillMark,
  relativeTime,
} from "./Controls";
import { Icon, Logo } from "./Icons";
import CollectionHeader from "./CollectionHeader";
import BundlePage, { BundlesPage } from "./BundlePage";
import InstallForm from "./InstallForm";
import { useAction, usePolling } from "./usePolling";

const SkillPage = lazy(() => import("./SkillPage"));
const DoctorPage = lazy(() => import("./DoctorPage"));

function Shell() {
  const {
    data: overview,
    error,
    reload,
    setData: setOverview,
  } = usePolling("overview", fetchOverview);
  const location = useLocation();
  const navigate = useNavigate();
  const [modal, setModal] = useState<
    "tools" | "store" | "shortcuts" | "install" | "command" | null
  >(null);
  const [theme, setTheme] = useState(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("skillcoffer-theme", theme);
    } catch {
      /* Theme still works in memory. */
    }
  }, [theme]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!dialogOpen()) setModal("command");
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  const bundles = location.pathname.startsWith("/bundles");
  return (
    <>
      <header className="site-head">
        <div className="head-inner">
          <Link className="brand" to="/" aria-label="Skillcoffer">
            <Logo />
            <span>skillcoffer</span>
          </Link>
          <nav className="nav" aria-label="主导航">
            <Link
              to="/"
              aria-current={
                !bundles && location.pathname !== "/doctor" ? "page" : undefined
              }
            >
              Skills
            </Link>
            <Link to="/bundles" aria-current={bundles ? "page" : undefined}>
              Bundles
            </Link>
          </nav>
          <div className="header-tools">
            <span className="local">
              <span className="point" />
              local
            </span>
            <button
              className="icon-button"
              aria-label="搜索与快捷操作"
              title="Quick open · ⌘ / Ctrl K"
              onClick={() => setModal("command")}
            >
              <Icon name="search" />
            </button>
            <button
              className="icon-button"
              aria-label={theme === "light" ? "切换夜色主题" : "切换纸白主题"}
              title={theme === "light" ? "夜色" : "纸白"}
              onClick={() =>
                setTheme((t) => (t === "light" ? "dark" : "light"))
              }
            >
              <Icon name={theme === "light" ? "moon" : "sun"} />
            </button>
            <button
              className="icon-button"
              aria-label="工具菜单"
              onClick={() => setModal("tools")}
            >
              <Icon name="more" />
            </button>
          </div>
        </div>
      </header>
      <main className="app">
        <ErrorMessage error={error} retry={reload} />
        <Suspense fallback={<p className="empty">加载中…</p>}>
          <Routes>
            <Route
              path="/"
              element={
                <Library
                  overview={overview}
                  onChecking={(upstreamCheck) => {
                    if (overview) setOverview({ ...overview, upstreamCheck });
                    reload();
                  }}
                  onInstall={() => setModal("install")}
                  onQuickOpen={() => setModal("command")}
                />
              }
            />
            <Route
              path="/skills/:id"
              element={<SkillPage onChanged={reload} />}
            />
            <Route
              path="/bundles"
              element={<BundlesPage overview={overview} onChanged={reload} />}
            />
            <Route
              path="/bundles/:name"
              element={<BundlePage onChanged={reload} overview={overview} />}
            />
            <Route path="/doctor" element={<DoctorPage />} />
            <Route
              path="*"
              element={
                <div className="empty">
                  未找到页面。<Link to="/">返回 Skills</Link>
                </div>
              }
            />
          </Routes>
        </Suspense>
      </main>
      <footer className="site-foot">
        <span className="word">A little collection. A lot of possibility.</span>
        <div className="preview-switch">
          <button onClick={() => setModal("shortcuts")}>
            Keyboard shortcuts
          </button>
          <span>local · skillcoffer</span>
        </div>
      </footer>
      {modal === "install" ? (
        <Dialog title="安装 Skill" onClose={() => setModal(null)}>
          <InstallForm onInstalled={reload} onClose={() => setModal(null)} />
        </Dialog>
      ) : null}
      {modal === "command" ? (
        <QuickOpen overview={overview} onClose={() => setModal(null)} />
      ) : null}
      {modal === "tools" ? (
        <Dialog title="Tools" onClose={() => setModal(null)}>
          <button
            className="menu-item"
            onClick={() => {
              setModal(null);
              navigate("/doctor");
            }}
          >
            <Icon name="check" />
            Doctor
          </button>
          <button className="menu-item" onClick={() => setModal("store")}>
            <Icon name="file" />
            Store
          </button>
          <div className="menu-divider" />
          <button className="menu-item" onClick={() => setModal("shortcuts")}>
            <Icon name="terminal" />
            Keyboard shortcuts
          </button>
        </Dialog>
      ) : null}
      {modal === "store" ? (
        <Dialog title="Store" onClose={() => setModal(null)}>
          <div className="dialog-path">{overview?.home ?? "加载中…"}</div>
          {overview ? (
            <>
              <p>
                {overview.skills.length} skills · {overview.bundles.length}{" "}
                bundles
              </p>
              <div className="dialog-actions">
                <CopyBtn text={overview.home} label="Path" />
              </div>
            </>
          ) : null}
        </Dialog>
      ) : null}
      {modal === "shortcuts" ? (
        <Dialog title="Keyboard shortcuts" onClose={() => setModal(null)}>
          <div className="shortcuts">
            <span>Quick open</span>
            <kbd>⌘ / Ctrl K</kbd>
            <span>搜索 Skills</span>
            <kbd>/</kbd>
            <span>保存版本</span>
            <kbd>⌘ / Ctrl S</kbd>
            <span>切换文件标签</span>
            <kbd>← / →</kbd>
            <span>关闭弹层</span>
            <kbd>Esc</kbd>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
function Library({
  overview,
  onChecking,
  onInstall,
  onQuickOpen,
}: {
  overview: Overview | null;
  onChecking: (progress: NonNullable<Overview["upstreamCheck"]>) => void;
  onInstall: () => void;
  onQuickOpen: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const q = params.get("q") ?? "";
  const source = params.get("source");
  const modified = params.get("modified") === "1";
  const updatesOnly = params.get("updates") === "1";
  const checkAction = useAction("upstream-check");
  const progress = overview?.upstreamCheck;
  const checking = checkAction.busy || Boolean(progress?.running);
  const updateCount = overview?.skills.filter(s => s.upstream?.status === "available").length ?? 0;
  const failedCount = overview?.skills.filter(s => s.upstream?.status === "failed").length ?? 0;
  const checkedAt = overview?.skills.flatMap(s => s.upstream ? [s.upstream.checkedAt] : []).sort().at(-1);
  const checkHint = [
    checkedAt ? `上次检查 ${relativeTime(checkedAt)}` : "检查所有 GitHub 来源的 Skills",
    failedCount ? `${failedCount} 个检查失败，可重试` : "",
  ].filter(Boolean).join(" · ");
  const change = (key: string, value?: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const filter = (group?: string, dirty = false) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("source");
        next.delete("modified");
        next.delete("updates");
        if (group) next.set("source", group);
        if (dirty) next.set("modified", "1");
        return next;
      },
      { replace: true },
    );
  useEffect(() => {
    document.title = "Skills · skillcoffer";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !editingTarget(e.target) && !dialogOpen()) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; count: number }
    >();
    for (const skill of overview?.skills ?? []) {
      const key = localSource(skill.groupKey) ? "local" : skill.groupKey;
      const group = map.get(key);
      if (group) group.count++;
      else
        map.set(key, {
          key,
          label: key === "local" ? "本地" : skill.groupLabel,
          count: 1,
        });
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [overview]);
  const rows = (overview?.skills ?? []).filter(
    (s) =>
      (!source ||
        (source === "local"
          ? localSource(s.groupKey)
          : s.groupKey === source)) &&
      (!modified || s.dirty) &&
      (!updatesOnly || s.upstream?.status === "available") &&
      `${s.id} ${s.name} ${s.description} ${s.groupLabel}`
        .toLowerCase()
        .includes(q.trim().toLowerCase()),
  );
  const dirtyCount = overview?.skills.filter((s) => s.dirty).length ?? 0;
  return (
    <>
      <CollectionHeader
        title="Skills"
        count={overview?.skills.length}
        subtitle="管理你的 Skills。"
        actionLabel="安装 Skill"
        onAction={onInstall}
      />
      <div className="library">
        <aside className="sources" aria-label="筛选">
          <div className="section-label">Collection</div>
          <button
            className={`source-button ${!source && !modified && !updatesOnly ? "active" : ""}`}
            aria-pressed={!source && !modified && !updatesOnly}
            onClick={() => filter()}
          >
            <span>全部</span>
            <span className="number">{overview?.skills.length ?? 0}</span>
          </button>
          <button
            className={`source-button ${modified ? "active" : ""}`}
            aria-pressed={modified}
            onClick={() => filter(undefined, true)}
          >
            <span>Modified</span>
            <span className="number">{dirtyCount}</span>
          </button>
          <div className="sources-rule" />
          <div className="section-label">Sources</div>
          {groups.map((group) => (
            <button
              key={group.key}
              className={`source-button ${source === group.key ? "active" : ""}`}
              title={group.label}
              aria-pressed={source === group.key}
              onClick={() => filter(group.key)}
            >
              <span className="source-name">{sourceName(group.label)}</span>
              <span className="number">{group.count}</span>
            </button>
          ))}
          <p className="source-small mono" title={overview?.home}>
            {overview?.home}
          </p>
        </aside>
        <section className="list-area" aria-label="Skill 列表">
          <div className="list-toolbar">
            <label className="search">
              <Icon name="search" />
              <span className="sr-only">搜索 Skill、描述或来源</span>
              <input
                ref={input}
                id="skill-search"
                value={q}
                onChange={(e) => change("q", e.target.value)}
                placeholder="Find a skill…"
                autoComplete="off"
              />
              <span className="key">/</span>
            </label>
            <div className="upstream-toolbar" aria-live="polite">
              {updateCount > 0 || updatesOnly ? (
                <button
                  className={`update-count ${updatesOnly ? "active" : ""}`}
                  aria-pressed={updatesOnly}
                  onClick={() => change("updates", updatesOnly ? undefined : "1")}
                >
                  {updateCount} 个有更新
                </button>
              ) : null}
              {failedCount > 0 ? <span className="small muted" title={checkHint}>{failedCount} 个检查失败</span> : null}
              <button
                className="text-button check-upstreams"
                disabled={checking || !overview?.skills.some(s => !localSource(s.groupKey))}
                title={checkHint}
                onClick={() => void checkAction.run(checkUpstreams, onChecking)}
              >
                <Icon name="refresh" />
                {checking ? `检查中 ${progress?.completed ?? 0}/${progress?.total ?? 0}` : "检查更新"}
              </button>
            </div>
          </div>
          <ErrorMessage error={checkAction.error || progress?.error || null} />
          {!overview ? (
            <p className="empty">加载中…</p>
          ) : rows.length ? (
            rows.map((s) => (
              <article className="skill-row" key={s.id}>
                <span className="skill-symbol" aria-hidden="true">
                  {skillMark(s.id)}
                </span>
                <div className="skill-info">
                  <div className="skill-name-line">
                    <Link
                      className="skill-link"
                      to={`/skills/${encodeURIComponent(s.id)}`}
                    >
                      {s.id}
                    </Link>
                    {s.upstream?.status === "available" ? (
                      <Link
                        className="upstream-mark"
                        to={`/skills/${encodeURIComponent(s.id)}?${new URLSearchParams({ upstream: "1", branch: s.activeBranch })}`}
                        aria-label={`查看 ${s.id} 的上游更新`}
                      >
                        <span className="point" />有更新
                      </Link>
                    ) : s.upstream?.status === "failed" || s.upstream?.status === "unknown" ? (
                      <Link
                        className="upstream-note"
                        title={s.upstream.message}
                        to={`/skills/${encodeURIComponent(s.id)}?${new URLSearchParams({ upstream: "1", branch: s.activeBranch })}`}
                      >
                        {s.upstream.status === "failed" ? "检查失败" : "基线未知"}
                      </Link>
                    ) : null}
                  </div>
                  <p className="skill-description" title={s.description}>
                    {s.description || s.name}
                  </p>
                </div>
                <span className="skill-origin" title={s.groupLabel}>
                  {sourceName(s.groupLabel, true)}
                </span>
                <div className="skill-state">
                  {s.dirty ? (
                    <>
                      <Link
                        className="delta"
                        to={`/skills/${encodeURIComponent(s.id)}?${new URLSearchParams({ tab: "changes", branch: s.activeBranch })}`}
                      >
                        Modified
                      </Link>
                      <span className="branch-short" title={s.activeBranch}>
                        {s.activeBranch}
                      </span>
                    </>
                  ) : (
                    <span className="mono" title={s.activeBranch}>
                      {s.activeBranch}
                    </span>
                  )}
                </div>
              </article>
            ))
          ) : (
            <div className="empty">
              {overview.skills.length ? (
                <>
                  没有匹配的 Skill。
                  <button className="text-button" onClick={() => setParams({})}>
                    清除筛选
                  </button>
                </>
              ) : (
                <>
                  <p>从 GitHub 或本机目录安装第一个 Skill。</p>
                  <button className="button" onClick={onInstall}>
                    <Icon name="plus" />
                    安装 Skill
                  </button>
                </>
              )}
            </div>
          )}
          <div className="list-bottom">
            <span>{rows.length} skills</span>
            <button className="link" onClick={onQuickOpen}>
              Quick open <span className="key">⌘ K</span>
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
function localSource(label: string) {
  return label.startsWith("/") || label.startsWith("~") || label === "本地";
}
function sourceName(label: string, full = false) {
  if (localSource(label)) return full ? "local" : "本地";
  return full ? label : label.split("/")[0];
}
function QuickOpen({
  overview,
  onClose,
}: {
  overview: Overview | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const items = [
    ...(overview?.skills ?? []).map((s) => ({
      name: s.id,
      search: `${s.id} ${s.description} ${s.groupLabel}`,
      type: "skill",
      path: `/skills/${encodeURIComponent(s.id)}`,
    })),
    ...(overview?.bundles ?? []).map((b) => ({
      name: b.name,
      search: b.name,
      type: "bundle",
      path: `/bundles/${encodeURIComponent(b.name)}`,
    })),
  ]
    .filter((item) =>
      item.search.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .slice(0, 30);
  const open = (path: string) => {
    onClose();
    navigate(path);
  };
  return (
    <Dialog title="Quick open" onClose={onClose}>
      <div
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const next =
              (index + (e.key === "ArrowDown" ? 1 : items.length - 1)) %
              Math.max(items.length, 1);
            setIndex(next);
            refs.current[next]?.scrollIntoView({ block: "nearest" });
          }
          if (
            e.key === "Enter" &&
            e.target instanceof HTMLInputElement &&
            items[index]
          ) {
            e.preventDefault();
            open(items[index].path);
          }
        }}
      >
        <input
          className="command-search"
          autoFocus
          role="combobox"
          aria-label="搜索资源"
          aria-expanded="true"
          aria-controls="quick-results"
          aria-activedescendant={items[index] ? `quick-${index}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          placeholder="Find a skill or bundle…"
        />
        <div className="command-results" role="listbox" id="quick-results">
          {items.map((item, i) => (
            <button
              ref={(el) => {
                refs.current[i] = el;
              }}
              className={`command-option ${i === index ? "selected" : ""}`}
              id={`quick-${i}`}
              role="option"
              aria-selected={i === index}
              key={item.path}
              onMouseEnter={() => setIndex(i)}
              onClick={() => open(item.path)}
            >
              <Icon name={item.type === "skill" ? "file" : "terminal"} />
              <span>{item.name}</span>
              <small>{item.type}</small>
            </button>
          ))}
          {!items.length ? <p className="empty">无匹配。</p> : null}
        </div>
      </div>
    </Dialog>
  );
}
export default function App() {
  return (
    <Notifications>
      <Shell />
    </Notifications>
  );
}
