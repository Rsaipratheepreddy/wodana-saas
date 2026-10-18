"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, Check, ChevronDown, Circle, CircleCheck, Mail, MessageCircle, Pencil, Phone, Plus } from "lucide-react";
import { Badge, Button, EditableFieldList, FactRow, Skeleton, Switch, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { dateText, label, type RecordData } from "@/lib/crm/client";
import { clientContactFacts, type ContactPoint, type EnquiryContact } from "@/lib/crm/client-contact";
import { activityTitle } from "@/lib/crm/contact";
import { flowCapabilities, FURNITURE_PATHS, type OpportunityFlowView } from "@/lib/crm/opportunity-flow";
import type { FactGroup } from "@/lib/crm/now-step";
import { formatPhoneForDisplay, phoneCountry, whatsappUrl } from "@/lib/phone";
import { SiteLocation } from "@/components/ui/site-location";
import { ResourceState, useCrmResource } from "./crm-workbench";
import { answered, formatMoney, type Discovery, type DiscoveryGroup } from "./opportunity-discovery";
import { OpportunityIntro, type Intro, type IntroView } from "./opportunity-intro";
import { SideSection } from "./record/record-layout";
import styles from "./opportunity-sections.module.css";
import { OpportunityClosing, OpportunityProposals } from "./opportunity-proposals";
import { DealFulfilmentCard } from "./deal-fulfilment";

/** A group of facts: its title, how complete it is, Edit, and the facts as label and value; folds away. */
export function FactCard({ id, title, status, tone = "neutral", open, onToggle, action, children }: {
  id: string; title: string; status?: string | null; tone?: "neutral" | "success" | "info"; open: boolean; onToggle: () => void; action?: ReactNode; children: ReactNode;
}) {
  const body = useId();
  return <section className={styles.card} data-open={open || undefined} aria-labelledby={`${body}-title`} id={`card-${id}`}>
    <header className={styles.cardHead}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={body} onClick={onToggle}>
        <ChevronDown aria-hidden="true" size={14} />
        <h4 id={`${body}-title`}>{title}</h4>
        {status ? <Badge tone={tone}>{status}</Badge> : null}
      </button>
      {action}
    </header>
    <div className={styles.cardBody} id={body} hidden={!open}>{children}</div>
  </section>;
}

function Missing() {
  const t = useT();
  return <span className={styles.missing}>{t("Not added")}</span>;
}

export type CardsProps = {
  workspaceId: string; opportunityId: string; locale?: string; leadId: string | null; closed: boolean;
  flow: OpportunityFlowView | null; discovery: Discovery; intro: Intro;
  showIntro: boolean; showPackage: boolean;
  /** Whether a card is unfolded. */
  isOpen: (id: FactGroup) => boolean; onToggle: (id: FactGroup) => void;
  onEdit: (group: DiscoveryGroup) => void; onFurniture: () => void; onSaved: () => Promise<void>;
  onClientApproval: (approved: boolean) => void;
  bookIntro: boolean; onBookingStarted: () => void; onIntroBlocked: (blockers: IntroView["blockers"]) => void;
  /** When the meeting is booked, allows marking it complete. */
  onCompleteIntro?: () => void;
  /** PLM-103: the opportunity is Won (Proposal 2 can be a second Won with its own proof). */
  won?: boolean; onSecondProof?: () => void;
};

/** The opportunity's facts in groups (the sidebar's Details): Client · Property · Design package · Intro questions · Intro meeting · Supply; each label above its value. */
export function OpportunityCards(props: CardsProps) {
  const t = useT();
  const { discovery, flow, isOpen, onToggle, onEdit, closed, locale } = props;
  const view = discovery.view;
  const count = (done: number, total: number) => ({ status: t("{done} of {total}", { done, total }), tone: (done === total ? "success" : "neutral") as "success" | "neutral" });
  const edit = (group: DiscoveryGroup) => closed ? null : <Button size="compact" variant="quiet" onPress={() => onEdit(group)}><Pencil aria-hidden="true" size={13} />{t("Edit")}</Button>;
  const loading = <Skeleton lines={3} shape="facts" />;
  const facts = view?.facts;
  const floorPlan = view?.files.find((file) => file.id === facts?.floorPlanAssetId);
  const unit = facts?.areaUnit === "sqft" ? t("sq ft") : facts?.areaUnit === "sqm" ? t("sq m") : "";
  const area = facts?.area ? `${new Intl.NumberFormat(locale).format(Number(facts.area))} ${unit}`.trim() : null;
  const enquiryType = flow?.enquiryType ?? view?.enquiryType ?? null;
  const clientType = view?.clientType ?? null;
  const property = facts ? [facts.floorPlanAssetId, facts.area, facts.propertyLocation, facts.clientEmail] : [];
  const questions = view?.questions ?? [];
  const intro = props.intro.view?.intro ?? null;
  const introStatus = !props.intro.view ? null : intro?.status === "completed" ? { status: t("Held"), tone: "success" as const }
    : intro?.status === "pending" ? { status: t("Booked"), tone: "info" as const } : { status: t("Not booked"), tone: "neutral" as const };
  const pathChoice = FURNITURE_PATHS.find((item) => item.id === flow?.furniture?.path);
  return <div className={styles.cards}>
    <FactCard id="client" title={t("Client")} open={isOpen("client")} onToggle={() => onToggle("client")} {...(view ? count([enquiryType, clientType].filter(Boolean).length, 2) : {})}
      action={props.leadId ? <Link className={styles.link} href={`/workspace/crm/leads?lead=${props.leadId}`}>{t("Open enquiry")}</Link> : null}>
      {view ? <EditableFieldList layout="stacked">
        <FactRow label={t("Enquiry type")}>{enquiryType ? label(enquiryType) : <Missing />}</FactRow>
        <FactRow label={t("Client type")}>{clientType ? label(clientType) : <Missing />}</FactRow>
      </EditableFieldList> : loading}
    </FactCard>
    <FactCard id="property" title={t("Property")} open={isOpen("property")} onToggle={() => onToggle("property")} action={edit("property")} {...(view ? count(property.filter(Boolean).length, property.length) : {})}>
      {facts ? <EditableFieldList layout="stacked">
        <FactRow label={t("Floor plan")}>{floorPlan ? floorPlan.name : <Missing />}</FactRow>
        <FactRow label={t("Area")}>{area ?? <Missing />}</FactRow>
        {facts.spaces ? <FactRow label={t("Spaces")}>{String(facts.spaces)}</FactRow> : null}
        <FactRow label={t("Property location")}><SiteLocation address={facts.propertyLocation} latitude={facts.latitude} longitude={facts.longitude} fallback={<Missing />} /></FactRow>
        <FactRow label={t("Client email")}>{facts.clientEmail || <Missing />}</FactRow>
      </EditableFieldList> : discovery.failure ? <p className={styles.missing}>{discovery.failure}</p> : loading}
    </FactCard>
    {props.showPackage ? <FactCard id="package" title={t("Design package")} open={isOpen("package")} onToggle={() => onToggle("package")} action={edit("package")} {...(view ? count(view.package ? 1 : 0, 1) : {})}>
      {view ? <EditableFieldList layout="stacked">
        <FactRow label={t("Package")}>{view.package?.name ?? <Missing />}</FactRow>
        <FactRow label={t("Design fee")}>{view.designFee ? formatMoney(view.designFee.amount, view.designFee.currency, locale) : <span className={styles.missing}>{t("Not priced yet")}</span>}</FactRow>
      </EditableFieldList> : loading}
    </FactCard> : null}
    {questions.length ? <FactCard id="questions" title={t("Intro questions")} open={isOpen("questions")} onToggle={() => onToggle("questions")} action={edit("questions")}
      {...count(questions.filter((question) => answered(view?.answers[question.key])).length, questions.length)}>
      <EditableFieldList layout="stacked">{questions.map((question) => {
        const value = view?.answers[question.key];
        return <FactRow key={question.key} label={question.label}>{answered(value) ? (typeof value === "boolean" ? (value ? t("Yes") : t("No")) : question.options?.find((option) => option.id === value)?.label ?? String(value)) : <Missing />}</FactRow>;
      })}</EditableFieldList>
    </FactCard> : null}
    {props.showIntro ? <FactCard id="intro" title={t("Intro meeting")} open={isOpen("intro")} onToggle={() => onToggle("intro")} {...(introStatus ?? {})}>
      <OpportunityIntro workspaceId={props.workspaceId} opportunityId={props.opportunityId} locale={locale} intro={props.intro} onSaved={props.onSaved}
        startBooking={props.bookIntro} onBookingStarted={props.onBookingStarted} onBlocked={props.onIntroBlocked} onCompleteIntro={props.onCompleteIntro} />
    </FactCard> : null}
    {flow?.furniture ? <FactCard id="supply" title={t("Supply")} open={isOpen("supply")} onToggle={() => onToggle("supply")} {...count([flow.furniture.path, flow.furniture.path !== "bespoke" || flow.furniture.feasibility].filter(Boolean).length, 2)}
      action={!closed ? <Button size="compact" variant="quiet" onPress={props.onFurniture}><Pencil aria-hidden="true" size={13} />{pathChoice ? t("Change") : t("Choose")}</Button> : null}>
      <EditableFieldList layout="stacked">
        <FactRow label={t("Furniture sub-path")}>{pathChoice ? `${pathChoice.letter} · ${t(pathChoice.label)}` : <Missing />}</FactRow>
        {flow.furniture.feasibility ? <FactRow label={t("Feasibility")}>{t("Confirmed · {date}", { date: dateText(flow.furniture.feasibility.at, { locale }) })}</FactRow> : null}
        {flowCapabilities(flow).clientApprovalOnSpot && !closed ? <FactRow label={t("Client approved on the spot")}>
          <Switch aria-label={t("Client approved on the spot")} isSelected={Boolean(flow.clientApproval)} onChange={props.onClientApproval}>{flow.clientApproval ? t("Yes") : t("No")}</Switch>
        </FactRow> : null}
      </EditableFieldList>
    </FactCard> : null}
    {/* PLM-101 / PLM-103: each proposal's value, verified and locked through approvals; PLM-102: when the deal closes. */}
    <OpportunityProposals workspaceId={props.workspaceId} opportunityId={props.opportunityId} flow={flow} closed={closed && !props.won} won={Boolean(props.won)}
      open={isOpen("proposals")} onToggle={() => onToggle("proposals")} onChanged={props.onSaved} onSecondProof={props.onSecondProof} />
    {props.won ? <OpportunityClosing workspaceId={props.workspaceId} opportunityId={props.opportunityId} won open={isOpen("closing")} onToggle={() => onToggle("closing")} /> : null}
    {/* PLM-083 / PLM-126: the order's BOQ choice, and how a won order reaches the client on its path. */}
    {!closed || props.won ? <DealFulfilmentCard workspaceId={props.workspaceId} opportunityId={props.opportunityId} won={Boolean(props.won)} open={isOpen("fulfilment")}
      onToggle={() => onToggle("fulfilment")} /> : null}
  </div>;
}

export { SideSection };

/**
 * The client's name, phone (call or WhatsApp) and email: from the client record, else from the enquiry the deal came
 * from (B09: an enquiry made from an email chat keeps its contact there while its client record holds none).
 */
export function ClientContact({ workspaceId, partyId, partyName, enquiryContact }: {
  workspaceId: string; partyId: string; partyName: string; enquiryContact?: EnquiryContact | null;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const party = useCrmResource<RecordData>(workspaceId, partyId ? `parties/${partyId}` : null);
  const { phone: number, countryCode, email } = clientContactFacts(party.data?.contacts as ContactPoint[] | undefined, enquiryContact);
  const country = phoneCountry(countryCode, locale);
  const whatsapp = number ? whatsappUrl(number, country) : null;
  return <SideSection title={t("Client contact")}>
    <ul className={styles.contact}>
      <li>{partyId ? <Link className={styles.name} href={`/workspace/crm/customers?record=${partyId}`}>{partyName}</Link> : <span className={styles.name}>{partyName}</span>}</li>
      {number ? <li>
        <span className={styles.value} dir="ltr">{formatPhoneForDisplay(number, country)}</span>
        <span className={styles.contactActions}>
          <a className={styles.iconLink} href={`tel:${number.replace(/[^\d+]/g, "")}`} aria-label={t("Call")}><Phone aria-hidden="true" size={14} /></a>
          {whatsapp ? <a className={styles.iconLink} href={whatsapp} target="_blank" rel="noreferrer" aria-label={t("WhatsApp")}><MessageCircle aria-hidden="true" size={14} /></a> : null}
        </span>
      </li> : null}
      {email ? <li>
        <span className={styles.value}>{email}</span>
        <span className={styles.contactActions}><a className={styles.iconLink} href={`mailto:${email}`} aria-label={t("Email")}><Mail aria-hidden="true" size={14} /></a></span>
      </li> : null}
      {party.data && !number && !email ? <li className={styles.missing}>{t("No phone or email")}</li> : null}
    </ul>
  </SideSection>;
}

const SHOWN = 6;

/** Pending first (soonest due first), then what happened, newest first. */
export function activityOrder(items: RecordData[]): RecordData[] {
  const at = (item: RecordData, keys: string[]) => Date.parse(String(keys.map((key) => item[key]).find((value) => typeof value === "string") ?? "")) || 0;
  const pending = items.filter((item) => item.status === "pending").sort((a, b) => (at(a, ["dueAt"]) || Infinity) - (at(b, ["dueAt"]) || Infinity));
  const rest = items.filter((item) => item.status !== "pending").sort((a, b) => at(b, ["completedAt", "createdAt", "dueAt"]) - at(a, ["completedAt", "createdAt", "dueAt"]));
  return [...pending, ...rest];
}

/** The opportunity's activity in the sidebar: Add activity, then the timeline; six rows, Show all for the rest. */
export function OpportunityActivity({ items, loading, failure, retry, onAdd, onReschedule, onComplete }: {
  items: RecordData[]; loading: boolean; failure: string; retry: () => void;
  onAdd?: () => void; onReschedule: (item: RecordData) => void; onComplete: (item: RecordData) => void;
}) {
  const t = useT();
  const zoned = useDesignSystem();
  const [all, setAll] = useState(false);
  const ordered = activityOrder(items);
  const shown = all ? ordered : ordered.slice(0, SHOWN);
  return <SideSection title={t("Activity")} action={onAdd ? <Button size="compact" variant="quiet" onPress={onAdd}><Plus aria-hidden="true" size={14} />{t("Add activity")}</Button> : null}>
    {failure ? <ResourceState loading={false} failure={failure} retry={retry} /> : loading && !items.length ? <Skeleton lines={3} />
      : shown.length ? <ul className={styles.activity}>{shown.map((item) => {
        const pending = item.status === "pending";
        const done = item.status === "completed";
        const when = pending ? item.dueAt : item.completedAt ?? item.createdAt ?? item.dueAt;
        return <li key={String(item.id)} data-status={String(item.status ?? "")}>
          <span className={styles.activityMark} aria-hidden="true">{done ? <CircleCheck size={14} /> : <Circle size={14} />}</span>
          <span className={styles.activityText}>
            <span className={styles.value}>{activityTitle(item, t)}</span>
            <small>{[label(item.type), label(item.status), dateText(when, zoned)].join(" · ")}</small>
            {pending ? <span className={styles.activityActions}>
              <Button size="compact" variant="quiet" onPress={() => onComplete(item)}><Check aria-hidden="true" size={13} />{t("Complete")}</Button>
              <Button size="compact" variant="quiet" onPress={() => onReschedule(item)}><CalendarClock aria-hidden="true" size={13} />{t("Reschedule")}</Button>
            </span> : null}
          </span>
        </li>;
      })}</ul> : <p className={styles.missing}>{t("No activity yet")}</p>}
    {ordered.length > SHOWN ? <span className={styles.showAll}><Button size="compact" variant="quiet" onPress={() => setAll((open) => !open)}>{all ? t("Show less") : t("Show all")}</Button></span> : null}
  </SideSection>;
}
