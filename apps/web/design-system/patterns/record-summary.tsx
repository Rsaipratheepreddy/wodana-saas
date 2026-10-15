"use client";

import type { ReactNode } from "react";
import { Ban, Check, CircleAlert, CircleDot, Clock, CornerUpLeft, LockKeyhole, Minus, type LucideIcon } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { Badge, type StatusTone } from "../components/status";

/**
 * A record's summary, the same on every overview: a strip of KPI tiles (the few numbers and states that matter),
 * then titled section cards (`Card`), with status shown as a `StateChip` and to-dos as a `CheckList`.
 */

export type KpiTone = "neutral" | "success" | "warning" | "danger" | "info";

/** The few numbers or states that matter for this record, as tiles: a row on a wide screen, two per row on a phone. */
export function KpiStrip({ label, children, tour }: { label: string; children: ReactNode; tour?: string }) {
  return <dl className="wd-kpi-strip" aria-label={label} data-tour={tour}>{children}</dl>;
}

/**
 * One tile: its label, the value, one optional detail line and a tone. With `href` (a section on the page, or its
 * list) or `onPress` the whole tile opens it.
 */
export function KpiTile({ label, value, detail, tone, icon, href, onPress }: {
  label: string; value: ReactNode; detail?: ReactNode; tone?: KpiTone; icon?: ReactNode; href?: string; onPress?: () => void;
}) {
  const shown = <span className="wd-kpi-tile-value">{value}</span>;
  return <div className="wd-kpi-tile" data-tone={tone && tone !== "neutral" ? tone : undefined} data-link={href || onPress ? "" : undefined}>
    <dt>{icon ? <span className="wd-kpi-tile-icon" aria-hidden="true">{icon}</span> : null}{label}</dt>
    <dd>
      {href ? <a className="wd-kpi-tile-target" href={href}>{shown}</a>
        : onPress ? <button className="wd-kpi-tile-target" type="button" onClick={onPress}>{shown}</button> : shown}
      {detail ? <span className="wd-kpi-tile-detail">{detail}</span> : null}
    </dd>
  </div>;
}

/** The states a requirement, step or check can be in; each has one word, one icon and one tone everywhere. */
export type ItemState = "done" | "missing" | "waiting" | "in_progress" | "not_applicable" | "upcoming" | "late" | "blocked" | "returned" | "rejected";

const STATES: Record<ItemState, { label: MessageKey; tone: StatusTone; icon: LucideIcon }> = {
  done: { label: tKey("Done"), tone: "success", icon: Check },
  missing: { label: tKey("Missing"), tone: "warning", icon: CircleAlert },
  waiting: { label: tKey("Waiting"), tone: "warning", icon: Clock },
  in_progress: { label: tKey("In progress"), tone: "info", icon: CircleDot },
  not_applicable: { label: tKey("Not applicable"), tone: "neutral", icon: Minus },
  upcoming: { label: tKey("Not started"), tone: "neutral", icon: CircleDot },
  late: { label: tKey("Late"), tone: "danger", icon: Clock },
  blocked: { label: tKey("Blocked"), tone: "danger", icon: LockKeyhole },
  returned: { label: tKey("Returned"), tone: "warning", icon: CornerUpLeft },
  rejected: { label: tKey("Rejected"), tone: "danger", icon: Ban },
};

/** A state as one chip: its icon and one word in its tone (a `label` replaces the word, e.g. "Approved"). */
export function StateChip({ state, label }: { state: ItemState; label?: string }) {
  const t = useT();
  const { icon: Icon, tone, label: word } = STATES[state];
  return <Badge tone={tone} data-icon="" data-state={state}><Icon aria-hidden="true" size={12} strokeWidth={2.25} />{label ?? t(word)}</Badge>;
}

export type CheckItem = { id: string; label: ReactNode; done: boolean; detail?: ReactNode; action?: ReactNode };

/** To-dos as checklist rows: a tick when done, an empty ring when not, what it is, and where to do it. */
export function CheckList({ label, items }: { label: string; items: CheckItem[] }) {
  const t = useT();
  if (!items.length) return null;
  return <ul className="wd-check-list" aria-label={label}>{items.map((item) => <li key={item.id} data-done={item.done || undefined}>
    <span className="wd-check-list-mark" aria-hidden="true">{item.done ? <Check size={12} strokeWidth={3} /> : null}</span>
    <span className="wd-check-list-text">
      <span className="wd-check-list-label">{item.label}<span className="wd-visually-hidden"> · {item.done ? t("Done") : t("Not done")}</span></span>
      {item.detail ? <span className="wd-check-list-detail">{item.detail}</span> : null}
    </span>
    {item.action ? <span className="wd-check-list-action">{item.action}</span> : null}
  </li>)}</ul>;
}

/** Money and other amounts in a list: the label at the start, the amount at the end, a total under a hairline. */
export function AmountList({ label, rows, total }: { label: string; rows: Array<{ id: string; label: ReactNode; amount: ReactNode; detail?: ReactNode }>; total?: { label: string; amount: ReactNode } }) {
  if (!rows.length) return null;
  return <dl className="wd-amount-list" aria-label={label}>
    {rows.map((row) => <div key={row.id}><dt>{row.label}{row.detail ? <small>{row.detail}</small> : null}</dt><dd>{row.amount}</dd></div>)}
    {total ? <div data-total=""><dt>{total.label}</dt><dd>{total.amount}</dd></div> : null}
  </dl>;
}

