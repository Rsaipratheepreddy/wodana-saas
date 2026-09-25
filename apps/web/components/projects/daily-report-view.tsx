"use client";
import {
  Camera,
  ClipboardCheck,
  CloudSun,
  MessageSquare,
  Pencil,
  ShieldCheck,
  TriangleAlert,
  Users,
  ArrowUpRight,
} from "lucide-react";
import {
  label,
  type DailyReport,
  type ProjectState,
} from "@/lib/projects/execution";
import { initials, shortDate } from "./project-overview";
import theme from "../crm/crm-workspace-colors.module.css";
import s from "./project-workspace.module.css";
import d from "./project-daily.module.css";
import v from "./project-visual.module.css";
export function DailyReportView({
  report: r,
  state,
  busy,
  error,
  onEdit,
  onCorrection,
  onComments,
  onPublish,
  onReturn,
  run,
}: {
  report: DailyReport;
  state: ProjectState;
  busy: boolean;
  error: string;
  onEdit: () => void;
  onCorrection: () => void;
  onComments: () => void;
  onPublish: () => void;
  onReturn: () => void;
  run: (action: string, input?: Record<string, unknown>) => Promise<boolean>;
}) {
  const files = (state.data.files ?? []).filter((f) => f.recordId === r.id),
    images = files.filter((f) => f.mimeType.startsWith("image/")),
    superseded = state.data.reports.some(
      (n) => n.supersedes === r.id && n.status === "approved",
    ),
    editable =
      r.authorId === state.memberId && ["draft", "returned"].includes(r.status),
    reviewer = state.canReview && r.authorId !== state.memberId;
  const url = (id: string) =>
    `/api/project-files/${state.id}/${id}?workspaceId=${state.workspaceId}`;
  const hours = r.workforce?.length
    ? r.workforce.reduce((n, w) => n + w.people * w.hours, 0)
    : r.people * r.hours;
  const riskOwner = state.members.find(member => member.id === r.nextUpdateOwnerId)?.name;
  const history = state.data.audit
    .filter((a) => a.recordId === r.id)
    .slice(-5)
    .reverse();
  return (
    <article
      className={`${theme.theme} ${d.reportDocument}`}
      aria-label="Daily report document"
    >
      <header className={d.documentHeader}>
        <div>
          <span className={v.eyebrow}>DAILY REPORT · {label(r.location)}</span>
          <h2>{label(r.location)} daily progress</h2>
          <p>
            {shortDate(r.date)} · {r.shift}
          </p>
        </div>
        <span className={s.status} data-state={r.status}>
          {superseded ? "Superseded" : label(r.status)}
        </span>
      </header>
      <div className={d.documentAuthor}>
        <span className={v.avatar}>{initials(r.author)}</span>
        <div>
          <strong>{r.author}</strong>
          <small>Reported from {r.location}</small>
        </div>
        <span>
          {r.publishedAt
            ? `${r.clientFileIds?.length ?? 0} selected files shared with client`
            : "Internal report"}
        </span>
      </div>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {r.note && (
        <aside className={d.reviewNote}>
          <ClipboardCheck size={17} />
          <div>
            <strong>
              {r.status === "returned" ? "Changes requested" : "Review note"}
            </strong>
            <p>{r.note}</p>
          </div>
        </aside>
      )}
      <div className={d.documentMetrics}>
        <span>
          <Users size={18} />
          <strong>{r.people}</strong>People on shift
        </span>
        <span>
          <ClipboardCheck size={18} />
          <strong>{hours}</strong>Labour hours
        </span>
        <span>
          <Camera size={18} />
          <strong>{images.length}</strong>Site photos
        </span>
        <span>
          <CloudSun size={18} />
          <strong>{r.weather || "Not recorded"}</strong>Weather
        </span>
      </div>
      <section className={d.reportNarrative}>
        <h3>Shift summary</h3>
        <p>{r.summary || "No shift summary recorded."}</p>
      </section>
      {Boolean(r.workforce?.length) && <section>
        <h3>Crew & labour <small>{r.workforce!.length} trades · {hours} labour hours</small></h3>
        <div className={s.scroll}><table data-record-table="" className={s.table}><thead><tr><th>Trade / role</th><th>People</th><th>Hours each</th><th>Labour hours</th></tr></thead><tbody>{r.workforce!.map((crew, index) => <tr key={`${crew.trade}-${index}`}><td>{crew.trade}</td><td>{crew.people}</td><td>{crew.hours}</td><td>{crew.people * crew.hours}</td></tr>)}</tbody></table></div>
      </section>}
      {r.scheduleImpact && r.scheduleImpact !== "none" && <section className={d.impactSummary} data-impact={r.scheduleImpact}>
        <h3><TriangleAlert size={17}/> Programme {r.scheduleImpact === "blocked" ? "blocked" : "at risk"}</h3>
        <dl><div><dt>Cause</dt><dd>{r.impactReason || "Not recorded"}</dd></div><div><dt>Recovery action</dt><dd>{r.recoveryPlan || "Not recorded"}</dd></div><div><dt>Next update</dt><dd>{riskOwner || "Owner not recorded"}{r.nextUpdateDate ? ` · ${shortDate(r.nextUpdateDate)}` : ""}</dd></div></dl>
      </section>}
      {images.length > 0 && (
        <section>
          <h3>
            Photo record <small>{images.length} photos</small>
          </h3>
          <div className={d.reportGallery}>
            {images.map((f) => (
              <a href={url(f.id)} key={f.id} target="_blank" rel="noreferrer">
                <img src={url(f.id)} alt={f.name} />
                <span>
                  {f.name}
                  {r.clientFileIds?.includes(f.id) && (
                    <small>Client shared</small>
                  )}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3>
          Work completed{" "}
          <small>
            {r.entries.length}{" "}
            {r.entries.length === 1 ? "activity" : "activities"}
          </small>
        </h3>
        {r.entries.length ? (
          <div className={s.scroll}>
            <table data-record-table="" className={s.table}>
              <thead>
                <tr>
                  <th>Activity / area</th>
                  <th>Reported quantity</th>
                  <th>Approved to date / plan</th>
                  <th>Assigned team</th>
                </tr>
              </thead>
              <tbody>
                {r.entries.map((e) => {
                  const t = state.data.tasks.find((t) => t.id === e.taskId);
                  return (
                    <tr key={e.taskId}>
                      <td>
                        <a
                          className={s.link}
                          href={`/workspace/projects/${state.id}/${t?.location === "factory" ? "production" : "site-work"}?record=${e.taskId}`}
                        >
                          {t?.title ?? "Activity"} <ArrowUpRight size={12} />
                        </a>
                        <small>{t?.area || "Area not specified"}</small>
                      </td>
                      <td>
                        <strong>
                          {e.quantity} {t?.unit}
                        </strong>
                      </td>
                      <td>{t ? `${t.approved} / ${t.quantity} ${t.unit}` : "—"}</td>
                      <td>
                        {state.resources.find((x) => x.id === t?.resourceId)
                          ?.name || "No team assigned"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={d.documentEmpty}>
            No work quantities reported for this shift.
          </p>
        )}
        <p className={d.documentCaption}>
          {r.status === "approved" && !superseded
            ? "Reviewed quantities are included in project progress."
            : superseded
              ? "A newer reviewed report replaces these quantities."
              : "These quantities update project progress after review."}
        </p>
      </section>
      <div className={d.documentColumns}>
        {[
          ["Issues & blockers", r.issues, TriangleAlert],
          [r.safetyStatus === "incident" ? "Safety incident" : r.safetyStatus === "observation" ? "Safety observation" : "Safety & inspections", r.safety, ShieldCheck],
          ["Materials & deliveries", r.materials, ClipboardCheck],
          ["Next shift", r.tomorrow, ArrowUpRight],
        ].map(([title, body, Icon]) => {
          const I = Icon as typeof Camera;
          return (
            <section
              key={String(title)}
              data-attention={title === "Issues & blockers" && Boolean(body)}
            >
              <h3>
                <I size={16} />
                {String(title)}
              </h3>
              <p>{String(body || "Not recorded for this shift.")}</p>
            </section>
          );
        })}
      </div>
      {(r.evidence || files.some((f) => !f.mimeType.startsWith("image/"))) && (
        <section>
          <h3>Supporting records</h3>
          {r.evidence && <p>{r.evidence}</p>}
          {files
            .filter((f) => !f.mimeType.startsWith("image/"))
            .map((f) => (
              <a
                className={s.link}
                key={f.id}
                href={url(f.id)}
                target="_blank"
                rel="noreferrer"
              >
                {f.name} <ArrowUpRight size={13} />
              </a>
            ))}
        </section>
      )}
      {history.length > 0 && (
        <section>
          <h3>Report history</h3>
          <ol className={d.reportHistory}>
            {history.map((a) => (
              <li key={a.id}>
                <strong>{a.action}</strong>
                <span>
                  {a.author} · {new Date(a.at).toLocaleString()}
                </span>
                {a.note && <p>{a.note}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
      <footer className={d.documentActions}>
        <button className={s.button} onClick={onComments}>
          <MessageSquare size={15} />
          Comments{" "}
          {state.data.comments.filter((c) => c.recordId === r.id).length || ""}
        </button>
        <span />
        {editable && (
          <button className={s.primary} onClick={onEdit}>
            <Pencil size={15} />
            Edit {r.status === "returned" ? "returned report" : "draft"}
          </button>
        )}
        {r.status === "submitted" && reviewer && (
          <>
            <button className={s.button} disabled={busy} onClick={onReturn}>
              Request changes
            </button>
            <button
              className={s.primary}
              disabled={busy}
              onClick={() => void run("approve_report", { id: r.id })}
            >
              <ClipboardCheck size={15} />
              Approve report
            </button>
          </>
        )}
        {r.status === "approved" && !superseded && (
          <>
            {r.authorId === state.memberId && (
              <button className={s.button} onClick={onCorrection}>
                Create correction
              </button>
            )}
            {state.canReview && (
              <button
                className={s.primary}
                disabled={busy}
                onClick={() =>
                  r.publishedAt
                    ? void run("unpublish_report", { id: r.id })
                    : onPublish()
                }
              >
                {r.publishedAt ? "Stop sharing" : "Share with client"}
              </button>
            )}
          </>
        )}
      </footer>
    </article>
  );
}
