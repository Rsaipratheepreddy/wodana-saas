"use client";

import { useRef, useState } from "react";
import { ControlledModalDialog, EmptyState, InlineNotice, useMediaQuery } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalApi } from "@/lib/client-portal/client";
import { siteBrand } from "@/lib/client-portal/document-quote";
import { PORTAL_SECTIONS, type PortalProject, type PortalSection, type PortalSite, type PortalView } from "@/lib/client-portal/types";
import { ChangeSheet } from "./decisions/change-sheet";
import { DefinitionSheet } from "./decisions/definition-sheet";
import { DesignSheet } from "./decisions/design-sheet";
import { HandoverSheet } from "./decisions/handover-sheet";
import { DrawingsSheet } from "./decisions/drawings-sheet";
import { MaterialsSheet } from "./decisions/materials-sheet";
import { QuestionSheet } from "./decisions/question-sheet";
import { QuoteSheet } from "./decisions/quote-sheet";
import { SiteAccessSheet } from "./decisions/site-access-sheet";
import { ChangeForm } from "./forms/change-form";
import { ClaimForm } from "./forms/claim-form";
import { BoardDetail, IdeaForm, PinDetail } from "./forms/idea-forms";
import { IssueForm } from "./forms/issue-form";
import { NewMessage, Thread } from "./forms/message-forms";
import { PaidForm } from "./forms/paid-form";
import { QuestionForm } from "./forms/question-form";
import { usePortalFormat, type PortalFormat } from "./portal-format";
import { usePortalLabels } from "./portal-labels";
import { PortalActions, PortalBrand, PortalSupport } from "./portal-frame";
import styles from "./portal.module.css";
import { ProfileDetails, ProjectProfile } from "./project-profile";
import { SectionNav, type NavItem, type PortalPage } from "./section-nav";
import { DecisionsSection } from "./sections/decisions-section";
import { DocumentsSection } from "./sections/documents-section";
import { HomeSection } from "./sections/home-section";
import { MessagesSection } from "./sections/messages-section";
import { MoodboardSection } from "./sections/moodboard-section";
import { PaymentsSection } from "./sections/payments-section";
import { ProgressSection } from "./sections/progress-section";
import type { PortalTarget, SectionProps } from "./sections/section-types";
import { WarrantySection } from "./sections/warranty-section";

const SECTIONS = { overview: HomeSection, progress: ProgressSection, moodboard: MoodboardSection, decisions: DecisionsSection, payments: PaymentsSection, documents: DocumentsSection,
  warranty: WarrantySection, messages: MessagesSection } as const;
/** The order the client reads them in: where it stands, what to decide, the ideas, then money, papers, cover and talk. */
const ORDER: PortalSection[] = ["progress", "decisions", "moodboard", "payments", "documents", "warranty", "messages"];
const DECISION_STEPS = ["quote", "design", "definition", "materials", "drawings", "handover", "request", "change", "presentation", "choice"];
/** The side column opens from a small laptop up; below it the profile is a card above the sections. */
const WIDE = "(min-width: 64rem)";

/** A section is shown whenever the team shares it; an empty one says what will appear there. */
function hasContent(project: PortalProject, section: PortalSection) {
  return Boolean(project.sections[section]) && project[section] !== null && project[section] !== undefined;
}

/** Where a link from an email points: ?project=<id>&open=<section>. */
function fromLocation() {
  if (typeof window === "undefined") return { project: null, open: null };
  const params = new URLSearchParams(window.location.search);
  return { project: params.get("project"), open: params.get("open") };
}

/** What waits in each section, as a badge beside it ("2 to decide", "1 due", "3 new"). */
function badges(project: PortalProject, t: ReturnType<typeof useT>): Partial<Record<PortalPage, NavItem["badge"]>> {
  const decide = project.next.filter((step) => DECISION_STEPS.includes(step.kind)).length;
  const milestones = project.payments?.milestones ?? [];
  const overdue = milestones.filter((item) => item.status === "overdue").length;
  const due = milestones.filter((item) => ["overdue", "due", "part_paid"].includes(item.status)).length;
  return {
    decisions: decide ? { text: t("{count} to decide", { count: decide }), tone: "warning" } : undefined,
    payments: due ? { text: overdue ? t("{count} overdue", { count: overdue }) : t("{count} due", { count: due }), tone: overdue ? "danger" : "warning" } : undefined,
    messages: project.unread ? { text: t("{count} new", { count: project.unread }), tone: "info" } : undefined,
  };
}

/**
 * The signed-in client's projects, one at a time: the client and project profile on one side (stage, key dates,
 * balance, team and the sections), and the open section on the other, the Overview first. On a narrow screen the
 * profile is a compact card and the sections one row that scrolls sideways.
 */
export function PortalWorkspace({ view, site, api, reload, onSignOut }: { view: PortalView; site: PortalSite; api: PortalApi; reload: () => Promise<void>; onSignOut?: () => void }) {
  const t = useT();
  const labels = usePortalLabels();
  const format = usePortalFormat(site.region);
  const wide = useMediaQuery(WIDE);
  const content = useRef<HTMLDivElement>(null);
  const [initial] = useState(fromLocation);
  const [projectId, setProjectId] = useState(() => view.projects.find((item) => item.id === initial.project)?.id ?? view.projects[0]?.id ?? "");
  const [section, setSection] = useState<PortalPage>(() => (PORTAL_SECTIONS as readonly string[]).includes(initial.open ?? "") ? initial.open as PortalSection : "overview");
  const [target, setTarget] = useState<PortalTarget | null>(null);
  const [notice, setNotice] = useState("");
  const project = view.projects.find((item) => item.id === projectId) ?? view.projects[0];
  if (!project) return <EmptyState illustration="locked" title={t("No projects to show")} description={t("Your project team hasn't shared a project with you yet.")} />;
  const shown: PortalPage[] = ["overview", ...ORDER.filter((item) => hasContent(project, item))];
  const current: PortalPage = shown.includes(section) ? section : "overview";
  const go = (next: PortalPage) => {
    setSection(next); setNotice("");
    // A long section read to its foot: the next one opens at its top.
    const top = content.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) content.current?.scrollIntoView?.({ block: "start" });
  };
  const open = (next: PortalTarget) => { setNotice(""); setTarget(next); };
  const done = (message: string) => async () => { setTarget(null); setNotice(message); await reload(); };
  const props: SectionProps = { project, site, api, format, today: view.today, open, go, reload, wide };
  const counts = badges(project, t);
  const Section = SECTIONS[current];
  const dialog = target ? dialogFor(target, project, { site, customer: view.contact.name, api, format, done, reload, today: view.today, t }) : null;
  const nav = !project.paused && shown.length > 1
    ? <SectionNav items={shown.map((id) => ({ id, label: labels.sections[id], badge: counts[id] }))} current={current} onSelect={go} layout={wide ? "list" : "tabs"} /> : null;
  const modal = dialog ? <ControlledModalDialog isOpen onOpenChange={(isOpen) => { if (!isOpen) setTarget(null); }} size={target?.kind === "quote" ? "xl" : target?.kind === "board" ? "lg" : "md"} title={dialog.title}>
    {dialog.body}
  </ControlledModalDialog> : null;
  // Wide: a dashboard, like the team's own Wodana. The sidebar holds the brand, the project and its sections; the
  // top bar names where you are; the Overview opens on the key dates, the balance and the team as cards.
  if (wide) return <div className={styles.app}>
    <aside className={styles.appSidebar} aria-label={t("Your project")}>
      <PortalBrand site={site} />
      <ProjectProfile project={project} view={view} site={site} format={format} wide showNext={false} open={open} go={go} nav={nav ?? <span />}
        onProject={(id) => { setProjectId(id); setSection("overview"); setNotice(""); }} />
      <PortalSupport site={site} />
    </aside>
    <div className={styles.appMain}>
      <header className={styles.appTopbar}>
        <span className={styles.appCrumb} dir="auto">{project.title}</span>
        <span className={styles.appCrumbSep} aria-hidden="true">/</span>
        <strong>{labels.sections[current]}</strong>
        <PortalActions onSignOut={onSignOut} />
      </header>
      <div className={styles.appContent} ref={content}>
        {project.paused ? <EmptyState illustration="locked" title={t("Your project page is paused")}
          description={t("Your project team will let you know when it's back. You can still reach them below.")} /> : <>
          <h2 className="wd-visually-hidden" id="portal-view-title">{labels.sections[current]}</h2>
          {notice ? <InlineNotice tone="success" message={notice} /> : null}
          {current === "overview" ? <div className={styles.summary}><ProfileDetails project={project} site={site} format={format} today={view.today} go={go} /></div> : null}
          <section aria-labelledby="portal-view-title" className={styles.view}><Section {...props} /></section>
        </>}
      </div>
    </div>
    {modal}
  </div>;
  return <div className={styles.workspace} data-layout={wide ? "wide" : "narrow"}>
    <aside className={styles.aside} aria-label={t("Your project")}>
      <ProjectProfile project={project} view={view} site={site} format={format} wide={wide} showNext={current !== "overview"} open={open} go={go}
        onProject={(id) => { setProjectId(id); setSection("overview"); setNotice(""); }} />
    </aside>
    <div className={styles.content} ref={content}>
      {nav}
      {project.paused ? <EmptyState illustration="locked" title={t("Your project page is paused")}
        description={t("Your project team will let you know when it's back. You can still reach them below.")} /> : <>
        <h2 className="wd-visually-hidden" id="portal-view-title">{labels.sections[current]}</h2>
        {notice ? <InlineNotice tone="success" message={notice} /> : null}
        <section aria-labelledby="portal-view-title" className={styles.view}><Section {...props} /></section>
      </>}
    </div>
    {modal}
  </div>;
}

type Tools = { site: PortalSite; customer: string; api: PortalApi; format: PortalFormat; done: (message: string) => () => Promise<void>; reload: () => Promise<void>; today: string;
  t: ReturnType<typeof useT> };

/** The dialog for what was opened: a decision at its revision, a conversation or a form. */
function dialogFor(target: PortalTarget, project: PortalProject, { site, customer, api, format, done, reload, today, t }: Tools) {
  const decisions = project.decisions;
  const channels = site.signIn.channels;
  const common = { caseId: project.id, api, format, channels };
  const decided = done(t("Thank you. Your decision was sent to your project team."));
  if (target.kind === "quote") {
    const quote = decisions?.quotes.find((item) => item.id === target.id);
    return quote ? { title: `${quote.title} · V${quote.number}`, body: <QuoteSheet quote={quote} slug={site.slug} brand={siteBrand(site)} customer={customer} onDecided={decided} {...common} /> } : null;
  }
  if (target.kind === "design") {
    const design = decisions?.designs.find((item) => item.id === target.id);
    const review = project.design?.designs.flatMap((item) => item.versions).find((version) => version.id === design?.id) ?? null;
    return design ? { title: `${design.title} · V${design.number}`, body: <DesignSheet design={design} onDecided={decided} review={review} onComment={reload} {...common} /> } : null;
  }
  if (target.kind === "definition" && decisions?.definition)
    return { title: t("Your requirements · R{number}", { number: decisions.definition.number }), body: <DefinitionSheet definition={decisions.definition} onDecided={decided} {...common} /> };
  if (target.kind === "materials" && decisions?.materials)
    return { title: t("Material list · R{number}", { number: decisions.materials.number }), body: <MaterialsSheet list={decisions.materials} onDecided={decided} {...common} /> };
  if (target.kind === "drawings" && decisions?.drawings)
    return { title: t("Drawings · R{number}", { number: decisions.drawings.number }), body: <DrawingsSheet drawings={decisions.drawings} onDecided={decided} {...common} /> };
  if (target.kind === "handover") {
    const pack = decisions?.handovers.find((item) => item.id === target.id);
    return pack ? { title: `${pack.title} · R${pack.revision}`, body: <HandoverSheet pack={pack} onDecided={decided} {...common} /> } : null;
  }
  if (target.kind === "change") {
    const change = project.changes?.find((item) => item.id === target.id);
    return change ? { title: `${change.reference} · ${change.title}`, body: <ChangeSheet change={change} onDecided={decided} {...common} /> } : null;
  }
  if (target.kind === "raise-change")
    return { title: t("Ask for a change"), body: <ChangeForm caseId={project.id} api={api} onDone={done(t("Sent. Your project team will work out the price and time and send it back to you."))} /> };
  if (target.kind === "request") {
    const question = decisions?.requests.find((item) => item.id === target.id);
    return question ? { title: question.title, body: <QuestionSheet question={question} caseId={project.id} api={api} format={format} onDecided={decided} /> } : null;
  }
  if (target.kind === "site_access") {
    const delivery = project.progress?.siteAccess.find((item) => item.id === target.id);
    return delivery ? { title: t("Confirm site access for {date}", { date: format.date(delivery.date) }), body: <SiteAccessSheet delivery={delivery} caseId={project.id} api={api} format={format}
      today={today} onDone={(decision) => void done(decision === "confirm" ? t("Thank you. Your project team knows someone will let them in.") : t("Your project team will come back with a new day."))()} /> } : null;
  }
  if (target.kind === "thread") {
    const request = project.messages?.requests.find((item) => item.id === target.id);
    return request ? { title: request.title, body: <Thread request={request} caseId={project.id} api={api} format={format} onReplied={() => void reload()} /> } : null;
  }
  if (target.kind === "new-message") return { title: t("New message"), body: <NewMessage caseId={project.id} api={api} onDone={done(t("Your message was sent to your project team."))} /> };
  if (target.kind === "claim" && project.warranty)
    return { title: t("Report a problem"), body: <ClaimForm project={project} api={api} areaId={target.areaId} onDone={done(t("Thank you. Your project team will be in touch about it."))} /> };
  if (target.kind === "board") {
    const board = project.moodboard?.boards.find((item) => item.id === target.id);
    return board ? { title: `${board.title} · V${board.number}`, body: <BoardDetail board={board} caseId={project.id} api={api} format={format} onChanged={() => void reload()} /> } : null;
  }
  if (target.kind === "pin") {
    const pin = project.moodboard?.pins.find((item) => item.id === target.id);
    return pin ? { title: pin.title, body: <PinDetail pin={pin} caseId={project.id} api={api} format={format} onChanged={() => void reload()}
      onRemoved={done(t("The idea was removed from your moodboard."))} /> } : null;
  }
  if (target.kind === "idea" && project.moodboard)
    return { title: t("Add an idea"), body: <IdeaForm project={project} api={api} onDone={done(t("Added to your moodboard. Your design team will see it."))} /> };
  if (target.kind === "paid") {
    const milestone = project.payments?.milestones.find((item) => item.id === target.id);
    return milestone ? { title: milestone.title, body: <PaidForm milestone={milestone} caseId={project.id} currency={project.payments!.currency} today={today} api={api} format={format}
      onDone={done(t("Thank you. We'll check your payment and let you know."))} /> } : null;
  }
  if (target.kind === "issue" && project.progress)
    return { title: t("Report an issue"), body: <IssueForm project={project} api={api} onDone={done(t("Thank you. Your project manager will look at it."))} /> };
  if (target.kind === "question" && project.progress) {
    const card = project.progress.cards?.find((item) => item.id === target.id);
    return card ? { title: t("Ask about {date}", { date: format.date(card.date) }), body: <QuestionForm project={project} reportId={card.id} api={api}
      onDone={done(t("Thank you. Your project manager will answer under Messages."))} /> } : null;
  }
  return null;
}
