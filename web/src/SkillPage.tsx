import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  applyUpdate,
  checkSkill,
  discardSkill,
  fetchSkill,
  linkSkill,
  previewUpdate,
  restoreSkill,
  saveSkill,
  unlinkSkill,
  type CheckResult,
  type LinkOptions,
  type SkillDetail,
  type UpdatePreview,
} from "./api";
import {
  CopyBtn,
  Dialog,
  ErrorMessage,
  ModeBadge,
  Tabs,
  dialogOpen,
  relativeTime,
  shortVersion,
  useNotify,
} from "./Controls";
import { Icon } from "./Icons";
import { DiffPane, SkillDiff, SkillFiles } from "./SkillBrowse";
import { useAction, usePolling } from "./usePolling";

type Modal =
  | "menu"
  | "save"
  | "links"
  | "upstream"
  | "discard"
  | "restore"
  | "info"
  | null;
export default function SkillPage({ onChanged }: { onChanged?: () => void }) {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const branch = params.get("branch") ?? undefined;
  return (
    <SkillContent
      key={JSON.stringify([id, branch])}
      id={id}
      selectedBranch={branch}
      onChanged={onChanged}
    />
  );
}
function SkillContent({
  id,
  selectedBranch,
  onChanged,
}: {
  id: string;
  selectedBranch?: string;
  onChanged?: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const action = useAction(JSON.stringify([id, selectedBranch]));
  const resource = usePolling(
    JSON.stringify([id, selectedBranch]),
    () => fetchSkill(id, selectedBranch),
    { paused: action.busy },
  );
  const data = resource.data;
  const [modal, setModal] = useState<Modal>(null);
  const [note, setNote] = useState("");
  const [restoreId, setRestoreId] = useState("");
  const [limit, setLimit] = useState(15);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const notify = useNotify();
  const tab = ["files", "changes", "versions"].includes(params.get("tab") ?? "")
    ? params.get("tab")!
    : "files";
  const open = (next: Modal) => {
    action.setError(null);
    setModal(next);
  };
  const setTab = (nextTab: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("tab", nextTab);
      return next;
    });
  useEffect(() => {
    document.title = `${id} · skillcoffer`;
  }, [id]);
  useEffect(() => {
    if (data && !selectedBranch) {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("branch", data.branch);
          return next;
        },
        { replace: true },
      );
    }
  }, [data?.branch, selectedBranch, setParams]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (data?.dirty && !action.busy && !dialogOpen()) setModal("save");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data?.dirty, action.busy]);
  if (!data)
    return (
      <>
        <ErrorMessage error={resource.error} retry={resource.reload} />
        <p className="empty">{resource.error ? "" : "加载中…"}</p>
      </>
    );
  const head = data.branches.find((b) => b.name === data.branch)?.head ?? "";
  const update = (next: SkillDetail) => {
    resource.setData(next);
    onChanged?.();
  };
  const perform = <T extends { skill: SkillDetail }>(
    operation: () => Promise<T>,
    done: (result: T) => void,
  ) => {
    void action.run(operation, (result) => {
      update(result.skill);
      done(result);
    });
  };
  const compare = (version: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("tab", "changes");
      next.set("left", version);
      next.set("right", "work");
      next.delete("scope");
      return next;
    });
  const titles: Record<Exclude<Modal, null>, string> = {
    menu: data.id,
    save: "保存版本",
    links: "Links",
    upstream: "Upstream",
    discard: "丢弃未保存修改",
    restore: `恢复到 ${shortVersion(restoreId)}`,
    info: "Skill info",
  };
  return (
    <>
      <div className="breadcrumb">
        <Link to="/">
          <Icon name="back" /> Skills
        </Link>
        <span className="divider">/</span>
        <span className="mono source-label" title={data.source.label}>
          {data.source.label}
        </span>
      </div>
      <div className="detail-head">
        <div>
          <h1 className="detail-title">{data.id}</h1>
          <p className="detail-description" title={data.description}>
            {data.description}
          </p>
        </div>
        <div className="detail-actions">
          <CopyBtn text={data.path} label="Path" />
          <button
            className="button primary"
            disabled={!data.dirty || action.busy}
            onClick={() => open("save")}
          >
            保存
          </button>
          <button
            className="icon-button"
            aria-label="Skill 更多操作"
            onClick={() => open("menu")}
          >
            <Icon name="more" />
          </button>
        </div>
      </div>
      <div className="detail-meta">
        <label className="row">
          <Icon name="branch" />
          <span className="sr-only">工作线</span>
          <select
            className="branch-select"
            aria-label="工作线"
            disabled={action.busy}
            value={data.branch}
            onChange={(e) =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set("branch", e.target.value);
                next.delete("ref");
                next.delete("left");
                next.delete("right");
                next.delete("scope");
                return next;
              })
            }
          >
            {data.branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        {data.dirty ? (
          <button
            className="pill dirty"
            onClick={() => {
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set("tab", "changes");
                for (const key of ["left", "right", "scope"]) next.delete(key);
                return next;
              });
            }}
          >
            Modified
          </button>
        ) : (
          <span className="mono" title={head}>
            {shortVersion(head)}
          </span>
        )}
        <span className="divider">/</span>
        <button className="meta-link" onClick={() => open("links")}>
          <Icon name="link" />
          {data.links[0] ? (
            <>
              {linkLabel(data.links[0].to)} {data.links[0].mode} @
              {data.links[0].mode === "pin"
                ? shortVersion(data.links[0].ref)
                : data.links[0].ref}
              {data.links.length > 1 ? ` +${data.links.length - 1}` : ""}
            </>
          ) : (
            "Links"
          )}
        </button>
      </div>
      <ErrorMessage
        error={resource.error || (!modal ? action.error : null)}
        retry={resource.reload}
      />
      <Tabs
        value={tab}
        items={[
          { id: "files", label: "Files" },
          { id: "changes", label: "Changes", marked: data.dirty },
          { id: "versions", label: "Versions" },
        ]}
        onChange={setTab}
        trailing={
          data.source.kind === "github" ? data.source.label : "local source"
        }
      />
      <section
        id="skill-content"
        role="tabpanel"
        aria-labelledby={`skill-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "files" ? (
          <SkillFiles
            skillId={data.id}
            branch={data.branch}
            versions={data.versions}
          />
        ) : null}
        {tab === "changes" ? (
          <SkillDiff
            skillId={data.id}
            branch={data.branch}
            versions={data.versions}
            headId={head}
            dirty={data.dirty}
            onSave={() => open("save")}
          />
        ) : null}
        {tab === "versions" ? (
          <div className="history">
            {data.versions.slice(0, limit).map((version) => (
              <div className="history-row" key={version.id}>
                <span
                  className={`history-mark ${version.id === head ? "current" : ""}`}
                />
                <div>
                  <div className="history-title">
                    {version.note || `Version ${shortVersion(version.id)}`}
                  </div>
                  <div className="history-sub" title={version.id}>
                    {shortVersion(version.id)} · {version.source}
                    {version.heads.length
                      ? ` · HEAD ${version.heads.join(", ")}`
                      : ""}
                  </div>
                </div>
                <div className="history-end">
                  <time
                    title={new Date(version.createdAt).toLocaleString()}
                    dateTime={version.createdAt}
                  >
                    {relativeTime(version.createdAt)}
                  </time>
                  <button onClick={() => compare(version.id)}>Compare</button>
                  {version.id !== head ? (
                    <button
                      disabled={action.busy}
                      onClick={() => {
                        setRestoreId(version.id);
                        open("restore");
                      }}
                    >
                      Restore ↗
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {limit < data.versions.length ? (
              <button
                className="text-button more-versions"
                onClick={() => setLimit((n) => n + 30)}
              >
                更多 · {data.versionCount} versions
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
      {modal ? (
        <Dialog
          title={titles[modal]}
          wide={modal === "upstream" && Boolean(preview?.diff)}
          onClose={() => setModal(null)}
        >
          <ErrorMessage error={action.error} />
          {modal === "menu" ? (
            <>
              <button className="menu-item" onClick={() => open("links")}>
                <Icon name="link" />
                Links
              </button>
              {data.source.kind === "github" ? (
                <button className="menu-item" onClick={() => open("upstream")}>
                  <Icon name="branch" />
                  Upstream
                </button>
              ) : null}
              <button className="menu-item" onClick={() => open("info")}>
                <Icon name="file" />
                Skill info
              </button>
              {data.dirty ? (
                <>
                  <div className="menu-divider" />
                  <button
                    className="menu-item danger-text"
                    onClick={() => open("discard")}
                  >
                    丢弃修改
                  </button>
                </>
              ) : null}
            </>
          ) : null}
          {modal === "save" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                perform(
                  () =>
                    saveSkill(data.id, note.trim() || undefined, data.branch),
                  (result) => {
                    setNote("");
                    setModal(null);
                    notify(
                      `Saved ${shortVersion(result.version.id)} · ${data.branch}`,
                    );
                  },
                );
              }}
            >
              <div className="dialog-meta">
                {data.id} / {data.branch}
              </div>
              <label htmlFor="save-note">
                说明 <span className="muted">· 可选</span>
              </label>
              <input
                id="save-note"
                type="text"
                autoFocus
                value={note}
                disabled={action.busy}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What changed?"
              />
              <div className="dialog-actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => setModal(null)}
                >
                  取消
                </button>
                <button
                  className="button primary"
                  type="submit"
                  disabled={action.busy}
                >
                  {action.busy ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          ) : null}
          {modal === "discard" || modal === "restore" ? (
            <>
              <div className="dialog-meta">
                {data.id} / {data.branch}
              </div>
              <p>
                {modal === "discard"
                  ? "工作区将恢复到当前 HEAD。"
                  : `工作区与 HEAD 将恢复到 ${shortVersion(restoreId)}。`}
                {data.dirty ? "未保存的修改将被覆盖。" : ""}
              </p>
              <div className="dialog-actions">
                <button className="button" onClick={() => setModal(null)}>
                  取消
                </button>
                <button
                  className="button danger-button"
                  disabled={action.busy}
                  onClick={() =>
                    perform(
                      () =>
                        modal === "discard"
                          ? discardSkill(data.id, data.branch)
                          : restoreSkill(
                              data.id,
                              restoreId,
                              data.dirty,
                              data.branch,
                            ),
                      () => {
                        setModal(null);
                        notify(
                          modal === "discard"
                            ? "已丢弃修改"
                            : `Restored ${shortVersion(restoreId)}`,
                        );
                      },
                    )
                  }
                >
                  {action.busy
                    ? "处理中…"
                    : modal === "discard"
                      ? "丢弃修改"
                      : "Restore"}
                </button>
              </div>
            </>
          ) : null}
          {modal === "links" ? (
            <LinkManager
              data={data}
              busy={action.busy}
              onLink={(opts) =>
                perform(
                  () => linkSkill(data.id, { ...opts, branch: data.branch }),
                  () => notify("Link saved"),
                )
              }
              onUnlink={(to) =>
                perform(
                  () => unlinkSkill(data.id, to, data.branch),
                  () => notify("Unlinked"),
                )
              }
            />
          ) : null}
          {modal === "info" ? (
            <>
              <div className="dialog-meta">
                CLI default · {data.activeBranch}
              </div>
              <div className="dialog-path">{data.manifestPath}</div>
              <p className="mono">tree {data.headTreeHash}</p>
              {data.bundles.length ? (
                <div className="bundle-links">
                  {data.bundles.map((name) => (
                    <Link
                      key={name}
                      to={`/bundles/${encodeURIComponent(name)}`}
                    >
                      {name} ↗
                    </Link>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          {modal === "upstream" ? (
            <>
              <div className="dialog-meta">{data.source.label}</div>
              <div className="row wrap">
                <button
                  className="button"
                  disabled={action.busy}
                  onClick={() =>
                    perform(
                      () => checkSkill(data.id, data.branch),
                      (result) => {
                        setCheck(result.check);
                        setPreview(null);
                        setConfirmApply(false);
                      },
                    )
                  }
                >
                  Check
                </button>
                <button
                  className="button"
                  disabled={action.busy}
                  onClick={() =>
                    perform(
                      () => previewUpdate(data.id, data.branch),
                      (result) => {
                        setCheck(result.check);
                        setPreview(result);
                        setConfirmApply(false);
                      },
                    )
                  }
                >
                  {action.busy ? "Loading…" : "Preview"}
                </button>
                {check ? (
                  <span className="pill pin">{check.status}</span>
                ) : null}
              </div>
              {check ? <p className="check-message">{check.message}</p> : null}
              {preview?.diff ? (
                <>
                  <div className="preview-labels">
                    <span>{preview.diff.leftLabel}</span>
                    <Icon name="arrow" />
                    <span>{preview.diff.rightLabel}</span>
                  </div>
                  <DiffPane diff={preview.diff} compact />
                  <div className="dialog-actions">
                    {confirmApply ? (
                      <>
                        <p>
                          以 {check?.resolvedCommit?.slice(0, 8)} 替换{" "}
                          {data.branch}
                          {check?.status === "local-diverged"
                            ? " 的本地保存内容"
                            : ""}
                          。
                        </p>
                        <button
                          className="button"
                          onClick={() => setConfirmApply(false)}
                        >
                          取消
                        </button>
                        <button
                          className="button danger-button"
                          disabled={action.busy || data.dirty}
                          onClick={() => {
                            if (
                              !preview.check.resolvedCommit ||
                              !preview.check.localHead
                            )
                              return;
                            perform(
                              () =>
                                applyUpdate(data.id, {
                                  branch: data.branch,
                                  force:
                                    preview.check.status === "local-diverged",
                                  expectedCommit: preview.check.resolvedCommit!,
                                  expectedHead: preview.check.localHead!,
                                }),
                              (result) => {
                                setPreview(null);
                                setCheck(result.check);
                                setModal(null);
                                notify(
                                  `Updated ${shortVersion(result.version.id)}`,
                                );
                              },
                            );
                          }}
                        >
                          Apply
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="small muted">
                          {data.dirty
                            ? "请先保存或丢弃修改。"
                            : preview.check.resolvedCommit?.slice(0, 12)}
                        </span>
                        <button
                          className="button primary"
                          disabled={action.busy || data.dirty}
                          onClick={() => setConfirmApply(true)}
                        >
                          应用更新
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
}
function linkLabel(path: string) {
  if (path.includes("/.pi/")) return "pi";
  if (path.includes("/.claude/")) return "Claude";
  if (path.includes("/.agents/")) return "agents";
  return path.split("/").at(-2) || "custom";
}
function LinkManager({
  data,
  busy,
  onLink,
  onUnlink,
}: {
  data: SkillDetail;
  busy: boolean;
  onLink: (opts: LinkOptions) => void;
  onUnlink: (to: string) => void;
}) {
  const [agent, setAgent] = useState("agents");
  const [to, setTo] = useState("");
  const [pin, setPin] = useState(false);
  const [ref, setRef] = useState(data.branch);
  return (
    <>
      <div className="link-list">
        {data.links.map((link) => (
          <div className="link-record" key={link.to}>
            <div className="row between">
              <span>{linkLabel(link.to)}</span>
              <ModeBadge mode={link.mode} refName={link.ref} />
            </div>
            <div className="dialog-path">{link.to}</div>
            <div className="row between">
              {link.mode === "pin" ? (
                <button
                  className="text-button"
                  disabled={busy}
                  title={`固定到 ${data.branch} HEAD`}
                  onClick={() =>
                    onLink({
                      to: link.to,
                      pin: true,
                      ref: data.branch,
                      repin: true,
                    })
                  }
                >
                  Pin HEAD · {data.branch}
                </button>
              ) : (
                <span />
              )}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => onUnlink(link.to)}
              >
                Unlink
              </button>
            </div>
          </div>
        ))}
      </div>
      <form
        className="link-form"
        onSubmit={(e) => {
          e.preventDefault();
          onLink({
            ...(agent === "custom" ? { to: to.trim() } : { agent }),
            pin,
            ref,
          });
        }}
      >
        <h3>添加挂载</h3>
        <div className="form-grid">
          <label>
            Agent
            <select
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
              disabled={busy}
            >
              <option value="agents">agents</option>
              <option value="pi">pi</option>
              <option value="claude">Claude</option>
              <option value="custom">自定义路径</option>
            </select>
          </label>
          <label>
            Mode
            <select
              value={pin ? "pin" : "live"}
              disabled={busy}
              onChange={(e) => {
                setPin(e.target.value === "pin");
                setRef(data.branch);
              }}
            >
              <option value="live">live</option>
              <option value="pin">pin</option>
            </select>
          </label>
        </div>
        {agent === "custom" ? (
          <label className="form-field">
            Path
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={busy}
              required
              placeholder="/path/to/skills/skill"
            />
          </label>
        ) : null}
        <label className="form-field">
          Ref
          <select
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            disabled={busy}
          >
            {data.branches.map((b) => (
              <option key={b.name}>{b.name}</option>
            ))}
            {pin
              ? data.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {shortVersion(v.id)} · {v.note || v.source}
                  </option>
                ))
              : null}
          </select>
        </label>
        <div className="dialog-actions">
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Link"}
          </button>
        </div>
      </form>
    </>
  );
}
