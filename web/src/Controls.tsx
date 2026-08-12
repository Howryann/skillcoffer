import { useState } from "react";

export function CopyBtn({ text, label = "复制" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-text hover:border-accent/50"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "已复制" : label}
    </button>
  );
}

export function ModeBadge({ mode }: { mode: "live" | "pin" }) {
  const live = mode === "live";
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        live ? "bg-accent/15 text-accent" : "bg-pin/15 text-pin",
      ].join(" ")}
    >
      {live ? "跟随" : "固定"}
    </span>
  );
}
