"use client";

import { useId, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Mail, MessageCircle, Pencil, Phone } from "lucide-react";
import { Badge, Button, EditableFieldList, FactRow, Skeleton, Switch, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { dateText, label, rows, type RecordData } from "@/lib/crm/client";
import { activityTitle } from "@/lib/crm/contact";
import { FURNITURE_PATHS, type OpportunityFlowView } from "@/lib/crm/opportunity-flow";
import type { FactGroup } from "@/lib/crm/now-step";
import { formatPhoneForDisplay, phoneCountry, whatsappUrl } from "@/lib/phone";
import { useCrmResource } from "./crm-workbench";
import { answered, formatMoney, type Discovery, type DiscoveryGroup } from "./opportunity-discovery";
import { OpportunityIntro, type Intro } from "./opportunity-intro";
import styles from "./opportunity-sections.module.css";

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
  bookIntro: boolean; onBookingStarted: () => void; onIntroBlocked: () => void;
};

/** The opportunity's facts in groups: Client · Property · Design package · Intro questions · Intro meeting · Supply. */
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
      {view ? <EditableFieldList>
        <FactRow label={t("Enquiry type")}>{enquiryType ? label(enquiryType) : <Missing />}</FactRow>
        <FactRow label={t("Client type")}>{clientType ? label(clientType) : <Missing />}</FactRow>
      </EditableFieldList> : loading}
    </FactCard>
    <FactCard id="property" title={t("Property")} open={isOpen("property")} onToggle={() => onToggle("property")} action={edit("property")} {...(view ? count(property.filter(Boolean).length, property.length) : {})}>
      {facts ? <EditableFieldList>
        <FactRow label={t("Floor plan")}>{floorPlan ? floorPlan.name : <Missing />}</FactRow>
        <FactRow label={t("Area")}>{area ?? <Missing />}</FactRow>
        {facts.spaces ? <FactRow label={t("Spaces")}>{String(facts.spaces)}</FactRow> : null}
        <FactRow label={t("Property location")}>{facts.propertyLocation || <Missing />}</FactRow>
        <FactRow label={t("Client email")}>{facts.clientEmail || <Missing />}</FactRow>
      </EditableFieldList> : discovery.failure ? <p className={styles.missing}>{discovery.failure}</p> : loading}
    </FactCard>
    {props.showPackage ? <FactCard id="package" title={t("Design package")} open={isOpen("package")} onToggle={() => onToggle("package")} action={edit("package")} {...(view ? count(view.package ? 1 : 0, 1) : {})}>
      {view ? <EditableFieldList>
        <FactRow label={t("Package")}>{view.package?.name ?? <Missing />}</FactRow>
        <FactRow label={t("Design fee")}>{view.designFee ? formatMoney(view.designFee.amount, view.designFee.currency, locale) : <span className={styles.missing}>{t("Not priced yet")}</span>}</FactRow>
      </EditableFieldList> : loading}
    </FactCard> : null}
    {questions.length ? <FactCard id="questions" title={t("Intro questions")} open={isOpen("questions")} onToggle={() => onToggle("questions")} action={edit("questions")}
      {...count(questions.filter((question) => answered(view?.answers[question.key])).length, questions.length)}>
      <EditableFieldList>{questions.map((question) => {
        const value = view?.answers[question.key];
        return <FactRow key={question.key} label={question.label}>{answered(value) ? (typeof value === "boolean" ? (value ? t("Yes") : t("No")) : question.options?.find((option) => option.id === value)?.label ?? String(value)) : <Missing />}</FactRow>;
      })}</EditableFieldList>
    </FactCard> : null}
    {props.showIntro ? <FactCard id="intro" title={t("Intro meeting")} open={isOpen("intro")} onToggle={() => onToggle("intro")} {...(introStatus ?? {})}>
      <OpportunityIntro workspaceId={props.workspaceId} opportunityId={props.opportunityId} locale={locale} intro={props.intro} onSaved={props.onSaved}
        startBooking={props.bookIntro} onBookingStarted={props.onBookingStarted} onBlocked={props.onIntroBlocked} />
    </FactCard> : null}
    {flow?.furniture ? <FactCard id="supply" title={t("Supply")} open={isOpen("supply")} onToggle={() => onToggle("supply")} {...count([flow.furniture.path, flow.furniture.path !== "bespoke" || flow.furniture.feasibility].filter(Boolean).length, 2)}
      action={!closed ? <Button size="compact" variant="quiet" onPress={props.onFurniture}><Pencil aria-hidden="true" size={13} />{pathChoice ? t("Change") : t("Choose")}</Button> : null}>
      <EditableFieldList>
        <FactRow label={t("Furniture sub-path")}>{pathChoice ? `${pathChoice.letter} · ${t(pathChoice.label)}` : <Missing />}</FactRow>
        {flow.furniture.feasibility ? <FactRow label={t("Feasibility")}>{t("Confirmed · {date}", { date: dateText(flow.furniture.feasibility.at, { locale }) })}</FactRow> : null}
        {flow.flow === "furniture" && !closed ? <FactRow label={t("Client approved on the spot")}>
          <Switch aria-label={t("Client approved on the spot")} isSelected={Boolean(flow.clientApproval)} onChange={props.onClientApproval}>{flow.clientApproval ? t("Yes") : t("No")}</Switch>
        </FactRow> : null}
      </EditableFieldList>
    </FactCard> : null}
  </div>;
}

/** A sidebar group: a small heading, an optional action, and its content. */
export function SideSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const id = useId();
  return <section className={styles.sideSection} aria-labelledby={id}>
    <header><h4 id={id}>{title}</h4>{action}</header>
    {children}
  </section>;
}

type Contact = { type?: string; value?: string; rawValue?: string; countryCode?: string; isPrimary?: boolean; status?: string };

/** The client's name, phone (call or WhatsApp) and email. */
export function ClientContact({ workspaceId, partyId, partyName }: { workspaceId: string; partyId: string; partyName: string }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const party = useCrmResource<RecordData>(workspaceId, partyId ? `parties/${partyId}` : null);
  const contacts = ((party.data?.contacts ?? []) as Contact[]).filter((contact) => contact.status !== "archived");
  const primary = (type: string) => contacts.find((contact) => contact.type === type && contact.isPrimary) ?? contacts.find((contact) => contact.type === type);
  const phone = primary("phone");
  const email = primary("email");
  const number = phone ? String(phone.rawValue ?? phone.value ?? "") : "";
  const country = phoneCountry(phone?.countryCode, locale);
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
      {email?.value ? <li>
        <span className={styles.value}>{email.value}</span>
        <span className={styles.contactActions}><a className={styles.iconLink} href={`mailto:${email.value}`} aria-label={t("Email")}><Mail aria-hidden="true" size={14} /></a></span>
      </li> : null}
      {party.data && !number && !email?.value ? <li className={styles.missing}>{t("No phone or email")}</li> : null}
    </ul>
  </SideSection>;
}

/** The last three things that happened; See all opens the Activity tab. */
export function LatestActivity({ workspaceId, opportunityId, onSeeAll }: { workspaceId: string; opportunityId: string; onSeeAll: () => void }) {
  const t = useT();
  const zoned = useDesignSystem();
  const resource = useCrmResource<unknown>(workspaceId, `activities?${new URLSearchParams({ limit: "3", opportunityId })}`);
  const items = rows(resource.data).slice(0, 3);
  return <SideSection title={t("Latest activity")} action={<Button size="compact" variant="quiet" onPress={onSeeAll}>{t("See all")}</Button>}>
    {resource.loading ? <Skeleton lines={3} /> : items.length ? <ul className={styles.activity}>{items.map((item) => <li key={item.id}>
      <span className={styles.value}>{activityTitle(item, t)}</span>
      <small>{dateText(item.completedAt ?? item.createdAt ?? item.dueAt, zoned)}</small>
    </li>)}</ul> : <p className={styles.missing}>{t("No activity yet")}</p>}
  </SideSection>;
}
