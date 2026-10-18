import type { ReactNode } from "react";

/**
 * A money amount shown as a studio price tag (a punched tag with its label), for the few amounts that matter on a
 * record: the deal value, a proposal's fee, a quotation total. One per area; tables keep plain right-aligned amounts.
 */
export function PriceTag({ label, amount, detail, tone = "neutral" }: { label: string; amount: ReactNode; detail?: ReactNode; tone?: "neutral" | "success" | "attention" }) {
  return <span className="wd-price-tag" data-tone={tone}>
    <span className="wd-price-tag-hole" aria-hidden="true" />
    <span className="wd-price-tag-body">
      <span className="wd-price-tag-label">{label}</span>
      <strong className="wd-price-tag-amount">{amount}</strong>
      {detail ? <span className="wd-price-tag-detail">{detail}</span> : null}
    </span>
  </span>;
}

/** A record's key facts as tidy chips (label above value), never loose text: reference, client, dates, owner. */
export function FactChips({ label, items }: { label: string; items: Array<{ id: string; label: string; value: ReactNode; tone?: "neutral" | "success" | "attention" | "danger" }> }) {
  const shown = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== "");
  if (!shown.length) return null;
  return <ul className="wd-fact-chips" aria-label={label}>{shown.map((item) => <li key={item.id} data-tone={item.tone}>
    <span className="wd-fact-chip-label">{item.label}</span>
    <span className="wd-fact-chip-value">{item.value}</span>
  </li>)}</ul>;
}

export type FactTile = { id: string; label: string; value: ReactNode; icon?: ReactNode; detail?: ReactNode; tone?: "neutral" | "success" | "attention" | "danger" | "info" };

/**
 * Key facts as even tiles: an icon in a soft chip, a small label, and the value clearly set. Used wherever a few facts
 * must read at a glance (a review dialog, a record's header); never a stack of bare label/value text.
 */
export function FactTiles({ label, items }: { label: string; items: FactTile[] }) {
  const shown = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== "");
  if (!shown.length) return null;
  return <dl className="wd-fact-tiles" aria-label={label}>{shown.map((item) => <div className="wd-fact-tile" data-tone={item.tone} data-icon={item.icon ? "" : undefined} key={item.id}>
    {item.icon ? <span className="wd-fact-tile-icon" aria-hidden="true">{item.icon}</span> : null}
    <dt className="wd-fact-tile-label">{item.label}</dt>
    <dd className="wd-fact-tile-value">{item.value}{item.detail ? <span className="wd-fact-tile-detail">{item.detail}</span> : null}</dd>
  </div>)}</dl>;
}
