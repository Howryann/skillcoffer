import { useEffect } from "react";
import { Link } from "react-router-dom";
import { fetchDoctor, fixDoctorIssue } from "./api";
import { ErrorMessage, useNotify } from "./Controls";
import { Icon } from "./Icons";
import { useAction, usePolling } from "./usePolling";

export default function DoctorPage() {
  const action = useAction("doctor");
  const resource = usePolling("doctor", fetchDoctor, {
    intervalMs: 0,
    paused: action.busy,
  });
  const notify = useNotify();
  useEffect(() => {
    document.title = "Doctor · skillcoffer";
  }, []);
  return (
    <div className="bundle-page">
      <div className="page-head">
        <div>
          <h1>Doctor</h1>
          <p className="subtitle">
            {resource.data
              ? `${resource.data.skillCount} skills · ${resource.data.bundleCount} bundles`
              : "检查 Store"}
          </p>
        </div>
        <button
          className="button"
          disabled={action.busy}
          onClick={resource.reload}
        >
          <Icon name="refresh" />
          重新检查
        </button>
      </div>
      <ErrorMessage
        error={action.error || resource.error}
        retry={resource.reload}
      />
      {!resource.data ? (
        <p className="empty">{resource.error ? "" : "检查中…"}</p>
      ) : (
        <>
          <p className="mono muted doctor-home">{resource.data.home}</p>
          {!resource.data.issues.length ? (
            <div className="doctor-clean">
              <Icon name="check" />
              No issues found.
            </div>
          ) : (
            resource.data.issues.map((issue, i) => (
              <article
                className="doctor-issue"
                key={`${issue.code}:${issue.path}:${i}`}
              >
                <div className="row">
                  <span
                    className={`pill ${issue.severity === "warn" ? "dirty" : "issue-error"}`}
                  >
                    {issue.severity}
                  </span>
                  <span className="mono muted">{issue.code}</span>
                </div>
                <p>{issue.message}</p>
                <div className="row wrap">
                  {issue.skill ? (
                    <Link
                      className="text-button"
                      to={`/skills/${encodeURIComponent(issue.skill)}`}
                    >
                      {issue.skill} ↗
                    </Link>
                  ) : null}
                  {issue.bundle ? (
                    <Link
                      className="text-button"
                      to={`/bundles/${encodeURIComponent(issue.bundle)}`}
                    >
                      {issue.bundle} ↗
                    </Link>
                  ) : null}
                  {issue.fixable === "unlink" && issue.skill && issue.path ? (
                    <button
                      className="button"
                      disabled={action.busy}
                      onClick={() => {
                        void action.run(
                          () =>
                            fixDoctorIssue({
                              fix: "unlink",
                              skill: issue.skill!,
                              path: issue.path!,
                            }),
                          (next) => {
                            resource.setData(next);
                            notify("Unlinked");
                          },
                        );
                      }}
                    >
                      Unlink
                    </button>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </>
      )}
    </div>
  );
}
