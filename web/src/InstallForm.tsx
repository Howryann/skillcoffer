import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { installSkill } from "./api";

export default function InstallForm({ onInstalled }: { onInstalled?: () => void }) {
  const nav = useNavigate();
  const [source, setSource] = useState("");
  const [agent, setAgent] = useState<"" | "pi" | "agents" | "claude">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const src = source.trim();
        if (!src) return;
        setBusy(true);
        setError(null);
        void installSkill({ source: src, agent: agent || undefined })
          .then((r) => {
            onInstalled?.();
            nav(`/skills/${encodeURIComponent(r.skill.id)}`);
          })
          .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false));
      }}
    >
      <label className="block space-y-1">
        <span className="text-xs text-muted">本机路径或 owner/repo[/path]</span>
        <input
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm text-text"
          placeholder="./examples/demo-skill 或 anthropics/skills/skills/pdf"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          disabled={busy}
          required
        />
      </label>
      <fieldset className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <legend className="sr-only">可选挂载</legend>
        <span>可选挂到</span>
        {(
          [
            ["", "暂不"],
            ["pi", "pi"],
            ["agents", "agents"],
            ["claude", "claude"],
          ] as const
        ).map(([v, label]) => (
          <label key={v || "none"} className="flex items-center gap-1 text-text">
            <input
              type="radio"
              name="agent"
              checked={agent === v}
              onChange={() => setAgent(v)}
              disabled={busy}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || !source.trim()}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
      >
        {busy ? "安装中…" : "安装"}
      </button>
      <p className="text-xs text-muted">示例：仓库内 examples/demo-skill 的绝对路径</p>
    </form>
  );
}
