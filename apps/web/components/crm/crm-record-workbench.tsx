"use client";
import { useState } from "react";
import { ArrowRight, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { caseHref } from "@/lib/pre-project/types";
import { OpportunityDiscovery } from "./opportunity-discovery";
import { OpportunityIntro } from "./opportunity-intro";
import { OpportunityEditDialog, localDate } from "./opportunity-edit-dialog";
import { FurniturePathDialog, PaymentProofDialog, StageBlockedSheet } from "./opportunity-flow";
import { NowCard, ProgressLine, type StageMove } from "./opportunity-now";
import type { MissingRequirement } from "@/lib/crm/client";
import { FURNITURE_PATHS, missingFrom, proofHref, type OpportunityFlowView } from "@/lib/crm/opportunity-flow";
import { nowPlan, type FunnelStep, type NowStep } from "@/lib/crm/now-step";
import { RecordAttachments } from "./record-attachments";
import { SequenceEditor } from "./sequence-editor";
import { useWoddyRecord } from "./woddy-chat";
import { Avatar, Badge, Button, Callout, ControlledModalDialog, EditableField, EditableFieldList, EmptyState, FactRow, FillWithWoddy, IconMenuButton, personDisplayName, Switch, Tabs, useDesignSystem } from "@/design-system";
import { useAiReady } from "@/lib/workspace/ai-settings";
import { fillWithWoddy, imageForWoddy } from "@/lib/woddy/form-fill";
import { ContactMatchNotice } from "./contact-match-notice";
import { useT } from "@/lib/i18n/i18n-provider";
import type { CrmScreenId } from "@/lib/crm/screens";
import { CrmRequestError, crmRequest, dateText, label, rows, type RecordData } from "@/lib/crm/client";
import { ActionDialog, ActivityPanel, CustomerPanel, FactList, ResourceState, choice, options, useCrmResource, type ActionSpec, type FieldSpec } from "./crm-workbench";
import styles from "./crm-workbench.module.css";
import screen from "./opportunity-now.module.css";

export function LinkedRecordWorkbench({ id, workspaceId, recordId, onChanged }: { id: CrmScreenId; workspaceId: string; recordId: string; onChanged: () => Promise<void> }) {
  const collection = id === "customers" || id === "organizations" ? "parties" : id;
  const resource = useCrmResource<RecordData>(workspaceId, `${collection}/${recordId}`);
  return resource.data ? <CrmRecordWorkbench key={recordId} workspaceId={workspaceId} id={id} row={resource.data} onChanged={async () => { resource.refresh(); await onChanged(); }} /> : <ResourceState {...resource} retry={resource.refresh} />;
}

function recordLink(row: RecordData) {
  const match = String(row.deepLink ?? "").match(/^\/crm\/(leads|opportunities|activities|conversations)\/([\da-f-]{36})$/i);
  return match ? `/workspace/crm/${match[1]}?${match[1] === "leads" ? "lead" : "record"}=${match[2]}` : null;
}

export function CrmRecordWorkbench({ id, row, workspaceId, onChanged }: { id: CrmScreenId; row: RecordData; workspaceId: string; onChanged: () => Promise<void> }) {
  const t = useT();
  if (id === "customers" || id === "organizations") return <CustomerPanel workspaceId={workspaceId} partyId={row.id} onChanged={onChanged} />;
  if (id === "opportunities") return <OpportunityWorkbench workspaceId={workspaceId} row={row} onChanged={onChanged} />;
  if (id === "conversations") return <ConversationWorkbench workspaceId={workspaceId} row={row} onChanged={onChanged} />;
  if (id === "sequences" || id === "automations") return <AutomationWorkbench kind={id} workspaceId={workspaceId} row={row} onChanged={onChanged} />;
  if (id === "activities") return <ActivityWorkbench workspaceId={workspaceId} row={row} onChanged={onChanged} />;
  if (id === "crm-overview") return <div className={styles.workbench}><h3>{String(row.title)}</h3><p>{String(row.reason ?? t("Review this record and its next action."))}</p>{recordLink(row) ? <Link className={styles.link} href={recordLink(row)!}>{t("Open record")}</Link> : <p>{t("No linked record is available.")}</p>}</div>;
  return <FactList facts={Object.entries(row).filter(([key, value]) => key !== "id" && value !== null && typeof value !== "object").map(([key, value]) => [label(key), String(value)])} />;
}

function OpportunityWorkbench({ workspaceId, row, onChanged }: { workspaceId: string; row: RecordData; onChanged: () => Promise<void> }) {
  const t = useT();
  const { locale, currency: regionCurrency, timeZone } = useDesignSystem();
  useWoddyRecord("opportunity", row.id, String(row.title ?? t("Opportunity")));
  const router = useRouter();
  const [openingCase, setOpeningCase] = useState(false);
  const [caseError, setCaseError] = useState("");
  const openCase = async () => {
    if (openingCase) return;
    setOpeningCase(true); setCaseError("");
    try {
      const response = await fetch(`/api/workspace/pre-projects?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opportunityId: row.id }), signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok || !result.id) throw new Error(result.message ?? t("Could not open Planning."));
      router.push(caseHref(result.id, new URLSearchParams(), "overview"));
    } catch (error) { setCaseError(error instanceof Error ? error.message : t("Could not open the case.")); setOpeningCase(false); }
  };
  const resource = useCrmResource<RecordData>(workspaceId, `opportunities/${row.id}`);
  const pipelines = useCrmResource<unknown>(workspaceId, "pipelines");
  // The people who can own CRM work (the same list and rule the server checks), readable by Sales.
  const members = useCrmResource<unknown>(workspaceId, "sales-owners");
  const [action, setAction] = useState<ActionSpec | null>(null);
  const live = { ...row, ...resource.data };
  const pipeline = rows(pipelines.data).find((p) => p.id === (live.pipelineId ?? live.pipeline_id));
  const stages = (pipeline?.stages ?? []) as RecordData[];
  const activeStages = stages.filter(stage => stage.status === "active");
  const activeWorkingStages = activeStages.filter(stage => !["won", "lost"].includes(String(stage.code)));
  const stageHistory = (Array.isArray(live.stageHistory) ? live.stageHistory : []) as Array<StageMove & { id?: string; fromStageName?: string | null; toStageName?: string | null; toStatus?: string | null; reason?: string | null }>;
  const previousStageId = stageHistory.map(entry => String(entry.fromStageId ?? "")).find(stageId => activeWorkingStages.some(stage => stage.id === stageId));
  const partyId = String(live.partyId ?? live.party_id ?? "");
  const ownerId = String(live.ownerMembershipId ?? live.owner_membership_id ?? "");
  const status = String(live.status ?? "open");
  const closed = status !== "open";
  const currentStage = stages.find(stage => stage.id === (live.stageId ?? live.stage_id));
  const outcomeMismatch = (currentStage?.code === "won" || currentStage?.code === "lost") && status !== currentStage.code;
  const amount = Number(live.amount);
  const currency = String(live.currencyCode ?? live.currency_code ?? "");
  const hasValue = live.amount !== null && live.amount !== undefined && Number.isFinite(amount) && /^[A-Z]{3}$/.test(currency);
  const value = hasValue ? new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount) : t("Not set");
  // Moves forward follow the flow; the menu only goes back (or reopens a closed one).
  const currentIndex = activeWorkingStages.findIndex(stage => stage.id === (live.stageId ?? live.stage_id));
  const earlierStages = currentIndex > 0 ? activeWorkingStages.slice(0, currentIndex) : [];
  const startStageChange = () => {
    const choices = closed ? activeWorkingStages : earlierStages;
    const initialStage = closed ? (previousStageId ?? String(activeWorkingStages[0]?.id ?? "")) : String(earlierStages.at(-1)?.id ?? "");
    setAction({
      title: closed ? t("Reopen opportunity") : t("Change stage"),
      path: `opportunities/${row.id}/transition`,
      initial: { version: live.version, stageId: initialStage },
      fields: [{ key: "stageId", label: t("Stage"), options: options(choices), required: true }, { key: "reason", label: t("Reason"), required: true }, ...(closed ? [{ key: "nextActionAt", label: t("Next follow-up"), type: "datetime-local" as const, required: true }] : [])],
      transform: values => ({ ...values, status: "open" }),
      submit: closed ? t("Reopen opportunity") : t("Change stage"),
    });
  };
  const startOutcome = (outcome: "won" | "lost") => {
    const outcomeStage = activeStages.find(stage => stage.code === outcome);
    setAction({
      title: outcome === "won" ? t("Mark opportunity Won") : t("Mark opportunity Lost"),
      path: `opportunities/${row.id}/transition`,
      initial: { version: live.version, stageId: outcomeStage?.id ?? live.stageId ?? live.stage_id, status: outcome },
      fields: [{ key: "reason", label: outcome === "won" ? t("Win evidence and reference") : t("Loss reason"), required: true }, ...(outcome === "lost" ? [{ key: "competitor", label: t("Competitor (optional)") }] : [])],
      submit: outcome === "won" ? t("Confirm win") : t("Confirm loss"),
    });
  };
  const saved = async () => { resource.refresh(); await onChanged(); };
  // PLM-121/122: the flow's next step, what blocks it, and the payment proof that wins the deal.
  const flow = (live.flow && typeof live.flow === "object" ? live.flow : null) as OpportunityFlowView | null;
  const [proofOpen, setProofOpen] = useState(false);
  const [furnitureOpen, setFurnitureOpen] = useState(false);
  const [blocked, setBlocked] = useState<{ stage: string; items: MissingRequirement[] } | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [flowError, setFlowError] = useState("");
  const freshVersion = async () => Number((await crmRequest<RecordData>(workspaceId, `opportunities/${row.id}`)).version);
  const wonStage = activeStages.find(stage => stage.code === "won");
  const startWin = () => {
    const others = (flow?.toWon ?? []).filter(item => item.key !== "paymentProof");
    if (others.length) { setBlocked({ stage: String(wonStage?.name ?? t("Won")), items: others }); return; }
    if (!flow || flow.toWon.some(item => item.key === "paymentProof")) { setProofOpen(true); return; }
    startOutcome("won");
  };
  const advance = async () => {
    if (!flow?.next || advancing) return;
    if (flow.next.step === "won") { startWin(); return; }
    setAdvancing(true); setFlowError("");
    try {
      await crmRequest(workspaceId, `opportunities/${row.id}/transition`, "POST", { version: await freshVersion(), stageId: flow.next.stageId, status: "open" });
      await saved();
    } catch (error) {
      const missing = missingFrom(error);
      if (missing.length) setBlocked({ stage: flow.next.name, items: missing });
      else setFlowError(error instanceof Error ? error.message : t("Could not move the opportunity. Try again."));
    } finally { setAdvancing(false); }
  };
  const saveFlow = async (body: Record<string, unknown>) => {
    await crmRequest(workspaceId, `opportunities/${row.id}/flow`, "PUT", { version: await freshVersion(), ...body });
    await saved();
  };
  // In-place edits: each goes through the opportunity's update with its version (the newest one this view saw).
  const [savedVersion, setSavedVersion] = useState(0);
  const patch = async (body: Record<string, unknown>) => {
    try {
      const result = await crmRequest<RecordData>(workspaceId, `opportunities/${row.id}`, "PATCH", { version: Math.max(Number(live.version ?? 0), savedVersion), ...body });
      if (result?.version) setSavedVersion(Number(result.version));
      await saved();
    } catch (cause) {
      if (cause instanceof CrmRequestError && cause.status === 409) resource.refresh();
      throw cause;
    }
  };
  const owners = rows(members.data).filter((member) => member.status === undefined || member.status === "active")
    .map((member) => ({ id: String(member.id), label: String(member.displayName || member.name || member.email || "") })).filter((member) => member.label);
  const ownerName = personDisplayName(live.ownerName as string | null);
  const owner = ownerId && ownerName ? { id: ownerId, label: ownerName } : null;
  const closeDate = localDate(live.expectedCloseAt ?? live.expected_close_at);
  const valueCurrency = /^[A-Z]{3}$/.test(currency) ? currency : regionCurrency;
  const [tab, setTab] = useState("details");
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bookIntro, setBookIntro] = useState(false);
  const funnel = (Array.isArray(live.funnel) ? live.funnel : []) as FunnelStep[];
  const caseId = live.preProjectCaseId ? String(live.preProjectCaseId) : null;
  const leadId = live.leadId ?? live.lead_id;
  const caseLink = (section: string) => caseId ? caseHref(caseId, new URLSearchParams(), section) : "";
  const followUp = typeof (live.nextActionAt ?? live.next_action_at) === "string" ? String(live.nextActionAt ?? live.next_action_at) : null;
  const plan = nowPlan({ flow, status, funnel, caseId });
  const showIntro = !flow || flow.flow === "design" || flow.flow === "fit_out";
  const showDiscovery = showIntro || [plan.now, ...plan.more].some((step) => step?.target === "discovery");
  const reveal = (sectionId: string) => { setTab("details"); window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60); };
  const act = (step: NowStep) => {
    if (step.target === "proof") setProofOpen(true);
    else if (step.target === "furniture") setFurnitureOpen(true);
    else if (step.target === "intro") { setBookIntro(true); reveal("intro-meeting"); }
    else if (step.target === "discovery") reveal("discovery-property");
    else if (step.target === "quote" || step.target === "planning") { if (caseId) router.push(caseLink(step.target === "quote" ? "quotations" : step.section ?? "overview")); else void openCase(); }
    else if (step.target === "enquiry" && leadId) router.push(`/workspace/crm/leads?lead=${leadId}`);
    else if (step.target === "advance") void advance();
    else if (step.target === "win") startWin();
    else if (step.target === "reopen") startStageChange();
    else setEditing(true);
  };
  const stageChip = status === "won" ? <Badge tone="success">{t("Won")}</Badge> : status === "lost" ? <Badge tone="danger">{t("Lost")}</Badge>
    : closed ? <Badge>{label(status)}</Badge> : <Badge>{String(live.stageName ?? t("Not set"))}</Badge>;
  const menu = [
    ...(!closed ? [{ id: "lost", label: t("Mark as lost"), tone: "danger" as const }] : [{ id: "reopen", label: t("Reopen") }]),
    ...(!closed && earlierStages.length ? [{ id: "stage", label: t("Change stage") }] : []),
    { id: "history", label: t("History") },
  ];
  const onMenu = (id: string) => { if (id === "lost") startOutcome("lost"); else if (id === "history") setHistoryOpen(true); else startStageChange(); };
  const pathChoice = FURNITURE_PATHS.find((item) => item.id === flow?.furniture?.path);
  const proof = flow?.proofs?.[0];
  const shortDay = (at: string) => dateText(at, { locale, timeZone });
  return <div className={`${styles.workbench} ${screen.opportunity}`}><ResourceState {...resource} retry={resource.refresh} />
    <header className={screen.header}>
      <div className={screen.identity}>
        <h2>{String(live.title ?? t("Opportunity"))}</h2>
        <p className={screen.meta}>
          {partyId ? <Link href={`/workspace/crm/customers?record=${partyId}`}>{String(live.partyName ?? t("Customer"))}</Link> : <span>{String(live.partyName ?? t("Customer not set"))}</span>}
          <span className={screen.value} data-empty={!hasValue || undefined}>{value}</span>
          {live.reference ? <span>{String(live.reference)}</span> : null}
        </p>
      </div>
      <div className={screen.headerActions}>
        {owner ? <span className={screen.owner} title={owner.label}><Avatar name={owner.label} seed={owner.id} size="sm" /></span> : null}
        {stageChip}
        <Button size="compact" isDisabled={!resource.data} onPress={() => setEditing(true)}><Pencil aria-hidden="true" size={14} />{t("Edit")}</Button>
        <IconMenuButton ariaLabel={t("More actions")} items={resource.data ? menu : []} onAction={onMenu} />
      </div>
    </header>
    {outcomeMismatch ? <p className={styles.opportunityWarning} role="status">{t("This record is in the {stage} stage but its status is {status}. Review and confirm the outcome.", { stage: String(currentStage?.name), status: label(status) })}</p> : null}
    {caseError ? <Callout title={t("Could not open Planning")} tone="warning">{caseError}</Callout> : null}
    {flowError ? <Callout title={t("Could not update the opportunity")} tone="warning">{flowError}</Callout> : null}
    {flow ? <ProgressLine flow={flow} status={status} history={stageHistory} /> : null}
    {resource.data ? <NowCard plan={plan} owner={owner} people={owners} due={followUp} busy={advancing || openingCase} onAct={act} onReassign={(membershipId) => patch({ ownerMembershipId: membershipId })} /> : null}
    <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))} items={[
      { id: "details", label: t("Details"), panel: <div className={screen.details}>
        <EditableFieldList className={screen.facts}>
          {live.amount === undefined || !resource.data ? <FactRow label={t("Value")}>{value}</FactRow>
            : <EditableField currency={valueCurrency} display={hasValue ? value : undefined} kind="money" label={t("Value")} onReload={resource.refresh}
              onSave={(next) => patch(next ? { amount: Number(next), currencyCode: valueCurrency } : { amount: null, currencyCode: null })} placeholder={t("Not set")}
              value={live.amount === null || live.amount === undefined ? "" : String(live.amount)} />}
          <EditableField canEdit={Boolean(resource.data)} display={closeDate ? dateText(live.expectedCloseAt ?? live.expected_close_at, { locale, timeZone }) : undefined} kind="date" label={t("Expected close")} onReload={resource.refresh}
            onSave={(date) => patch({ expectedCloseAt: date ? new Date(`${date}T12:00:00`).toISOString() : null })} placeholder={t("Not set")} value={closeDate} />
          <FactRow label={t("Next follow-up")}>{dateText(followUp, { locale, timeZone })}</FactRow>
          {flow?.enquiryType ? <FactRow label={t("Enquiry type")}>{flow.enquiryType}</FactRow> : null}
          {leadId ? <FactRow label={t("Enquiry")} action={<Link className={screen.factLink} href={`/workspace/crm/leads?lead=${leadId}`}>{t("Open enquiry")}</Link>}>{funnel.find((step) => step.key === "enquiry")?.detail ?? t("Linked")}</FactRow> : null}
          <FactRow label={t("Planning")} action={caseId ? <Link className={screen.factLink} href={caseLink("overview")}>{t("Open in Planning")}</Link>
            : <Button size="compact" variant="quiet" isLoading={openingCase} isDisabled={!resource.data || closed && status !== "won"} onPress={() => void openCase()}>{t("Start Planning")}</Button>}>{caseId ? t("Started") : t("Not started")}</FactRow>
          {flow?.furniture ? <FactRow label={t("Furniture sub-path")} action={!closed ? <Button size="compact" variant="quiet" onPress={() => setFurnitureOpen(true)}>{pathChoice ? t("Change") : t("Choose")}</Button> : null}>
            {pathChoice ? `${pathChoice.letter} · ${t(pathChoice.label)}` : t("Not set")}</FactRow> : null}
          {flow?.furniture?.feasibility ? <FactRow label={t("Feasibility")}>{t("Confirmed · {date}", { date: shortDay(flow.furniture.feasibility.at) })}</FactRow> : null}
          {flow?.flow === "furniture" && !closed ? <FactRow label={t("Client approved on the spot")}>
            <Switch aria-label={t("Client approved on the spot")} isSelected={Boolean(flow.clientApproval)} onChange={(next) => { void saveFlow({ clientApproved: next }).catch((error) => setFlowError(error instanceof Error ? error.message : t("Could not save."))); }}>{flow.clientApproval ? t("Yes") : t("No")}</Switch>
          </FactRow> : null}
          {proof ? <FactRow label={t("Payment proof")}><a className={screen.factLink} href={proofHref(workspaceId, row.id, proof.id)} target="_blank" rel="noopener noreferrer">{t("Attached · {date}", { date: shortDay(proof.recordedAt) })}</a></FactRow> : null}
        </EditableFieldList>
        {showDiscovery ? <OpportunityDiscovery workspaceId={workspaceId} opportunityId={row.id} locale={locale} onSaved={saved} /> : null}
        {showIntro ? <OpportunityIntro workspaceId={workspaceId} opportunityId={row.id} locale={locale} onSaved={saved} startBooking={bookIntro} onBookingStarted={() => setBookIntro(false)} /> : null}
      </div> },
      { id: "activity", label: t("Activity"), panel: <ActivityPanel workspaceId={workspaceId} opportunityId={row.id} partyId={partyId || undefined} ownerMembershipId={ownerId || undefined} onChanged={saved} /> },
      { id: "files", label: t("Files"), panel: leadId ? <RecordAttachments workspaceId={workspaceId} leadId={String(leadId)} /> : <EmptyState illustration="upload" title={t("No enquiry files")} description={t("Project files live in Planning.")} /> },
    ]} />{action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={saved} /> : null}
    {proofOpen ? <PaymentProofDialog workspaceId={workspaceId} opportunityId={row.id} loadVersion={freshVersion} onClose={() => setProofOpen(false)} onWon={saved}
      onBlocked={(items) => setBlocked({ stage: String(wonStage?.name ?? t("Won")), items })} /> : null}
    {furnitureOpen && flow?.furniture ? <FurniturePathDialog flow={flow.furniture} onClose={() => setFurnitureOpen(false)} onSave={saveFlow} /> : null}
    {blocked ? <StageBlockedSheet stageName={blocked.stage} items={blocked.items} onAction={act} onClose={() => setBlocked(null)} /> : null}
    {historyOpen ? <ControlledModalDialog isOpen size="md" title={t("History")} onOpenChange={setHistoryOpen}>
      {stageHistory.length ? <ol className={screen.history}>{stageHistory.map((entry, index) => <li key={entry.id ?? index}>
        <strong>{entry.fromStageName ?? t("Start")}<ArrowRight aria-hidden="true" size={12} />{entry.toStatus === "won" ? t("Won") : entry.toStatus === "lost" ? t("Lost") : entry.toStageName ?? t("Not set")}</strong>
        <small>{[entry.changedByName, entry.changedAt ? shortDay(entry.changedAt) : null, entry.reason].filter(Boolean).join(" · ")}</small>
      </li>)}</ol> : <p className={styles.empty}>{t("No changes yet.")}</p>}
    </ControlledModalDialog> : null}
    {editing ? <OpportunityEditDialog workspaceId={workspaceId} opportunity={{ ...live, version: Math.max(Number(live.version ?? 0), savedVersion) }} members={owners} onClose={() => setEditing(false)} onSaved={saved} /> : null}</div>;
}

function ActivityWorkbench({ workspaceId, row, onChanged }: { workspaceId: string; row: RecordData; onChanged: () => Promise<void> }) {
  const t = useT();
  const [action, setAction] = useState<ActionSpec | null>(null);
  return <div className={styles.workbench}><h3>{String(row.title)}</h3><FactList facts={[[t("Type"), label(row.type)], [t("Status"), label(row.status)], [t("Sales owner"), String(row.ownerName ?? t("Unassigned"))], [t("Due"), dateText(row.dueAt)], [t("Notes"), String(row.description ?? t("No notes"))]]} />{row.status === "pending" ? <div className={styles.actions}><Button size="compact" onPress={() => setAction({ title: t("Edit activity"), path: `activities/${row.id}`, method: "PATCH", initial: { version: row.version, title: row.title, description: row.description }, fields: [{ key: "title", label: t("Title"), required: true }, { key: "dueAt", label: t("Reschedule"), type: "datetime-local" }, { key: "description", label: t("Notes"), type: "textarea" }] })}>{t("Edit")}</Button><Button size="compact" variant="primary" onPress={() => setAction({ title: t("Complete activity"), path: `activities/${row.id}/complete`, initial: { version: row.version }, fields: [{ key: "outcome", label: t("Outcome"), required: true }], submit: t("Complete") })}>{t("Complete")}</Button></div> : null}{row.leadId ? <a className={styles.link} href={`/workspace/crm/leads?lead=${row.leadId}`}>{t("Open enquiry")}</a> : null}{row.opportunityId ? <a className={styles.link} href={`/workspace/crm/opportunities?record=${row.opportunityId}`}>{t("Open opportunity")}</a> : null}{action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={onChanged} /> : null}</div>;
}

function ConversationWorkbench({ workspaceId, row, onChanged }: { workspaceId: string; row: RecordData; onChanged: () => Promise<void> }) {
  const t = useT();
  const resource = useCrmResource<RecordData>(workspaceId, `conversations/${row.id}`);
  const templates = useCrmResource<unknown>(workspaceId, "notification-templates");
  const [action, setAction] = useState<ActionSpec | null>(null);
  const live = { ...row, ...resource.data };
  const saved = async () => { resource.refresh(); await onChanged(); };
  return <div className={styles.workbench}><ResourceState {...resource} retry={resource.refresh} /><div className={styles.toolbar}><h3>{String(live.subject ?? t("Conversation"))}</h3><Button size="compact" onPress={() => setAction({ title: t("Mark conversation read"), path: `conversations/${row.id}/read`, fields: [], submit: t("Mark read") })}>{t("Mark read")}</Button></div><div className={styles.stack}>{((live.messages ?? []) as RecordData[]).map((message) => <div className={styles.message} data-direction={message.direction} key={message.id}><small>{message.direction === "internal" ? t("Private team note · Not sent to customer") : label(message.direction)} · {label(message.status)} · {dateText(message.createdAt)}</small>{String(message.bodyText ?? t("Message has no text preview"))}{message.failureCode ? <small>{String(message.failureCode)}</small> : null}</div>)}</div><div className={styles.actions}><Button size="compact" onPress={() => setAction({ title: t("Add private team note"), description: t("Only your team can see this. It is never sent to the customer."), path: `conversations/${row.id}/messages`, initial: { direction: "internal" }, fields: [{ key: "bodyText", label: t("Private team note"), type: "textarea", required: true }] })}>{t("Private team note")}</Button><Button size="compact" onPress={() => setAction({ title: t("Send message"), description: t("Delivery depends on the connected channel and the customer’s communication preferences."), path: `conversations/${row.id}/messages`, initial: { direction: "outbound", purpose: "service" }, fields: [{ key: "purpose", label: t("Purpose"), options: choice(["service", "marketing"]), required: true }, { key: "templateId", label: t("Approved template"), options: options(rows(templates.data)), required: live.channel === "whatsapp" }, { key: "bodyText", label: t("Message"), type: "textarea", required: true }], submit: t("Queue message") })}>{t("Compose")}</Button></div>{action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={saved} /> : null}</div>;
}

function AutomationWorkbench({ kind, workspaceId, row, onChanged }: { kind: "sequences" | "automations"; workspaceId: string; row: RecordData; onChanged: () => Promise<void> }) {
  const t = useT();
  const resource = useCrmResource<unknown>(workspaceId, kind === "sequences" ? `sequences/${row.id}/enrollments` : `automation-runs?definitionId=${row.id}`);
  const customers = useCrmResource<unknown>(workspaceId, kind === "sequences" ? "parties?limit=100" : null);
  const [action, setAction] = useState<ActionSpec | null>(null);
  const [validation, setValidation] = useState<RecordData | null>(null);
  const [failure, setFailure] = useState("");
  const [checking, setChecking] = useState(false);
  return <div className={styles.workbench}><h3>{String(row.name)}</h3><p>{String(row.description ?? t("Follow-up sequence"))}</p><Badge tone="neutral">{label(row.status)}</Badge>
    {kind === "sequences" ? <SequenceEditor workspaceId={workspaceId} row={row} onChanged={onChanged} /> : <Button size="compact" isLoading={checking} onPress={async () => { setChecking(true); setFailure(""); try { setValidation(await crmRequest(workspaceId, `automations/${row.id}/validate`, "POST")); } catch (error) { setFailure((error as Error).message); } finally { setChecking(false); } }}>{t("Validate workflow")}</Button>}
    {validation ? <div className={styles.notice}><p>{validation.valid ? t("Workflow validation passed.") : t("This workflow needs corrections before publishing.")}</p>{((validation.definition as Record<string, unknown> | undefined)?.nodes as RecordData[] | undefined)?.map((node, i) => <p key={String(node.key) + i}>{i + 1}. {label(node.type)}</p>)}{Array.isArray(validation.errors) ? validation.errors.map((e, i) => <p key={i}>{typeof e === "string" ? e : JSON.stringify(e)}</p>) : null}</div> : null}
    {failure ? <p role="alert">{failure}</p> : null}
    <div className={styles.actions}><Button size="compact" isDisabled={kind === "automations" && row.status !== "active" && !validation?.valid} onPress={() => setAction({ title: row.status === "active" ? t("Pause workflow") : t("Publish workflow"), description: row.status === "active" ? t("Pause new automated work.") : t("Publishing enables this workflow for matching records."), path: `${kind}/${row.id}/${row.status === "active" ? "pause" : "publish"}`, initial: { version: row.version }, fields: [], submit: row.status === "active" ? t("Pause") : t("Publish") })}>{row.status === "active" ? t("Pause") : t("Publish")}</Button>{kind === "sequences" ? <Button size="compact" isDisabled={row.status !== "active"} onPress={() => setAction({ title: t("Enroll customer"), path: `sequences/${row.id}/enrollments`, fields: [{ key: "partyId", label: t("Customer"), options: options(rows(customers.data), "displayName"), required: true }] })}>{t("Enroll customer")}</Button> : null}</div>
    <h3>{kind === "sequences" ? t("Enrollments") : t("Run history")}</h3><ResourceState {...resource} retry={resource.refresh} />{rows(resource.data).map((run) => <div className={styles.row} key={run.id}><div><strong>{String(run.partyName ?? label(run.status))}</strong><small>{dateText(run.startedAt ?? run.enrolledAt ?? run.createdAt)}{run.failureMessage ? ` · ${run.failureMessage}` : ""}</small></div>{kind === "sequences" && run.status === "active" ? <Button size="compact" onPress={() => setAction({ title: t("Stop enrollment"), path: `sequence-enrollments/${run.id}/stop`, initial: { version: run.version }, fields: [{ key: "reason", label: t("Reason"), required: true }], submit: t("Stop enrollment") })}>{t("Stop")}</Button> : <Badge tone="neutral">{label(run.status)}</Badge>}</div>)}
    {action ? <ActionDialog workspaceId={workspaceId} action={action} onClose={() => setAction(null)} onSaved={async () => { resource.refresh(); await onChanged(); }} /> : null}
  </div>;
}

export function CrmCreateDialog({ id, workspaceId, onClose, onSaved, initialValues, defaultCurrency }: { defaultCurrency?: string; initialValues?: Record<string, unknown>; id: CrmScreenId; workspaceId: string; onClose: () => void; onSaved: (result?: RecordData) => Promise<void> }) {
  const t = useT();
  const { currency: regionCurrency } = useDesignSystem();
  const aiReady = useAiReady(id === "customers" || id === "organizations" ? workspaceId : null);
  const customers = useCrmResource<unknown>(workspaceId, ["opportunities", "activities", "conversations"].includes(id) ? "parties?limit=100" : null);
  const pipelines = useCrmResource<unknown>(workspaceId, id === "opportunities" ? "pipelines" : null);
  const members = useCrmResource<unknown>(workspaceId, ["opportunities", "activities"].includes(id) ? "sales-owners" : null);
  const partyField: FieldSpec = { key: "partyId", label: t("Customer"), options: options(rows(customers.data), "displayName"), required: true };
  const ownerField: FieldSpec = { key: "ownerMembershipId", label: t("Sales owner"), options: options(rows(members.data), "displayName"), required: true };
  let action: ActionSpec;
  if (id === "customers" || id === "organizations") action = { title: id === "customers" ? t("Add client") : t("Create company"), path: "parties", initial: { type: id === "customers" ? "person" : "organization" },
    fields: [...(id === "customers" ? [{ key: "type", label: t("Record type"), options: choice(["person", "organization"]), required: true }] : []), { key: "displayName", label: t("Name"), required: true }, { key: "phone", label: t("Phone"), type: "phone" }, { key: "email", label: t("Email"), type: "email" }],
    transform: ({ email, phone, ...v }) => ({ ...v, contacts: [...(email ? [{ type: "email", value: email, isPrimary: true }] : []), ...(phone ? [{ type: "phone", value: phone, isPrimary: true }] : [])] }),
    // Someone may already be a client: said under the phone and the email as they're typed.
    notice: (key, values) => key === "phone" || key === "email" ? <ContactMatchNotice workspaceId={workspaceId} {...(key === "phone" ? { phone: String(values.phone ?? "") } : { email: String(values.email ?? "") })} /> : null,
    lead: (_values, set) => aiReady ? <FillWithWoddy fields={[{ key: "name", label: t("Name") }, { key: "phone", label: t("Phone") }, { key: "email", label: t("Email") }]}
      onApply={(found) => set({ ...(found.name ? { displayName: found.name } : {}), ...(found.phone ? { phone: found.phone.replace(/[\s().-]/g, "") } : {}), ...(found.email ? { email: found.email } : {}) })}
      onExtract={async ({ text, image }) => fillWithWoddy(workspaceId, "client", { ...(text ? { text } : {}), ...(image ? { image: await imageForWoddy(image) } : {}) })} /> : null };
  else if (id === "opportunities") action = { title: t("Create opportunity"), path: "opportunities", initial: initialValues, fields: [partyField, { key: "title", label: t("Title"), required: true }, ownerField, { key: "pipelineId", label: t("Pipeline"), options: options(rows(pipelines.data).filter((p) => p.status === "active")), required: true }, { key: "amount", label: t("Value"), type: "money", min: 0, more: true }, { key: "nextActionAt", label: t("Next follow-up"), type: "datetime-local", required: true }], transform: (v) => ({ ...v, ...(initialValues?.stageId && v.pipelineId !== initialValues.pipelineId ? { stageId: undefined } : {}), ...(v.amount !== undefined && v.amount !== "" ? { amount: Number(v.amount), currencyCode: defaultCurrency ?? regionCurrency } : {}) }) };
  else if (id === "activities") action = { title: t("Create activity"), path: "activities", fields: [partyField, { key: "type", label: t("Type"), options: choice(["task", "call", "meeting", "note"]), required: true }, { key: "title", label: t("Title"), required: true }, ownerField, { key: "dueAt", label: t("Due"), type: "datetime-local" }, { key: "description", label: t("Notes"), type: "textarea" }] };
  else if (id === "conversations") action = { title: t("Start conversation"), path: "conversations", fields: [partyField, { key: "channel", label: t("Channel"), options: choice(["whatsapp", "email", "phone", "internal"]), required: true }, { key: "subject", label: t("Subject"), required: true }] };
  else if (id === "sequences") action = { title: t("Create follow-up sequence"), description: t("Start with a task reminder. Customer replies stop outreach."), path: "sequences", fields: [{ key: "name", label: t("Name"), required: true }, { key: "taskTitle", label: t("Follow-up task"), required: true }, { key: "delayMinutes", label: t("Wait (minutes)"), type: "number", min: 0, required: true }], transform: (v) => ({ name: v.name, exitConditions: { customerReply: true, opportunityClosed: true }, steps: [{ type: "task", delayMinutes: v.delayMinutes, configuration: { title: v.taskTitle } }] }) };
  else action = { title: t("Create automation"), description: t("Create a draft workflow, then validate it before publishing."), path: "automations", fields: [{ key: "name", label: t("Name"), required: true }, { key: "code", label: t("Unique code"), required: true }, { key: "event", label: t("When"), options: [{ id: "crm.enquiry.ready.v1", label: t("New enquiry is ready") }, { id: "crm.customer.replied.v1", label: t("Customer replies") }, { id: "crm.sla.breached.v1", label: t("Response SLA breached") }], required: true }, { key: "taskTitle", label: t("Create task"), required: true }], transform: (v) => ({ name: v.name, code: v.code, definition: { nodes: [{ key: "start", type: "trigger", configuration: { eventTypes: [v.event] } }, { key: "follow_up", type: "create_task", configuration: { title: v.taskTitle, priority: "normal", delayMinutes: 0, isNextAction: true } }, { key: "end", type: "end", configuration: {} }], edges: [{ from: "start", to: "follow_up" }, { from: "follow_up", to: "end" }] } }) };
  return <ActionDialog workspaceId={workspaceId} action={action} onClose={onClose} onSaved={onSaved} />;
}
