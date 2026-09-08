import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { installSkill, type InstallResult } from "./api";
import { ErrorMessage, useNotify } from "./Controls";
import { useAction } from "./usePolling";

export default function InstallForm({
  onInstalled,
  onClose,
}: {
  onInstalled?: () => void;
  onClose?: () => void;
}) {
  const [source, setSource] = useState("");
  const [agent, setAgent] = useState("");
  const [result, setResult] = useState<InstallResult | null>(null);
  const { busy, error, run } = useAction("install");
  const navigate = useNavigate();
  const notify = useNotify();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!source.trim()) return;
        void run(
          () =>
            installSkill({ source: source.trim(), agent: agent || undefined }),
          (next) => {
            onInstalled?.();
            if (
              next.skills.length === 1 &&
              !next.failed.length &&
              !next.skipped.length
            ) {
              onClose?.();
              navigate(`/skills/${encodeURIComponent(next.skills[0].id)}`);
              notify(`Installed ${next.skills[0].id}`);
            } else setResult(next);
          },
        );
      }}
    >
      <label htmlFor="install-source">GitHub 或本机路径</label>
      <input
        id="install-source"
        autoFocus
        type="text"
        value={source}
        onChange={(e) => {
          setSource(e.target.value);
          setResult(null);
        }}
        placeholder="owner/repo/skills/name"
        disabled={busy}
        required
      />
      <label className="form-field" htmlFor="install-agent">
        挂载到 <span className="muted">· 可选</span>
        <select
          id="install-agent"
          value={agent}
          disabled={busy}
          onChange={(e) => setAgent(e.target.value)}
        >
          <option value="">暂不挂载</option>
          <option value="pi">pi</option>
          <option value="agents">agents</option>
          <option value="claude">Claude</option>
        </select>
      </label>
      <ErrorMessage error={error} />
      {result ? (
        <div className="install-result" role="status">
          <p>
            {result.skills.length} installed · {result.skipped.length} skipped ·{" "}
            {result.failed.length} failed
          </p>
          {result.skills.map((s) => (
            <Link
              key={s.id}
              className="result-link"
              onClick={onClose}
              to={`/skills/${encodeURIComponent(s.id)}`}
            >
              {s.id} <span>Installed ↗</span>
            </Link>
          ))}
          {result.skipped.map((s) => (
            <Link
              key={s.localId}
              className="result-link"
              onClick={onClose}
              to={`/skills/${encodeURIComponent(s.localId)}`}
            >
              {s.localId}
              <span>{s.reason} ↗</span>
            </Link>
          ))}
          {result.failed.map((f, i) => (
            <p className="error-message" key={`${f.path}:${i}`}>
              {f.path}: {f.error}
            </p>
          ))}
        </div>
      ) : null}
      <div className="dialog-actions">
        <button className="button" type="button" onClick={onClose}>
          关闭
        </button>
        <button
          className="button primary"
          type="submit"
          disabled={busy || !source.trim()}
        >
          {busy ? "安装中…" : "安装"}
        </button>
      </div>
    </form>
  );
}
