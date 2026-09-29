"use client";

import { useState } from "react";
import { ControlledModalDialog, EmptyState, InlineNotice, PillTabs, SelectField } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalApi } from "@/lib/client-portal/client";
import { siteBrand } from "@/lib/client-portal/document-quote";
import { PORTAL_SECTIONS, type PortalProject, type PortalSection, type PortalSite, type PortalView } from "@/lib/client-portal/types";
import { DefinitionSheet } from "./decisions/definition-sheet";
import { DesignSheet } from "./decisions/design-sheet";
import { HandoverSheet } from "./decisions/handover-sheet";
import { MaterialsSheet } from "./decisions/materials-sheet";
import { QuestionSheet } from "./decisions/question-sheet";
import { QuoteSheet } from "./decisions/quote-sheet";
import { SiteAccessSheet } from "./decisions/site-access-sheet";
import { ClaimForm } from "./forms/claim-form";
import { BoardDetail, IdeaForm, PinDetail } from "./forms/idea-forms";
import { IssueForm } from "./forms/issue-form";
import { NewMessage, Thread } from "./forms/message-forms";
import { PaidForm } from "./forms/paid-form";
import { isolate, usePortalFormat, type PortalFormat } from "./portal-format";
import { usePortalLabels } from "./portal-labels";
import styles from "./portal.module.css";
import { DecisionsSection } from "./sections/decisions-section";
import { DocumentsSection } from "./sections/documents-section";
import { HomeSection } from "./sections/home-section";
import { MessagesSection } from "./sections/messages-section";
import { MoodboardSection } from "./sections/moodboard-section";
import { PaymentsSection } from "./sections/payments-section";
import { ProgressSection } from "./sections/progress-section";
import type { PortalTarget, SectionProps } from "./sections/section-types";
import { WarrantySection } from "./sections/warranty-section";

type Tab = "home" | PortalSection;
const SECTIONS = { home: HomeSection, progress: ProgressSection, moodboard: MoodboardSection, decisions: DecisionsSection, payments: PaymentsSection, documents: DocumentsSection,
  warranty: WarrantySection, messages: MessagesSection } as const;
const DECISION_STEPS = ["quote", "design", "definition", "materials", "handover", "request"];

/** A section is a tab when it's shared and has something in it (or something the client can do there). */
function hasContent(project: PortalProject, section: PortalSection) {
  if (!project.sections[section] || project[section] === null) return false;
  if (section === "progress") { const p = project.progress!; return Boolean(p.stages.length || p.updates.length || p.photoDays.length || p.issues.length || p.canReportIssue); }
  if (section === "moodboard") { const m = project.moodboard!; return Boolean(m.boards.length || m.pins.length || m.canAdd); }
  if (section === "payments") return project.payments!.milestones.length > 0;
  if (section === "documents") return project.documents!.length > 0;
  if (section === "warranty") return project.warranty!.rooms.length > 0 || project.warranty!.claims.length > 0;
  return true;
}

/** Where a link from an email points: ?project=<id>&open=<section>. */
function fromLocation() {
  if (typeof window === "undefined") return { project: null, open: null };
  const params = new URLSearchParams(window.location.search);
  return { project: params.get("project"), open: params.get("open") };
}

/** The signed-in client's projects: one at a time, Home first, then the sections the team shares. */
export function PortalWorkspace({ view, site, api, reload }: { view: PortalView; site: PortalSite; api: PortalApi; reload: () => Promise<void> }) {
  const t = useT();
  const labels = usePortalLabels();
  const format = usePortalFormat(site.region);
  const [initial] = useState(fromLocation);
  const [projectId, setProjectId] = useState(() => view.projects.find((item) => item.id === initial.project)?.id ?? view.projects[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>(() => (PORTAL_SECTIONS as readonly string[]).includes(initial.open ?? "") ? initial.open as PortalSection : "home");
  const [target, setTarget] = useState<PortalTarget | null>(null);
  const [notice, setNotice] = useState("");
  const project = view.projects.find((item) => item.id === projectId) ?? view.projects[0];
  if (!project) return <EmptyState illustration="locked" title={t("No projects to show")} description={t("Your project team hasn't shared a project with you yet.")} />;
  const tabs: Tab[] = ["home", ...PORTAL_SECTIONS.filter((section) => hasContent(project, section))];
  const current: Tab = tabs.includes(tab) ? tab : "home";
  const go = (next: Tab) => { setTab(next); setNotice(""); };
  const done = (message: string) => async () => { setTarget(null); setNotice(message); await reload(); };
  const props: SectionProps = { project, site, api, format, today: view.today, open: (next) => { setNotice(""); setTarget(next); }, go, reload };
  const counts: Partial<Record<Tab, number>> = { decisions: project.next.filter((step) => DECISION_STEPS.includes(step.kind)).length, messages: project.unread };
  const Section = SECTIONS[current];
  const dialog = target ? dialogFor(target, project, { site, customer: view.contact.name, api, format, done, reload, today: view.today, t }) : null;
  return <>
    <div className={styles.projectHead}>
      {view.projects.length > 1 ? <SelectField label={t("Project")} selectedKey={project.id} onSelectionChange={(key) => { if (key) { setProjectId(String(key)); setTab("home"); } }}
        items={view.projects.map((item) => ({ id: item.id, label: item.title }))} /> : null}
      <h1 className={styles.title} dir="auto">{project.title}</h1>
      <p className={styles.meta}>{[labels.projectStates[project.status], isolate(project.reference)].filter(Boolean).join(" · ")}</p>
    </div>
    {project.paused ? <EmptyState illustration="locked" title={t("Your project page is paused")}
      description={t("Your project team will let you know when it's back. You can still reach them below.")} /> : <>
      {tabs.length > 1 ? <div className={styles.nav}><PillTabs ariaLabel={t("Sections")} selectedKey={current} onSelectionChange={(key) => go(key as Tab)} tour="portal-tab" layout="scroll"
        items={tabs.map((id) => ({ id, label: labels.sections[id], count: counts[id] || undefined }))} /></div> : null}
      {notice ? <InlineNotice tone="success" message={notice} /> : null}
      <div role="tabpanel" aria-label={labels.sections[current]}><Section {...props} /></div>
    </>}
    {dialog ? <ControlledModalDialog isOpen onOpenChange={(open) => { if (!open) setTarget(null); }} size={target?.kind === "quote" ? "xl" : target?.kind === "board" ? "lg" : "md"} title={dialog.title}>
      {dialog.body}
    </ControlledModalDialog> : null}
  </>;
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
    return design ? { title: `${design.title} · V${design.number}`, body: <DesignSheet design={design} onDecided={decided} {...common} /> } : null;
  }
  if (target.kind === "definition" && decisions?.definition)
    return { title: t("Your requirements · R{number}", { number: decisions.definition.number }), body: <DefinitionSheet definition={decisions.definition} onDecided={decided} {...common} /> };
  if (target.kind === "materials" && decisions?.materials)
    return { title: t("Material list · R{number}", { number: decisions.materials.number }), body: <MaterialsSheet list={decisions.materials} onDecided={decided} {...common} /> };
  if (target.kind === "handover") {
    const pack = decisions?.handovers.find((item) => item.id === target.id);
    return pack ? { title: `${pack.title} · R${pack.revision}`, body: <HandoverSheet pack={pack} onDecided={decided} {...common} /> } : null;
  }
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
  return null;
}
