"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Check, Circle, CircleDot, FileText, Mail, MessageCircle, Minus, Phone } from "lucide-react";
import { Avatar, Badge, PersonChip as SharedPersonChip, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { whatsappUrl, countryForPhone } from "@/lib/phone";
import styles from "./record-parts.module.css";

/** One step of a record's journey: done, the one now, or still to come, with who does it and when. */
export type TimelineStep = {
  id: string; label: string; state: "done" | "current" | "upcoming" | "skipped" | "blocked";
  /** Shows the state line as a chip of this tone instead of plain text. */
  tone?: StatusTone;
  /** When it finished, or when it is planned, as the person reads it. */
  date?: string | null;
  /** A short state line ("2 days late", "3 of 5"). */
  detail?: string | null;
  /** Lateness, shown in the danger tone. */
  late?: string | null;
  people?: Array<{ id: string; name: string }>;
};

/**
 * The stages of a record as steps (✓ done · ● now · ○ next): side by side when there is room, one under the
 * other on a phone. Each step names its people (avatars) and its date. `layout="list"` keeps them one under
 * the other at every width (a full list opened from a compact summary).
 */
export function RecordTimeline({ label, steps, layout = "steps" }: { label: string; steps: TimelineStep[]; layout?: "steps" | "list" }) {
  const t = useT();
  if (!steps.length) return null;
  return <div className={styles.timelineFrame} data-many={steps.length > 6 || undefined} data-layout={layout === "list" ? "list" : undefined}><ol className={styles.timeline} aria-label={label} style={{ "--steps": steps.length } as CSSProperties}>
    {steps.map((step) => {
      const Mark = step.state === "done" ? Check : step.state === "current" ? CircleDot : step.state === "skipped" ? Minus : Circle;
      return <li key={step.id} data-state={step.state} aria-current={step.state === "current" ? "step" : undefined}>
        <span className={styles.mark} aria-hidden="true"><Mark size={step.state === "done" ? 12 : 14} strokeWidth={step.state === "done" ? 3 : 2} /></span>
        <span className={styles.stepBody}>
          <span className={styles.stepLabel} title={step.label}>{step.label}<span className="wd-visually-hidden"> · {step.state === "done" ? t("Done") : step.state === "current" ? t("Now") : step.state === "skipped" ? t("Skipped") : t("Not started")}</span></span>
          {step.date ? <span className={styles.stepDate}>{step.date}</span> : null}
          {step.late ? <span className={styles.stepLate}>{step.late}</span> : step.detail && step.tone ? <Badge tone={step.tone}>{step.detail}</Badge> : step.detail ? <span className={styles.stepDate}>{step.detail}</span> : null}
          {step.people?.length ? <span className={styles.stepPeople}>{step.people.map((person) => <span key={person.id} title={person.name}><Avatar name={person.name} seed={person.id} size="sm" /></span>)}</span> : null}
        </span>
      </li>;
    })}
  </ol></div>;
}

/** A person on the record: avatar, name, role, and the ways to reach them (call, WhatsApp, email) when known. */
export function PersonRow({ id, name, role, phone, email, extra }: { id: string; name: string; role?: string | null; phone?: string | null; email?: string | null; extra?: ReactNode }) {
  const t = useT();
  const dial = phone?.replace(/[^\d+*#,;]/g, "") ?? "";
  const chat = phone ? whatsappUrl(phone, countryForPhone(phone)) : null;
  return <li className={styles.person}>
    <span aria-hidden="true"><Avatar name={name} seed={id} size="sm" /></span>
    <span className={styles.personText}><span className={styles.personName}>{name}</span>{role ? <span className={styles.personRole}>{role}</span> : null}</span>
    <span className={styles.contact}>
      {extra}
      {dial ? <a className="wd-button wd-icon-button" data-variant="quiet" data-size="compact" href={`tel:${dial}`} aria-label={t("Call {name}", { name })} title={t("Call")}><Phone aria-hidden="true" size={14} /></a> : null}
      {chat ? <a className="wd-button wd-icon-button" data-variant="quiet" data-size="compact" href={chat} target="_blank" rel="noopener noreferrer" aria-label={t("WhatsApp {name}", { name })} title={t("WhatsApp")}><MessageCircle aria-hidden="true" size={14} /></a> : null}
      {email ? <a className="wd-button wd-icon-button" data-variant="quiet" data-size="compact" href={`mailto:${email}`} aria-label={t("Email {name}", { name })} title={t("Email")}><Mail aria-hidden="true" size={14} /></a> : null}
    </span>
  </li>;
}

/** A person inline (in the status strip or the next step): the shared person chip, its avatar seeded by the record's id for them. */
export function PersonChip({ id, name }: { id: string; name: string }) {
  return <SharedPersonChip person={name} seed={id} />;
}

/** The people on a record, one row each. `compact`: shorter rows, the ways to reach someone on hover or focus. */
export function PeopleList({ label, children, compact = false }: { label: string; children: ReactNode; compact?: boolean }) {
  return <ul className={styles.people} aria-label={label} data-compact={compact || undefined}>{children}</ul>;
}

export type Fact = { label: string; value: ReactNode; tone?: "danger" | "success" };

/** Label and value pairs; a fact without a value is left out, never shown as a dash. */
export function FactList({ facts }: { facts: Array<Fact | null | false | undefined> }) {
  const shown = facts.filter((fact): fact is Fact => Boolean(fact && fact.value !== null && fact.value !== undefined && fact.value !== ""));
  if (!shown.length) return null;
  return <dl className={styles.facts}>{shown.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd data-tone={fact.tone}>{fact.value}</dd></div>)}</dl>;
}

export type ActivityEntry = { id: string; text: string; meta?: string | null; at?: string | null };

/** What happened lately, newest first: the words, then who and when. */
export function ActivityList({ label, items }: { label: string; items: ActivityEntry[] }) {
  if (!items.length) return null;
  return <ol className={styles.activity} aria-label={label}>{items.map((item) => <li key={item.id}>
    <span className={styles.activityText} dir="auto">{item.text}</span>
    {item.meta || item.at ? <span className={styles.activityMeta}>{[item.meta, item.at].filter(Boolean).join(" · ")}</span> : null}
  </li>)}</ol>;
}

export type FileEntry = { id: string; name: string; meta?: string | null; href: string; download?: boolean };

/** A record's documents: each opens or downloads where it lives. */
export function FileList({ label, items }: { label: string; items: FileEntry[] }) {
  if (!items.length) return null;
  return <ul className={styles.files} aria-label={label}>{items.map((item) => <li key={item.id}>
    <FileText aria-hidden="true" size={16} />
    {item.download ? <a href={item.href} download>{item.name}</a> : <Link href={item.href}>{item.name}</Link>}
    {item.meta ? <span className={styles.fileMeta}>{item.meta}</span> : null}
  </li>)}</ul>;
}
