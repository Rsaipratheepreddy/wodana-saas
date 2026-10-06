"use client";

import { BellRing, CalendarDays, ChevronRight, ExternalLink, Mail, MapPin, MessageCircle, Phone, UserRound, UsersRound, Wallet } from "lucide-react";
import { useState } from "react";
import { Avatar, Button, InlineNotice, Progress, SelectField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, type PortalApi } from "@/lib/client-portal/client";
import { stageName } from "@/lib/client-portal/stage-names";
import type { PortalProject, PortalSite, PortalStep, PortalTeamMember, PortalTeamRole, PortalUpdateFrequency, PortalView } from "@/lib/client-portal/types";
import { formatPhoneForDisplay, whatsappUrl } from "@/lib/phone";
import { daysBetween, isolate, type PortalFormat } from "./portal-format";
import { usePortalLabels } from "./portal-labels";
import styles from "./portal.module.css";
import type { PortalTarget } from "./sections/section-types";

type Go = (section: "overview" | "payments" | "decisions") => void;
type Open = (target: PortalTarget) => void;

/** What a step asks of the client ("Material list to sign off"), and what it is and by when. */
export function useStepText(format: PortalFormat) {
  const t = useT();
  const kinds: Record<PortalStep["kind"], string> = {
    quote: t("Quotation to decide"), design: t("Design to review"), definition: t("Requirements to confirm"), materials: t("Material list to sign off"), drawings: t("Drawings to approve"),
    handover: t("Handover to accept"), request: t("Question to answer"), invoice: t("Invoice to pay"), site_access: t("Confirm site access"),
    change: t("Change to approve"), presentation: t("Concepts to choose from"), choice: t("Choice to make"),
  };
  // A delivery names its day in the title ("Confirm site access for 3 Oct"); the rest say by when.
  const title = (step: PortalStep) => (step.kind === "site_access" && step.due ? t("Confirm site access for {date}", { date: format.date(step.due) }) : kinds[step.kind]);
  const due = (step: PortalStep) => (step.due && step.kind !== "site_access" ? t("by {date}", { date: format.date(step.due) }) : "");
  return { title, due };
}

/** How far the project is, in percent: the team's own measure when shown, never below the stages already done. */
function percentOf(project: PortalProject) {
  if (project.status === "completed") return 100;
  const measured = typeof project.progress?.percent === "number" ? project.progress.percent : null;
  const stagesDone = project.stage ? Math.round(((project.stage.number - 1) / project.stage.total) * 100) : null;
  if (measured === null) return stagesDone;
  return Math.max(measured, stagesDone ?? 0);
}

function StageSummary({ project }: { project: PortalProject }) {
  const t = useT();
  const percent = percentOf(project);
  if (!project.stage && percent === null) return null;
  const stage = project.stage;
  return <div className={styles.profileStage}>
    {stage ? <p className={styles.profileStageTitle}>{stage.name
      ? t("Stage {number} of {total} · {name}", { number: stage.number, total: stage.total, name: isolate(stageName(t, stage.name)) })
      : t("Stage {number} of {total}", { number: stage.number, total: stage.total })}</p> : null}
    {percent !== null ? <>
      <Progress label={t("How far the project is")} value={percent} />
      <span className={styles.muted}>{t("{percent}% complete", { percent })}</span>
    </> : null}
  </div>;
}

/** The project's switcher, its name, where it is and who it's for. */
function Identity({ project, view, onProject }: { project: PortalProject; view: PortalView; onProject: (id: string) => void }) {
  const t = useT();
  const labels = usePortalLabels();
  return <div className={styles.identity}>
    {view.projects.length > 1 ? <SelectField label={t("Project")} selectedKey={project.id} onSelectionChange={(key) => { if (key) onProject(String(key)); }}
      items={view.projects.map((item) => ({ id: item.id, label: item.title }))} /> : null}
    <p className={styles.eyebrow}>{[labels.projectStates[project.status], isolate(project.reference)].filter(Boolean).join(" · ")}</p>
    <h1 className={styles.profileTitle} dir="auto">{project.title}</h1>
    <ul className={styles.identityFacts}>
      {project.address ? <li><MapPin aria-hidden="true" size={14} /><span dir="auto">{project.address}</span></li> : null}
      <li><UserRound aria-hidden="true" size={14} /><span dir="auto">{view.contact.name}</span></li>
    </ul>
  </div>;
}

/** Start, the next stage and handover (or when it was handed over and the warranty). */
function KeyDates({ project, format, today }: { project: PortalProject; format: PortalFormat; today: string }) {
  const t = useT();
  const stages = project.progress?.stages ?? [];
  const current = stages.findIndex((stage) => stage.state === "current");
  const following = project.status === "completed" ? null : stages.slice(current + 1).find((stage) => stage.state === "upcoming") ?? null;
  const nextName = following ? (following.name ? stageName(t, following.name) : t("Stage {number}", { number: stages.indexOf(following) + 1 })) : null;
  const rows: Array<[string, string]> = [];
  // A start still ahead reads "Starts", never "Started" with a future date.
  if (project.startDate) rows.push([daysBetween(today, project.startDate) > 0 ? t("Starts") : t("Started"), format.date(project.startDate)]);
  if (nextName) rows.push([t("Next milestone"), nextName]);
  if (project.handedOverOn) {
    rows.push([t("Handed over"), format.date(project.handedOverOn)]);
    if (project.warrantyUntil) rows.push([t("Warranty until"), format.date(project.warrantyUntil)]);
  } else if (project.handoverDate) {
    const days = daysBetween(today, project.handoverDate);
    const when = days > 0 ? (days === 1 ? t("tomorrow") : t("in {count} days", { count: days })) : days === 0 ? t("today") : days === -1 ? t("1 day late") : t("{count} days late", { count: -days });
    rows.push([t("Handover"), `${format.date(project.handoverDate)} · ${when}`]);
  }
  if (!rows.length) return null;
  return <section className={styles.profileBlock} aria-labelledby={`dates-${project.id}`}>
    <h2 className={styles.groupTitle} id={`dates-${project.id}`}><CalendarDays aria-hidden="true" className={styles.cardIcon} size={15} />{t("Key dates")}</h2>
    <dl className={styles.facts}>{rows.map(([label, value]) => <div className={styles.factRow} key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}</dl>
  </section>;
}

/** Paid, still to pay, and the next payment with its Pay link where one exists. */
function Balance({ project, format, go }: { project: PortalProject; format: PortalFormat; go: Go }) {
  const t = useT();
  const labels = usePortalLabels();
  const payments = project.payments;
  if (!payments || !payments.milestones.length) return null;
  const money = (value: string | null) => format.money(value, payments.currency);
  const next = payments.milestones.find((item) => ["overdue", "due", "part_paid", "checking", "received"].includes(item.status))
    ?? payments.milestones.find((item) => item.status === "upcoming") ?? null;
  const totals = payments.totals;
  return <section className={styles.profileBlock} aria-labelledby={`balance-${project.id}`}>
    <h2 className={styles.groupTitle} id={`balance-${project.id}`}><Wallet aria-hidden="true" className={styles.cardIcon} size={15} />{t("Payments")}</h2>
    {totals ? <dl className={styles.balance}>
      <div><dt>{t("Paid")}</dt><dd className={styles.amount}>{money(totals.paid)}</dd></div>
      <div><dt>{t("Still to pay")}</dt><dd className={styles.amount}>{money(totals.left)}</dd></div>
    </dl> : null}
    {totals && Number(totals.paid) + Number(totals.left) > 0 ? <div className={styles.paidShare}>
      <Progress label={t("Paid so far")} value={Math.round((Number(totals.paid) / (Number(totals.paid) + Number(totals.left))) * 100)} />
      <span className={styles.itemMeta}>{t("{percent}% paid", { percent: Math.round((Number(totals.paid) / (Number(totals.paid) + Number(totals.left))) * 100) })}</span>
    </div> : null}
    {next ? <div className={styles.nextPayment}>
      <span className={styles.itemText}>
        <span className={styles.muted}>{t("Next payment")}</span>
        <span className={styles.nextPaymentTitle} dir="auto">{next.title}{labels.states[next.status]
          ? <span className={styles.state} data-tone={labels.states[next.status][1]}>{labels.states[next.status][0]}</span> : null}</span>
        <span className={styles.itemMeta}>{[next.left ?? next.amount ? money(next.left ?? next.amount) : "", next.dueDate ? t("due {date}", { date: format.date(next.dueDate) }) : ""]
          .filter(Boolean).join(" · ")}</span>
      </span>
      {next.payUrl
        ? <a className="wd-button" data-size="compact" data-variant="primary" href={next.payUrl} rel="noreferrer" target="_blank">{t("Pay")}<ExternalLink aria-hidden="true" size={14} /></a>
        : <Button size="compact" variant="quiet" onPress={() => go("payments")}>{t("See payments")}</Button>}
    </div> : null}
  </section>;
}

function useRoleLabels() {
  const t = useT();
  const labels: Record<PortalTeamRole, string> = { manager: t("Project manager"), designer: t("Designer"), sales: t("Sales") };
  return labels;
}

/** The avatar each role wears when the person hasn't chosen one. */
const AVATAR_ROLES: Record<PortalTeamRole, string> = { manager: "project_manager", designer: "designer", sales: "sales" };

/** The people the client deals with (email each), and the firm's own line: call, WhatsApp or email. */
function Team({ project, site }: { project: PortalProject; site: PortalSite }) {
  const t = useT();
  const roles = useRoleLabels();
  const team: PortalTeamMember[] = project.team ?? (project.manager ? [{ roles: ["manager"], name: project.manager, email: null, avatar: null }] : []);
  const whatsapp = site.support.whatsapp ? whatsappUrl(site.support.whatsapp) : null;
  const firm = Boolean(site.support.phone || whatsapp || site.support.email);
  if (!team.length && !firm) return null;
  return <section className={styles.profileBlock} aria-labelledby={`team-${project.id}`}>
    <h2 className={styles.groupTitle} id={`team-${project.id}`}><UsersRound aria-hidden="true" className={styles.cardIcon} size={15} />{t("Your team")}</h2>
    <ul className={styles.people}>
      {team.map((person) => <li className={styles.person} key={`${person.name}-${person.roles.join("-")}`}>
        <Avatar name={person.name} preset={person.avatar ?? "auto"} roles={person.roles.map((role) => AVATAR_ROLES[role])} seed={person.name} />
        <span className={styles.itemText}>
          <span className={styles.personName} dir="auto">{person.name}</span>
          <span className={styles.itemMeta}>{person.roles.map((role) => roles[role]).join(" · ")}</span>
        </span>
        {person.email ? <span className={styles.contactActions}>
          <a aria-label={t("Email {name}", { name: person.name })} className="wd-button wd-icon-button" data-size="compact" data-variant="quiet" href={`mailto:${person.email}`}>
            <Mail aria-hidden="true" size={15} /></a>
        </span> : null}
      </li>)}
      {firm ? <li className={styles.person}>
        <Avatar name={site.brand.name} />
        <span className={styles.itemText}>
          <span className={styles.personName} dir="auto">{site.brand.name}</span>
          {site.support.phone ? <span className={styles.itemMeta}><bdi dir="ltr">{formatPhoneForDisplay(site.support.phone)}</bdi></span> : null}
        </span>
        <span className={styles.contactActions}>
          {site.support.phone ? <a aria-label={t("Call {name}", { name: site.brand.name })} className="wd-button wd-icon-button" data-size="compact" data-variant="quiet"
            href={`tel:${site.support.phone}`}><Phone aria-hidden="true" size={15} /></a> : null}
          {whatsapp ? <a aria-label={t("WhatsApp {name}", { name: site.brand.name })} className="wd-button wd-icon-button" data-size="compact" data-variant="quiet" href={whatsapp}
            rel="noreferrer" target="_blank"><MessageCircle aria-hidden="true" size={15} /></a> : null}
          {site.support.email ? <a aria-label={t("Email {name}", { name: site.brand.name })} className="wd-button wd-icon-button" data-size="compact" data-variant="quiet"
            href={`mailto:${site.support.email}`}><Mail aria-hidden="true" size={15} /></a> : null}
        </span>
      </li> : null}
    </ul>
  </section>;
}

type UpdateChoice = "call" | "portal" | "off";

/**
 * PLM-046: how the client hears how the work goes: a call with their Account Manager, a progress update in the portal
 * instead, or neither; and how often. The decision-maker changes it (the team hears it); others read it.
 */
function Updates({ project, api, reload }: { project: PortalProject; api: PortalApi; reload: () => Promise<void> }) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const updates = project.updates;
  if (!updates) return null;
  const choice: UpdateChoice = updates.frequency === "off" ? "off" : updates.mode;
  const often = updates.frequency === "off" ? "weekly" : updates.frequency;
  const canChange = project.role === "approver" && !saving;
  const save = async (next: UpdateChoice, frequency: Exclude<PortalUpdateFrequency, "off">) => {
    if (next === choice && (next === "off" || frequency === often)) return;
    setSaving(true); setError("");
    try { await api.command(commandId(), { action: "update_preference", caseId: project.id, choice: next, frequency, version: updates.version }); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setSaving(false); }
  };
  const choices: Array<{ id: UpdateChoice; label: string }> = [{ id: "call", label: t("Call") }, { id: "portal", label: t("Portal update") }, { id: "off", label: t("No updates") }];
  const rhythms: Array<{ id: Exclude<PortalUpdateFrequency, "off">; label: string }> = [
    { id: "weekly", label: t("Weekly") }, { id: "fortnightly", label: t("Every two weeks") }, { id: "monthly", label: t("Monthly") }];
  return <section className={styles.profileBlock} aria-labelledby={`updates-${project.id}`}>
    <h2 className={styles.groupTitle} id={`updates-${project.id}`}><BellRing aria-hidden="true" className={styles.cardIcon} size={15} />{t("Your updates")}</h2>
    <SelectField label={t("Update by")} isDisabled={!canChange} selectedKey={choice} items={choices}
      onSelectionChange={(key) => { if (key) void save(String(key) as UpdateChoice, often); }} />
    {choice !== "off" ? <SelectField label={t("How often")} isDisabled={!canChange} selectedKey={often} items={rhythms}
      onSelectionChange={(key) => { if (key) void save(choice, String(key) as Exclude<PortalUpdateFrequency, "off">); }} /> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}
  </section>;
}

/** Key dates, the balance, the team and how they keep the client updated: in the side column on a wide screen, at the foot of the Overview on a narrow one. */
export function ProfileDetails({ project, site, format, today, go, api, reload }: { project: PortalProject; site: PortalSite; format: PortalFormat; today: string; go: Go;
  /** To change how the client hears how the work goes (absent where it is only read). */
  api?: PortalApi; reload?: () => Promise<void> }) {
  return <>
    <KeyDates project={project} format={format} today={today} />
    <Balance project={project} format={format} go={go} />
    <Team project={project} site={site} />
    {api && reload ? <Updates project={project} api={api} reload={reload} /> : null}
  </>;
}

/**
 * The client and their project, beside what they're looking at. Wide: the whole profile (identity, stage, dates,
 * balance, team) in a column that stays in view. Narrow: one compact card with the project, its stage and progress,
 * and the next thing to do.
 */
export function ProjectProfile({ project, view, site, format, wide, showNext, onProject, open, go, nav }: {
  project: PortalProject; view: PortalView; site: PortalSite; format: PortalFormat; wide: boolean;
  /** The sections, listed under the project in the dashboard's sidebar. */
  nav?: React.ReactNode;
  /** Offer the next thing to do (not while the Overview, which lists them all, is open). */
  showNext: boolean; onProject: (id: string) => void; open: Open; go: Go;
}) {
  const t = useT();
  const step = useStepText(format);
  if (wide) return <div className={styles.profile} data-layout="panel">
    <Identity project={project} view={view} onProject={onProject} />
    {project.paused ? null : <>
      <StageSummary project={project} />
      {nav}
      {nav ? null : <ProfileDetails project={project} site={site} format={format} today={view.today} go={go} />}
    </>}
  </div>;
  const next = project.paused || !showNext ? null : project.next[0] ?? null;
  const act = (item: PortalStep) => (item.kind === "invoice" ? go("payments") : item.kind === "presentation" || item.kind === "choice" ? go("decisions") : open({ kind: item.kind, id: item.id }));
  return <div className={styles.profile} data-layout="card">
    <Identity project={project} view={view} onProject={onProject} />
    {project.paused ? null : <StageSummary project={project} />}
    {next ? <button className={styles.nextAction} type="button" onClick={() => act(next)}>
      <span className={styles.itemText}>
        <span className={styles.muted}>{t("Next for you")}</span>
        <span className={styles.nextPaymentTitle}>{step.title(next)}</span>
      </span>
      <ChevronRight aria-hidden="true" size={18} />
    </button> : null}
  </div>;
}
