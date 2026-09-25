"use client";
import { useRef, useState } from "react";
import {
  Camera,
  ClipboardCheck,
  Plus,
  Users,
  CloudSun,
  TriangleAlert,
  MessageSquare,
  ArrowUpRight,
  Upload,
  FileText,
  Trash2,
  CircleCheck,
} from "lucide-react";
import {
  label,
  type DailyReport,
  type ProjectState,
  type ProjectData,
} from "@/lib/projects/execution";
import { initials, shortDate } from "./project-overview";
import theme from "../crm/crm-workspace-colors.module.css";
import s from "./project-workspace.module.css";
import v from "./project-visual.module.css";
import d from "./project-daily.module.css";
type Run = (
  action: string,
  input?: Record<string, unknown>,
) => Promise<boolean>;
const fileUrl = (state: ProjectState, id: string) =>
  `/api/project-files/${state.id}/${id}?workspaceId=${state.workspaceId}`;
export function DailyProgress({
  state,
  today,
  view,
  search,
  busy,
  run,
  onOpen,
  onComments,
  onPublish,
  onReturn,
}: {
  state: ProjectState;
  today: string;
  view: string;
  search: string;
  busy: boolean;
  run: Run;
  onOpen: (r: DailyReport) => void;
  onComments: (id: string) => void;
  onPublish: (r: DailyReport) => void;
  onReturn: (r: DailyReport) => void;
}) {
  const [location, setLocation] = useState("all"),
    [date, setDate] = useState("");
  const data = state.data;
  const reports = [...data.reports]
    .filter(
      (r) =>
        (view === "all" ||
          (view === "issues" && r.issues) ||
          r.status === view) &&
        (location === "all" || r.location === location) &&
        (!date || r.date === date) &&
        `${r.date} ${r.author} ${r.summary ?? ""} ${r.issues} ${r.entries.map((e) => data.tasks.find((t) => t.id === e.taskId)?.title).join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const latestDate = [...data.reports].sort((a, b) =>
      b.date.localeCompare(a.date),
    )[0]?.date,
    dayReports = data.reports.filter(
      (r) =>
        r.date === (date || latestDate) &&
        !data.reports.some(
          (n) => n.status === "approved" && n.supersedes === r.id,
        ),
    ),
    photos = (data.files ?? []).filter(
      (f) =>
        dayReports.some((r) => r.id === f.recordId) &&
        f.mimeType.startsWith("image/"),
    );
  return (
    <div className={d.diary}>
      <div className={d.diarySummary}>
        <div className={d.diaryStats}>
          <span>
            <Camera size={16} />
            <strong>{photos.length}</strong>photos
          </span>
          <span>
            <Users size={16} />
            <strong>{dayReports.reduce((n, r) => n + r.people, 0)}</strong>
            people reported
          </span>
          <span>
            <ClipboardCheck size={16} />
            <strong>
              {data.reports.filter((r) => r.status === "submitted").length}
            </strong>
            to review
          </span>
          <small>
            {date || latestDate
              ? shortDate(date || latestDate!)
              : shortDate(today)}{" "}
            · shift entries
          </small>
        </div>
      </div>
      <div className={d.filters}>
        <div className={d.locationTabs}>
          {[
            ["all", "All locations"],
            ["site", "Site"],
            ["factory", "Factory"],
          ].map(([id, title]) => (
            <button
              key={id}
              aria-pressed={location === id}
              onClick={() => setLocation(id)}
            >
              {title}
            </button>
          ))}
        </div>
        <label>
          Report date{" "}
          <input
            type="date"
            aria-label="Filter report date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {date && (
          <button className={s.link} onClick={() => setDate("")}>
            Clear date
          </button>
        )}
      </div>
      {view === "issues" &&
        data.tasks
          .filter((t) => t.status === "blocked")
          .map((t) => (
            <div className={d.issueRow} key={t.id}>
              <TriangleAlert size={17} />
              <div>
                <strong>{t.title}</strong>
                <p>{t.blocker || "Work is blocked"}</p>
                <small>
                  {state.members.find((m) => m.id === t.ownerId)?.name ??
                    "Owner needed"}{" "}
                  · {t.area}
                </small>
              </div>
              <button className={s.button} onClick={() => onComments(t.id)}>
                Follow up <MessageSquare size={14} />
              </button>
            </div>
          ))}
      <div className={d.diaryFeed}>
        {reports.map((r) => {
          const files = (data.files ?? []).filter((f) => f.recordId === r.id),
            images = files.filter((f) => f.mimeType.startsWith("image/")),
            superseded = data.reports.some(
              (n) => n.status === "approved" && n.supersedes === r.id,
            );
          return (
            <article className={d.reportCard} key={r.id}>
              <header>
                <span className={v.avatar}>{initials(r.author)}</span>
                <div>
                  <strong>{r.author}</strong>
                  <small>
                    {shortDate(r.date)} · {label(r.location)} · {r.shift}
                  </small>
                </div>
                <span className={s.status} data-state={r.status}>
                  {superseded ? "Superseded" : label(r.status)}
                </span>
                {r.publishedAt && (
                  <span className={d.shared}>
                    <CircleCheck size={12} /> Client shared
                  </span>
                )}
              </header>
              <div className={d.reportBody} data-photos={images.length > 0}>
                <div className={d.reportCopy}>
                  <button
                    className={d.reportTitle}
                    onClick={() => onOpen(structuredClone(r))}
                  >
                    {r.summary
                      ? `${r.summary.slice(0, 120)}${r.summary.length > 120 ? "…" : ""}`
                      : `${label(r.location)} progress · ${shortDate(r.date)}`}
                    <ArrowUpRight size={16} />
                  </button>
                  <div className={d.workLines}>
                    {r.entries.map((e) => {
                      const t = data.tasks.find((t) => t.id === e.taskId);
                      return (
                        <div key={e.taskId}>
                          <span>
                            {t?.title ?? "Task"}
                            <small>{t?.area}</small>
                          </span>
                          <strong>
                            {e.quantity}
                            <small>{t?.unit}</small>
                          </strong>
                        </div>
                      );
                    })}
                  </div>
                  {r.issues && (
                    <div className={d.reportIssue}>
                      <TriangleAlert size={14} />
                      <span>{r.issues}</span>
                    </div>
                  )}
                  <div className={d.reportMeta}>
                    <span>
                      <Users size={13} />
                      {r.people} people ·{" "}
                      {r.workforce?.length
                        ? r.workforce.reduce(
                            (n, x) => n + x.people * x.hours,
                            0,
                          )
                        : r.people * r.hours}{" "}
                      labour h
                    </span>
                    {r.weather && (
                      <span>
                        <CloudSun size={13} />
                        {r.weather}
                      </span>
                    )}
                    <span>
                      <Camera size={13} />
                      {images.length} photos
                    </span>
                  </div>
                </div>
                <div className={d.photoStrip}>
                  {images.length ? (
                    images.slice(0, 3).map((f, i) => (
                      <a
                        href={fileUrl(state, f.id)}
                        key={f.id}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${f.name}`}
                      >
                        <img
                          src={fileUrl(state, f.id)}
                          alt={f.name}
                          loading="lazy"
                        />
                        {i === 2 && images.length > 3 && (
                          <span>+{images.length - 3}</span>
                        )}
                      </a>
                    ))
                  ) : (
                    <button
                      className={d.noPhoto}
                      onClick={() => onOpen(structuredClone(r))}
                    >
                      <Camera size={25} />
                      <span>
                        {["draft", "returned"].includes(r.status)
                          ? "Add site photos"
                          : "No photos attached"}
                      </span>
                    </button>
                  )}
                </div>
              </div>
              <footer>
                <button
                  className={s.button}
                  onClick={() => onOpen(structuredClone(r))}
                >
                  Open report <ArrowUpRight size={13} />
                </button>
                <button
                  className={s.icon}
                  aria-label={`Comments on report ${r.date}`}
                  onClick={() => onComments(r.id)}
                >
                  <MessageSquare size={15} />
                  {data.comments.filter((c) => c.recordId === r.id).length ||
                    ""}
                </button>
                <span className={d.footerSpacer} />
                {r.status === "submitted" &&
                  state.canReview &&
                  r.authorId !== state.memberId && (
                    <>
                      <button
                        className={s.button}
                        disabled={busy}
                        onClick={() => onReturn(r)}
                      >
                        Return
                      </button>
                      <button
                        className={s.primary}
                        disabled={busy}
                        onClick={() => void run("approve_report", { id: r.id })}
                      >
                        Approve update <ClipboardCheck size={14} />
                      </button>
                    </>
                  )}
                {r.status === "approved" &&
                  state.canReview &&
                  !superseded &&
                  (r.publishedAt ? (
                    <button
                      className={s.button}
                      disabled={busy}
                      onClick={() => void run("unpublish_report", { id: r.id })}
                    >
                      Stop sharing
                    </button>
                  ) : (
                    <button
                      className={s.button}
                      disabled={busy}
                      onClick={() => onPublish(r)}
                    >
                      Share with client
                    </button>
                  ))}
              </footer>
            </article>
          );
        })}
      </div>
      {!reports.length && (
        <div className={s.empty}>
          <Camera size={30} />
          <h2>
            {data.reports.length
              ? "No matching updates"
              : "Bring the site into the workspace"}
          </h2>
          <p>
            {data.reports.length
              ? "Choose a different date, location or status."
              : "Capture photos, record work and flag what is holding the team back."}
          </p>
        </div>
      )}
    </div>
  );
}
export function DailyReportEditor({
  report,
  setReport,
  state,
  today,
  busy,
  error,
  run,
  onClose,
  onCorrection,
  onUploaded,
}: {
  report: DailyReport;
  setReport: (r: DailyReport) => void;
  state: ProjectState;
  today: string;
  busy: boolean;
  error: string;
  run: Run;
  onClose: () => void;
  onCorrection: () => void;
  onUploaded: (d: ProjectData) => void;
}) {
  const [tab, setTab] = useState("work"),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState("");
  const uploadIds = useRef(new Map<string, string>());
  const editable =
      report.authorId === state.memberId &&
      ["draft", "returned"].includes(report.status),
    patch = (p: Partial<DailyReport>) => setReport({ ...report, ...p }),
    files = (state.data.files ?? []).filter((f) => f.recordId === report.id);
  const crewPeople = report.workforce?.reduce((total, line) => total + line.people, 0) ?? 0;
  const labourHours = report.workforce?.length
    ? report.workforce.reduce((total, line) => total + line.people * line.hours, 0)
    : report.people * report.hours;
  async function upload(list: File[]) {
    if (!list.length) return;
    if (list.some((f) => f.size > 10 * 1024 * 1024)) {
      setUploadError("Choose photos or PDFs up to 10 MB each.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      if (!(await run("report", { report }))) return;
      for (const file of list) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        const id = uploadIds.current.get(key) ?? crypto.randomUUID();
        uploadIds.current.set(key, id);
        const body = new FormData();
        body.set("file", file);
        const response = await fetch(
          `/api/project-files/${state.id}/${id}?workspaceId=${state.workspaceId}&recordId=${report.id}`,
          { method: "POST", body },
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.message ?? "Upload failed. Select the same file to retry.",
          );
        onUploaded(data.data);
      }
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className={`${theme.theme} ${s.form} ${d.editor}`}>
      <div className={d.editorIntro}>
        <div><span className={v.eyebrow}>DAILY PROGRESS · {label(report.location)}</span><h2>Record the day’s work</h2><p>{report.author} · {shortDate(report.date)} · {report.shift}</p></div>
        <span className={s.status} data-state={report.status}>{label(report.status)}</span>
      </div>
      <div className={d.editorSnapshot} aria-label="Report snapshot"><span><strong>{report.entries.length}</strong> work items</span><span><strong>{report.workforce?.length ? crewPeople : report.people}</strong> people</span><span><strong>{labourHours.toLocaleString()}</strong> labour hours</span><span><strong>{files.length}</strong> files</span></div>
      {(error || uploadError) && (
        <p role="alert" className={s.error}>
          {error || uploadError}
        </p>
      )}
      {report.note && <p className={s.notice}>{report.note}</p>}
      <nav className={d.editorTabs} aria-label="Daily report sections">
        {[
          ["work", "Work & crew", ClipboardCheck],
          ["photos", `Evidence (${files.length})`, Camera],
          ["issues", "Safety & next steps", TriangleAlert],
        ].map(([id, title, Icon]) => {
          const I = Icon as typeof Camera;
          return (
            <button
              type="button"
              key={String(id)}
              aria-pressed={tab === id}
              onClick={() => setTab(String(id))}
            >
              <I size={15} />
              {String(title)}
            </button>
          );
        })}
      </nav>
      <fieldset disabled={!editable || busy || uploading}>
        {tab === "work" && (
          <>
            <div className={d.sectionHeading}><h3>Shift details</h3><p>Record when and where the work happened. Site and factory output use separate reports.</p></div>
            <div className={`${s.grid} ${s.reportContext}`}>
              <label>
                Date
                <input
                  type="date"
                  max={today}
                  value={report.date}
                  onChange={(e) => patch({ date: e.target.value })}
                />
              </label>
              <label>
                Shift
                <input
                  value={report.shift}
                  onChange={(e) => patch({ shift: e.target.value })}
                />
              </label>
              <label>
                Location
                <select
                  value={report.location}
                  onChange={(e) =>
                    patch({ location: e.target.value as "site" | "factory" })
                  }
                >
                  <option value="site">Site</option>
                  <option value="factory">Factory</option>
                </select>
              </label>
              <label>
                People on this shift
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={report.workforce?.length ? crewPeople : report.people}
                  disabled={Boolean(report.workforce?.length)}
                  onChange={(e) => patch({ people: Number(e.target.value) })}
                />
              </label>
              <label>
                Hours worked per person
                <input
                  type="number"
                  min="0"
                  max="24"
                  step=".5"
                  value={report.workforce?.length ? Number((labourHours / crewPeople).toFixed(2)) : report.hours}
                  disabled={Boolean(report.workforce?.length)}
                  onChange={(e) => patch({ hours: Number(e.target.value) })}
                />
              </label>
            </div>
            <label>
              Shift summary
              <textarea
                rows={2}
                value={report.summary ?? ""}
                placeholder="What was completed, what remains, and what changed today?"
                onChange={(e) => patch({ summary: e.target.value })}
              />
            </label>
            <div className={d.sectionHeading}><h3>Crew breakdown</h3><p>Optional trades and hours give reviewers a reliable labour record. Totals above update from these lines.</p></div>
            {(report.workforce ?? []).map((line, index) => <div className={d.crewRow} key={index}>
              <label>Trade / role<input value={line.trade} maxLength={120} placeholder="Joinery, installation, electrician…" onChange={e => patch({workforce: report.workforce!.map((item, i) => i === index ? {...item, trade:e.target.value} : item)})}/></label>
              <label>People<input type="number" min="1" max="1000" step="1" value={line.people} onChange={e => patch({workforce: report.workforce!.map((item, i) => i === index ? {...item, people:Number(e.target.value)} : item)})}/></label>
              <label>Hours each<input type="number" min="0.5" max="24" step="0.5" value={line.hours} onChange={e => patch({workforce: report.workforce!.map((item, i) => i === index ? {...item, hours:Number(e.target.value)} : item)})}/></label>
              <button type="button" className={s.icon} aria-label={`Remove crew line ${index + 1}`} onClick={() => patch({workforce: report.workforce!.filter((_, i) => i !== index)})}><Trash2 size={16}/></button>
            </div>)}
            <button type="button" className={s.button} onClick={() => patch({workforce:[...(report.workforce ?? []),{trade:"",people:1,hours:8}]})} disabled={(report.workforce?.length ?? 0) >= 20}><Plus size={14}/> Add crew line</button>
            <div className={d.sectionHeading}><h3>Measured output</h3><p>Choose assigned tasks and enter today’s completed quantity. Approval updates project progress.</p></div>
            {report.entries.map((entry, i) => {
              const task = state.data.tasks.find((t) => t.id === entry.taskId);
              return (
                <div className={d.outputRow} key={i}>
                  <div className={s.reportGrid}>
                    <label>
                      Task
                      <select
                        value={entry.taskId}
                        onChange={(e) =>
                          patch({
                            entries: report.entries.map((x, n) =>
                              n === i ? { ...x, taskId: e.target.value } : x,
                            ),
                          })
                        }
                      >
                        <option value="">Choose assigned work</option>
                        {state.data.tasks
                          .filter(
                            (t) =>
                              t.location === report.location &&
                              !state.data.tasks.some(
                                (c) => c.parentId === t.id,
                              ) &&
                              (state.canManage ||
                                t.ownerId === state.memberId ||
                                t.assigneeIds.includes(state.memberId)),
                          )
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title} · {t.unit}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Output {task?.unit && `(${task.unit})`}
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={entry.quantity}
                        onChange={(e) =>
                          patch({
                            entries: report.entries.map((x, n) =>
                              n === i
                                ? { ...x, quantity: Number(e.target.value) }
                                : x,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className={d.outputHint}>
                    <small>
                      {task
                        ? `${task.approved} / ${task.quantity} ${task.unit} currently approved`
                        : "Choose the work done during this shift."}
                    </small>
                    <button
                      className={s.icon}
                      aria-label={`Remove output ${i + 1}`}
                      onClick={() =>
                        patch({
                          entries: report.entries.filter((_, n) => n !== i),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
            <button
              className={s.button}
              onClick={() =>
                patch({
                  entries: [...report.entries, { taskId: "", quantity: 0 }],
                })
              }
            >
              <Plus size={14} /> Add task output
            </button>
            <div className={d.sectionHeading}><h3>Next shift</h3><p>Give the incoming team a clear plan and note dependencies.</p></div>
            <label>
              Next shift plan
              <textarea
                placeholder="Next work areas, team needs and planned deliveries…"
                value={report.tomorrow}
                onChange={(e) => patch({ tomorrow: e.target.value })}
              />
            </label>
          </>
        )}
        {tab === "photos" && (
          <>
            <div className={d.sectionHeading}><h3>Evidence & records</h3><p>Attach dated photos, marked-up work, delivery records or a signed diary reference. Evidence is required before submission.</p></div>
            <div className={d.uploadZone}>
              <Upload size={24} />
              <strong>
                {uploading
                  ? "Uploading site evidence…"
                  : "Add photos from the site"}
              </strong>
              <span>Choose several photos or PDFs · up to 10 MB each</span>
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                aria-label="Upload site photos"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void upload(list);
                }}
              />
            </div>
            <label>
              Photo notes / signed site record reference
              <textarea
                value={report.evidence}
                placeholder="Location, work shown, or a signed site diary reference…"
                onChange={(e) => patch({ evidence: e.target.value })}
              />
            </label>
          </>
        )}
        {tab === "issues" && (
          <>
            <div className={d.sectionHeading}><h3>Conditions & safety</h3><p>Separate observations from incidents, and make schedule effects and next ownership explicit.</p></div>
            <label>
              Weather & site conditions
              <input
                placeholder="e.g. Hot, indoor work; access clear"
                value={report.weather ?? ""}
                onChange={(e) => patch({ weather: e.target.value })}
              />
            </label>
            <label>
              Blockers, delays and responsible people
              <textarea
                placeholder="What happened, affected area / task, who needs to act and by when…"
                value={report.issues}
                onChange={(e) => patch({ issues: e.target.value })}
              />
            </label>
            <label>
              Safety status
              <select value={report.safetyStatus ?? "none"} onChange={e => patch({safetyStatus:e.target.value as DailyReport["safetyStatus"]})}><option value="none">No incident</option><option value="observation">Observation</option><option value="incident">Incident</option></select>
            </label>
            <label>
              Safety & inspections
              <textarea
                placeholder="Toolbox talk, inspections, hazards or incidents…"
                value={report.safety ?? ""}
                onChange={(e) => patch({ safety: e.target.value })}
              />
            </label>
            <label>
              Materials received, used, returned or wasted
              <textarea
                value={report.materials}
                onChange={(e) => patch({ materials: e.target.value })}
              />
            </label>
            <div className={d.sectionHeading}><h3>Schedule impact & recovery</h3><p>If today’s work affects the programme, record the cause, recovery action, and person responsible for the next update.</p></div>
            <label>Schedule impact<select value={report.scheduleImpact ?? "none"} onChange={e => patch({scheduleImpact:e.target.value as DailyReport["scheduleImpact"]})}><option value="none">No known impact</option><option value="watch">At risk · watch</option><option value="blocked">Blocked</option></select></label>
            {report.scheduleImpact && report.scheduleImpact !== "none" && <>
              <label>Impact reason<textarea value={report.impactReason ?? ""} onChange={e => patch({impactReason:e.target.value})} placeholder="Affected task, area and cause…"/></label>
              <label>Recovery plan<textarea value={report.recoveryPlan ?? ""} onChange={e => patch({recoveryPlan:e.target.value})} placeholder="Action required to recover the programme…"/></label>
              <div className={d.riskOwnership}><label>Next update owner<select value={report.nextUpdateOwnerId ?? ""} onChange={e => patch({nextUpdateOwnerId:e.target.value})}><option value="">Choose a person</option>{state.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>Next update date<input type="date" min={report.date} value={report.nextUpdateDate ?? ""} onChange={e => patch({nextUpdateDate:e.target.value})}/></label></div>
            </>}
            <p className={s.muted}>
              Issues remain visible in the site diary. Use the linked task to
              assign follow-up or place work on hold.
            </p>
          </>
        )}
      </fieldset>
      {tab === "photos" && (
        <div className={d.evidenceGrid}>
          {files.map((f) => (
            <a
              href={fileUrl(state, f.id)}
              key={f.id}
              target="_blank"
              rel="noreferrer"
            >
              {f.mimeType.startsWith("image/") ? (
                <img src={fileUrl(state, f.id)} alt={f.name} />
              ) : (
                <FileText size={25} />
              )}
              <span>{f.name}</span>
            </a>
          ))}
        </div>
      )}
      <div className={d.editorFooter}>
        <small>
          {editable
            ? "Unsent text is kept on this device. Uploaded files are saved."
            : "Approved reports keep their original evidence."}
        </small>
        <div className={s.actions}>
          {editable && (
            <>
              <button
                className={s.button}
                disabled={busy || uploading}
                onClick={async () => {
                  if (await run("report", { report })) onClose();
                }}
              >
                Save draft
              </button>
              <button
                className={s.primary}
                disabled={busy || uploading}
                onClick={async () => {
                  if (await run("report_submit", { report })) onClose();
                }}
              >
                Submit for review
              </button>
            </>
          )}
          {report.status === "approved" &&
            report.authorId === state.memberId && (
              <button className={s.button} onClick={onCorrection}>
                Create correction
              </button>
            )}
        </div>
      </div>
      <p className={d.privacy}>
        A manager reviews quantities before they change progress. Client sharing
        is a separate review, including which photos to share.
      </p>
    </div>
  );
}
