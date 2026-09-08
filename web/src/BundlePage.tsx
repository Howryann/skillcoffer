import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  addBundleMember,
  createBundle,
  deleteBundle,
  fetchBundle,
  fetchSkill,
  removeBundleMember,
  setBundleMemberMode,
  type BundleDetail,
  type Overview,
} from "./api";
import {
  CopyBtn,
  Dialog,
  ErrorMessage,
  shortVersion,
  skillMark,
  useNotify,
} from "./Controls";
import { CollectionArt, Icon } from "./Icons";
import { useAction, usePolling } from "./usePolling";

export function BundlesPage({
  overview,
  onChanged,
}: {
  overview: Overview | null;
  onChanged?: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const action = useAction("create-bundle");
  const navigate = useNavigate();
  useEffect(() => {
    document.title = "Bundles · skillcoffer";
  }, []);
  return (
    <div className="bundle-page">
      <div className="page-head">
        <div>
          <h1>
            Bundles
            <span className="title-count">
              {overview?.bundles.length ?? "—"}
            </span>
          </h1>
          <p className="subtitle">为一次会话，挑一组工具。</p>
        </div>
        <div className="page-actions">
          <CollectionArt className="bundle-head-art" />
          <button
            className="button primary"
            onClick={() => {
              action.setError(null);
              setCreating(true);
            }}
          >
            <Icon name="plus" />
            新建 Bundle
          </button>
        </div>
      </div>
      {!overview ? (
        <p className="empty">加载中…</p>
      ) : overview.bundles.length ? (
        <div className="bundle-index">
          {overview.bundles.map((bundle) => (
            <Link
              className="bundle-index-row"
              key={bundle.name}
              to={`/bundles/${encodeURIComponent(bundle.name)}`}
            >
              <span className="skill-symbol" aria-hidden="true">
                <Icon name="terminal" />
              </span>
              <span className="skill-info">
                <strong>{bundle.name}</strong>
                <span className="member-description">
                  {bundle.memberCount} skills
                </span>
              </span>
              {bundle.dirtyLiveCount ? (
                <span className="pill dirty">
                  {bundle.dirtyLiveCount} modified live
                </span>
              ) : null}
              <Icon name="arrow" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty">
          还没有 Bundle。
          <button className="text-button" onClick={() => setCreating(true)}>
            创建第一个
          </button>
        </div>
      )}
      {creating ? (
        <Dialog title="新建 Bundle" onClose={() => setCreating(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void action.run(
                () => createBundle(name.trim()),
                (bundle) => {
                  onChanged?.();
                  setCreating(false);
                  navigate(`/bundles/${encodeURIComponent(bundle.name)}`);
                },
              );
            }}
          >
            <label htmlFor="bundle-name">Name</label>
            <input
              type="text"
              id="bundle-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="research"
              required
              disabled={action.busy}
            />
            <ErrorMessage error={action.error} />
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                onClick={() => setCreating(false)}
              >
                取消
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={action.busy || !name.trim()}
              >
                {action.busy ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
export default function BundlePage({
  overview,
  onChanged,
}: {
  overview: Overview | null;
  onChanged?: () => void;
}) {
  const { name = "" } = useParams();
  return (
    <BundleContent
      key={name}
      name={name}
      overview={overview}
      onChanged={onChanged}
    />
  );
}
function BundleContent({
  name,
  overview,
  onChanged,
}: {
  name: string;
  overview: Overview | null;
  onChanged?: () => void;
}) {
  const action = useAction(name);
  const resource = usePolling(name, fetchBundle, { paused: action.busy });
  const [modal, setModal] = useState<"add" | "menu" | "delete" | null>(null);
  const [editing, setEditing] = useState<
    BundleDetail["members"][number] | null
  >(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [addPin, setAddPin] = useState(false);
  const notify = useNotify();
  const navigate = useNavigate();
  const data = resource.data;
  useEffect(() => {
    document.title = `${name} · skillcoffer`;
  }, [name]);
  const update = (next: BundleDetail) => {
    resource.setData(next);
    onChanged?.();
  };
  const open = (next: typeof modal) => {
    action.setError(null);
    setModal(next);
  };
  if (!data)
    return (
      <>
        <ErrorMessage error={resource.error} retry={resource.reload} />
        <p className="empty">{resource.error ? "" : "加载中…"}</p>
      </>
    );
  const live = data.members.filter((member) => member.mode === "live").length;
  const remove = (member: BundleDetail["members"][number]) => {
    void action.run(
      () => removeBundleMember(name, member.skill),
      (next) => {
        update(next);
        notify(`已移出 ${member.skill}`, {
          label: "撤销",
          onClick: () => {
            void addBundleMember(
              name,
              member.skill,
              member.mode === "pin",
              member.ref,
            )
              .then((restored) => {
                update(restored);
                notify("已恢复成员");
              })
              .catch((e: unknown) =>
                notify(e instanceof Error ? e.message : String(e)),
              );
          },
        });
      },
    );
  };
  return (
    <div className="bundle-page">
      <div className="breadcrumb">
        <Link to="/bundles">
          <Icon name="back" /> Bundles
        </Link>
      </div>
      <div className="page-head bundle-detail-head">
        <div>
          <h1>
            {data.name}
            <span className="title-count">{data.members.length}</span>
          </h1>
          <p className="subtitle">
            {live} live · {data.members.length - live} pinned
          </p>
        </div>
        <div className="page-actions">
          <CollectionArt className="bundle-head-art" />
          <button
            className="icon-button"
            aria-label="Bundle 更多操作"
            onClick={() => open("menu")}
          >
            <Icon name="more" />
          </button>
        </div>
      </div>
      <ErrorMessage
        error={resource.error || (!modal && !editing ? action.error : null)}
        retry={resource.reload}
      />
      <div className="bundle-strip">
        <p>Members</p>
        <button
          className="button"
          disabled={action.busy}
          onClick={() => open("add")}
        >
          <Icon name="plus" />
          添加成员
        </button>
      </div>
      {data.members.length ? (
        data.members.map((member) => (
          <article className="member" key={member.skill}>
            <span className="skill-symbol" aria-hidden="true">
              {skillMark(member.skill)}
            </span>
            <div className="member-info">
              <Link
                className="skill-link"
                to={`/skills/${encodeURIComponent(member.skill)}`}
              >
                {member.skill}
              </Link>
              <p className="member-description" title={member.description}>
                {member.description}
              </p>
            </div>
            <div className="mode-toggle" aria-label={`${member.skill} 模式`}>
              {(["live", "pin"] as const).map((mode) => (
                <button
                  key={mode}
                  aria-pressed={member.mode === mode}
                  className={member.mode === mode ? "active" : ""}
                  disabled={action.busy || member.missing}
                  onClick={() => {
                    if (mode === member.mode) return;
                    void action.run(
                      () =>
                        setBundleMemberMode(
                          name,
                          member.skill,
                          mode === "pin",
                          mode === "pin" ? member.ref : "main",
                        ),
                      update,
                    );
                  }}
                >
                  {mode}
                </button>
              ))}
            </div>
            <button
              className={`member-ref ${member.dirty ? "modified-ref" : ""}`}
              title={`${member.ref}${member.dirty ? " · modified" : ""}`}
              disabled={action.busy || member.missing}
              onClick={() => {
                action.setError(null);
                setEditing(member);
              }}
            >
              @{member.mode === "pin" ? shortVersion(member.ref) : member.ref}
              {member.missing ? " · missing" : member.dirty ? " *" : ""}
            </button>
            <button
              className="icon-button remove"
              aria-label={`移出 ${member.skill}`}
              disabled={action.busy}
              onClick={() => remove(member)}
            >
              <Icon name="close" />
            </button>
          </article>
        ))
      ) : (
        <p className="bundle-empty">还没有成员。</p>
      )}
      <div className="command-bar">
        <span className="prompt">$</span>
        <code>{data.piCommand}</code>
        <CopyBtn text={data.piCommand} />
      </div>
      <div className="bundle-count">
        {data.dirtyLiveCount ? (
          <span className="modified-ref">
            {data.dirtyLiveCount} modified live
            <span className="divider">/</span>
          </span>
        ) : null}
        <CopyBtn
          text={data.piPrintCommand}
          label="Copy --print"
          className="text-button"
        />
      </div>
      {modal ? (
        <Dialog
          title={
            modal === "add"
              ? "添加成员"
              : modal === "delete"
                ? `删除 ${data.name}`
                : data.name
          }
          onClose={() => setModal(null)}
        >
          <ErrorMessage error={action.error} />
          {modal === "menu" ? (
            <>
              <div className="dialog-path">{data.path}</div>
              <CopyBtn text={data.path} label="Path" />
              <div className="menu-divider" />
              <button
                className="menu-item danger-text"
                onClick={() => open("delete")}
              >
                删除 Bundle
              </button>
            </>
          ) : null}
          {modal === "delete" ? (
            <>
              <p>删除此 Bundle，保留 Skill 本体。</p>
              <div className="dialog-actions">
                <button className="button" onClick={() => setModal(null)}>
                  取消
                </button>
                <button
                  className="button danger-button"
                  disabled={action.busy}
                  onClick={() => {
                    void action.run(
                      () => deleteBundle(name),
                      () => {
                        onChanged?.();
                        navigate("/bundles");
                        notify(`Deleted ${name}`);
                      },
                    );
                  }}
                >
                  Delete
                </button>
              </div>
            </>
          ) : null}
          {modal === "add" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!selected.length) return;
                void action.run(
                  async () => {
                    let next: BundleDetail | null = null;
                    const added: string[] = [];
                    const failed: string[] = [];
                    for (const skill of selected) {
                      try {
                        next = await addBundleMember(name, skill, addPin);
                        added.push(skill);
                      } catch (cause) {
                        failed.push(
                          `${skill}: ${cause instanceof Error ? cause.message : String(cause)}`,
                        );
                      }
                    }
                    return { next, added, failed };
                  },
                  (result) => {
                    if (result.next) update(result.next);
                    setSelected((before) =>
                      before.filter((id) => !result.added.includes(id)),
                    );
                    if (result.failed.length)
                      action.setError(result.failed.join("\n"));
                    else {
                      setModal(null);
                      setQuery("");
                    }
                    if (result.added.length)
                      notify(`Added ${result.added.length} skills`);
                  },
                );
              }}
            >
              <label className="sr-only" htmlFor="member-search">
                搜索成员
              </label>
              <input
                id="member-search"
                type="text"
                placeholder="Find a skill…"
                autoFocus
                value={query}
                disabled={action.busy}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="member-picker">
                {data.availableSkills
                  .filter((id) =>
                    `${id} ${overview?.skills.find((s) => s.id === id)?.description ?? ""}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((id) => (
                    <label className="pick" key={id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(id)}
                        disabled={action.busy}
                        onChange={(e) =>
                          setSelected((before) =>
                            e.target.checked
                              ? [...before, id]
                              : before.filter((value) => value !== id),
                          )
                        }
                      />
                      <span>
                        {id}
                        <small>
                          {
                            overview?.skills.find((s) => s.id === id)
                              ?.description
                          }
                        </small>
                      </span>
                    </label>
                  ))}
                {!data.availableSkills.length ? (
                  <p className="empty">全部 Skill 已加入。</p>
                ) : null}
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={addPin}
                  disabled={action.busy}
                  onChange={(e) => setAddPin(e.target.checked)}
                />
                Pin to HEAD
              </label>
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
                  disabled={action.busy || !selected.length}
                >
                  {action.busy
                    ? "Adding…"
                    : `Add${selected.length ? ` ${selected.length}` : ""}`}
                </button>
              </div>
            </form>
          ) : null}
        </Dialog>
      ) : null}
      {editing ? (
        <MemberRef
          key={editing.skill}
          member={editing}
          busy={action.busy}
          error={action.error}
          onClose={() => setEditing(null)}
          onSave={(pin, ref) => {
            void action.run(
              () => setBundleMemberMode(name, editing.skill, pin, ref),
              (next) => {
                update(next);
                setEditing(null);
                notify("Member updated");
              },
            );
          }}
        />
      ) : null}
    </div>
  );
}
function MemberRef({
  member,
  busy,
  error,
  onClose,
  onSave,
}: {
  member: BundleDetail["members"][number];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (pin: boolean, ref: string) => void;
}) {
  const resource = usePolling(member.skill, fetchSkill, { intervalMs: 0 });
  const [pin, setPin] = useState(member.mode === "pin");
  const [ref, setRef] = useState(member.ref);
  return (
    <Dialog title={member.skill} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(pin, ref);
        }}
      >
        <ErrorMessage error={error || resource.error} retry={resource.reload} />
        <label className="form-field">
          Mode
          <select
            value={pin ? "pin" : "live"}
            disabled={busy}
            onChange={(e) => {
              setPin(e.target.value === "pin");
              setRef("main");
            }}
          >
            <option value="live">live</option>
            <option value="pin">pin</option>
          </select>
        </label>
        <label className="form-field">
          Ref
          <select
            disabled={busy || !resource.data}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          >
            {resource.data?.branches.map((b) => (
              <option key={b.name}>{b.name}</option>
            ))}
            {pin
              ? resource.data?.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {shortVersion(v.id)} · {v.note || v.source}
                  </option>
                ))
              : null}
          </select>
        </label>
        <div className="dialog-actions">
          <button className="button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={busy || !resource.data}
          >
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
