import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./Icons";

export function ErrorMessage({
  error,
  retry,
}: {
  error?: string | null;
  retry?: () => void;
}) {
  return error ? (
    <div className="error-message" role="alert">
      <span>{error}</span>
      {retry ? (
        <button type="button" className="text-button" onClick={retry}>
          重试
        </button>
      ) : null}
    </div>
  ) : null;
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const label = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "dialog-wide" : undefined}
      aria-labelledby={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={label}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="关闭"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}

type ToastAction = { label: string; onClick: () => void };
type Notify = (message: string, action?: ToastAction) => void;
const NotificationContext = createContext<Notify>(() => {});
export const useNotify = () => useContext(NotificationContext);
export function Notifications({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{
    message: string;
    action?: ToastAction;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback<Notify>((message, action) => {
    clearTimeout(timer.current);
    setToast({ message, action });
    timer.current = setTimeout(() => setToast(null), action ? 9000 : 3500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <NotificationContext.Provider value={notify}>
      {children}
      {toast ? (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.action ? (
            <button
              onClick={() => {
                const action = toast.action;
                setToast(null);
                action?.onClick();
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            className="toast-close"
            aria-label="关闭通知"
            onClick={() => setToast(null)}
          >
            <Icon name="close" />
          </button>
        </div>
      ) : null}
    </NotificationContext.Provider>
  );
}
export function CopyBtn({
  text,
  label = "Copy",
  className = "button",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const notify = useNotify();
  const [fallback, setFallback] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          void (async () => {
            try {
              await navigator.clipboard.writeText(text);
              notify("Copied");
            } catch {
              setFallback(true);
            }
          })();
        }}
      >
        <Icon name="copy" />
        {label}
      </button>
      {fallback ? (
        <Dialog title="Copy" onClose={() => setFallback(false)}>
          <input
            aria-label="复制内容"
            value={text}
            readOnly
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        </Dialog>
      ) : null}
    </>
  );
}
export function ModeBadge({
  mode,
  refName,
}: {
  mode: "live" | "pin";
  refName?: string;
}) {
  return (
    <span className={`pill ${mode === "pin" ? "pin" : ""}`} title={refName}>
      {mode}
      {refName ? ` @${mode === "pin" ? shortVersion(refName) : refName}` : ""}
    </span>
  );
}
export function Tabs({
  items,
  value,
  onChange,
  trailing,
}: {
  items: { id: string; label: string; count?: number; marked?: boolean }[];
  value: string;
  onChange: (id: string) => void;
  trailing?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      className="tabs"
      role="tablist"
      aria-label="Skill 内容"
      ref={ref}
      onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const i = items.findIndex((item) => item.id === value);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : (i + (e.key === "ArrowRight" ? 1 : items.length - 1)) %
                items.length;
        onChange(items[next].id);
        (
          ref.current?.querySelectorAll("button")[next] as
            | HTMLButtonElement
            | undefined
        )?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          id={`skill-tab-${item.id}`}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          aria-controls="skill-content"
          tabIndex={item.id === value ? 0 : -1}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count ? (
            <span className="tab-number">{item.count}</span>
          ) : item.marked ? (
            <span className="tab-dot" aria-label="有修改" />
          ) : null}
        </button>
      ))}
      <span className="tab-end">{trailing}</span>
    </div>
  );
}
export function shortVersion(id: string) {
  return id.startsWith("ver_") ? id.slice(-8) : id;
}
export function relativeTime(iso: string) {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return iso;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
export function skillMark(id: string) {
  const parts = id.split(/[-_]/);
  return parts.length === 1
    ? id.slice(0, 2)
    : parts
        .slice(0, 2)
        .map((part) => part[0] ?? "")
        .join("");
}
export function editingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}
export function dialogOpen() {
  return Boolean(document.querySelector("dialog[open]"));
}
