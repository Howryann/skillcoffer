import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchDoctor, fixDoctorIssue, type DoctorIssue, type DoctorReport } from "./api";

export default function DoctorPage() {
  const [data, setData] = useState<DoctorReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    void fetchDoctor()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">Doctor</h1>
        <p className="text-sm text-danger" role="alert">
          检查接口失败：{error}
        </p>
        <p className="text-xs text-muted">
          若提示 not found，请重新 <span className="font-mono">npm run build && skillcoffer ui</span>
        </p>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs"
          onClick={load}
        >
          重试
        </button>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-muted">检查中…</p>;

  const errors = data.issues.filter((i) => i.severity === "error");
  const warns = data.issues.filter((i) => i.severity === "warn");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Doctor</h1>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text"
          onClick={load}
        >
          重新检查
        </button>
      </div>
      <p className="text-sm text-muted">对账挂载、存档树与工具包成员（不是页面崩溃）。</p>
      <p className="font-mono text-xs text-muted">{data.home}</p>
      <p className="text-sm text-muted">
        {data.skillCount} skill · {data.bundleCount} 工具包 · 发现 {data.issues.length} 项
      </p>

      {data.issues.length === 0 ? (
        <p
          className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-accent"
          role="status"
        >
          未发现异常
        </p>
      ) : (
        <ul className="space-y-2">
          {errors.map((i, idx) => (
            <IssueRow
              key={`e${idx}`}
              issue={i}
              busy={busy}
              onFixed={setData}
              setBusy={setBusy}
              setError={setError}
            />
          ))}
          {warns.map((i, idx) => (
            <IssueRow
              key={`w${idx}`}
              issue={i}
              busy={busy}
              onFixed={setData}
              setBusy={setBusy}
              setError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueRow({
  issue,
  busy,
  onFixed,
  setBusy,
  setError,
}: {
  issue: DoctorIssue;
  busy: boolean;
  onFixed: (d: DoctorReport) => void;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
}) {
  const bad = issue.severity === "error";
  return (
    <li
      className={[
        "rounded-lg border px-3 py-2 text-sm",
        bad ? "border-danger/40 bg-danger/10" : "border-warn/40 bg-warn/10",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={bad ? "text-danger" : "text-warn"}>{bad ? "问题" : "警告"}</span>
        <span className="font-mono text-[11px] text-muted">{issue.code}</span>
      </div>
      <p className="mt-1">{issue.message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {issue.skill ? (
          <Link className="text-accent underline" to={`/skills/${encodeURIComponent(issue.skill)}`}>
            skill {issue.skill}
          </Link>
        ) : null}
        {issue.bundle ? (
          <Link
            className="text-accent underline"
            to={`/bundles/${encodeURIComponent(issue.bundle)}`}
          >
            工具包 {issue.bundle}
          </Link>
        ) : null}
        {issue.fixable === "unlink" && issue.skill && issue.path ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-md border border-border bg-surface px-2 py-0.5 text-text hover:border-accent/40 disabled:opacity-50"
            onClick={() => {
              setBusy(true);
              setError(null);
              void fixDoctorIssue({ fix: "unlink", skill: issue.skill!, path: issue.path! })
                .then(onFixed)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false));
            }}
          >
            卸下坏挂载
          </button>
        ) : null}
      </div>
    </li>
  );
}
