"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { type CSSProperties, type ReactNode } from "react";
import { useT } from "@/lib/i18n/i18n-provider";

/**
 * Report charts (management dashboards, PLM-134): ranked and column bars, stacked columns, trend lines, a gauge, a
 * donut and a funnel. Inline SVG/HTML only, colours from the data-viz and status tokens, time running toward the
 * inline end in both directions. Every figure a person can click is a real button (keyboard and screen reader), and
 * every chart carries its exact values in a visually hidden table.
 */
export type ReportSeries = { id: string; label: string };
export type ReportCategory = { key: string; label: string };
export type ReportItem = { key: string; label: string; value: number; display: string; detail?: string };

const finite = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const share = (value: number, max: number) => (max > 0 ? Math.min(1, Math.max(0, finite(value)) / max) : 0);
const peak = (values: number[]) => Math.max(0, ...values.map(finite));

function ValuesTable({ caption, head, rows }: { caption: string; head: string[]; rows: Array<{ key: string; cells: string[] }> }) {
  return <table className="wd-visually-hidden">
    <caption>{caption}</caption>
    <thead><tr>{head.map((cell, index) => <th key={index} scope="col">{cell}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key}><th scope="row">{row.cells[0]}</th>{row.cells.slice(1).map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody>
  </table>;
}

function Legend({ series }: { series: ReportSeries[] }) {
  if (series.length < 2) return null;
  return <ul className="wd-report-legend" aria-hidden="true">
    {series.map((item, index) => <li key={item.id}><i data-series={index} />{item.label}</li>)}
  </ul>;
}

/** Bars ranked by value, one row each (people, reasons, stages); an optional target marker crosses every row. */
export function RankedBars({ ariaLabel, items, onSelect, target, tone }: {
  ariaLabel: string; items: ReportItem[]; onSelect?: (key: string) => void;
  target?: { value: number; display: string }; tone?: "danger";
}) {
  const t = useT();
  const max = peak([...items.map((item) => item.value), target?.value ?? 0]);
  return <figure className="wd-ranked-bars" data-tone={tone}>
    <ol aria-label={ariaLabel}>
      {items.map((item) => {
        const body = <>
          <span className="wd-ranked-bars-label">{item.label}</span>
          <span className="wd-ranked-bars-track">
            <i style={{ "--wd-bar": share(item.value, max) } as CSSProperties} />
            {target && max > 0 ? <b className="wd-ranked-bars-target" style={{ "--wd-bar": share(target.value, max) } as CSSProperties} /> : null}
          </span>
          <span className="wd-ranked-bars-value">{item.display}{item.detail ? <small>{item.detail}</small> : null}</span>
        </>;
        return <li key={item.key}>{onSelect
          ? <button type="button" className="wd-ranked-bars-row" onClick={() => onSelect(item.key)} aria-label={t("{label}: {value}. Open the records", { label: item.label, value: item.display })}>{body}</button>
          : <span className="wd-ranked-bars-row">{body}</span>}</li>;
      })}
    </ol>
    {target ? <figcaption className="wd-report-note"><b className="wd-ranked-bars-target-key" aria-hidden="true" />{t("Target {target}", { target: target.display })}</figcaption> : null}
  </figure>;
}

/**
 * Columns per period (or category). With more than one series the columns are stacked, each part a button that
 * opens its own records; the total sits above the column.
 */
export function ColumnChart({ ariaLabel, categories, series, values, format, onSelect, highlightLast = true }: {
  ariaLabel: string; categories: ReportCategory[]; series: ReportSeries[];
  /** values[series][category] */
  values: number[][];
  format: (value: number) => string;
  onSelect?: (categoryKey: string, seriesId: string | null) => void;
  highlightLast?: boolean;
}) {
  const t = useT();
  const totals = categories.map((_, column) => series.reduce((sum, __, row) => sum + Math.max(0, finite(values[row]?.[column])), 0));
  const max = peak(totals);
  return <figure className="wd-column-chart">
    <div className="wd-column-chart-plot" role="group" aria-label={ariaLabel}>
      {categories.map((category, column) => <div key={category.key} className="wd-column-chart-column" data-current={highlightLast && column === categories.length - 1 ? "" : undefined}>
        <span className="wd-column-chart-total" aria-hidden="true">{totals[column] > 0 ? format(totals[column]) : ""}</span>
        <span className="wd-column-chart-stack" style={{ "--wd-bar": share(totals[column], max) } as CSSProperties}>
          {series.map((item, row) => {
            const value = Math.max(0, finite(values[row]?.[column]));
            if (!value) return null;
            const label = series.length > 1 ? `${category.label} · ${item.label}: ${format(value)}` : `${category.label}: ${format(value)}`;
            const style = { "--wd-part": totals[column] > 0 ? value / totals[column] : 0 } as CSSProperties;
            return onSelect
              ? <button key={item.id} type="button" data-series={row} style={style} title={label} aria-label={t("{label}. Open the records", { label })}
                  onClick={() => onSelect(category.key, series.length > 1 ? item.id : null)} />
              : <i key={item.id} data-series={row} style={style} title={label} />;
          })}
        </span>
        <small aria-hidden="true">{category.label}</small>
      </div>)}
    </div>
    <Legend series={series} />
    <ValuesTable caption={ariaLabel} head={["", ...series.map((item) => item.label)]}
      rows={categories.map((category, column) => ({ key: category.key, cells: [category.label, ...series.map((_, row) => format(finite(values[row]?.[column])))] }))} />
  </figure>;
}

/** One or more lines over periods; a period with no figure leaves a gap. Period labels open that period's records. */
export function TrendLines({ ariaLabel, categories, series, values, format, onSelect, maxValue }: {
  ariaLabel: string; categories: ReportCategory[]; series: ReportSeries[];
  values: Array<Array<number | null>>;
  format: (value: number) => string;
  onSelect?: (categoryKey: string) => void;
  /** A fixed top (e.g. 100 for percentages); otherwise the highest value. */
  maxValue?: number;
}) {
  const t = useT();
  const max = maxValue ?? peak(values.flat().map((value) => finite(value)));
  const x = (index: number) => (categories.length <= 1 ? 50 : (index / (categories.length - 1)) * 100);
  const y = (value: number) => 94 - share(value, max) * 88;
  const segments = (line: Array<number | null>) => {
    const parts: string[][] = [[]];
    line.forEach((value, index) => {
      if (value === null || !Number.isFinite(value)) { if (parts.at(-1)!.length) parts.push([]); return; }
      parts.at(-1)!.push(`${x(index)},${y(value)}`);
    });
    return parts.filter((part) => part.length);
  };
  return <figure className="wd-trend-lines">
    <svg role="img" aria-label={ariaLabel} viewBox="0 0 100 100" preserveAspectRatio="none" className="wd-chart-flow">
      <line x1="0" x2="100" y1="94" y2="94" />
      {series.map((item, row) => <g key={item.id} data-series={row}>
        {segments(values[row] ?? []).map((points, index) => points.length > 1
          ? <polyline key={index} points={points.join(" ")} vectorEffect="non-scaling-stroke" />
          : <line key={index} className="wd-trend-dot" x1={points[0].split(",")[0]} y1={points[0].split(",")[1]} x2={points[0].split(",")[0]} y2={points[0].split(",")[1]} vectorEffect="non-scaling-stroke" />)}
      </g>)}
    </svg>
    <div className="wd-trend-lines-axis">
      {categories.map((category) => onSelect
        ? <button key={category.key} type="button" onClick={() => onSelect(category.key)} aria-label={t("{label}. Open the records", { label: category.label })}>{category.label}</button>
        : <span key={category.key}>{category.label}</span>)}
    </div>
    <Legend series={series} />
    <ValuesTable caption={ariaLabel} head={["", ...series.map((item) => item.label)]}
      rows={categories.map((category, column) => ({ key: category.key, cells: [category.label, ...series.map((_, row) => {
        const value = values[row]?.[column];
        return value === null || value === undefined ? "—" : format(value);
      })] }))} />
  </figure>;
}

/** A half-circle gauge for a rate (0–100 %), with the target as a tick when one is set. */
export function Gauge({ ariaLabel, percent, display, target, tone }: {
  ariaLabel: string; percent: number | null; display: ReactNode; target?: number | null; tone?: "success" | "warning" | "danger";
}) {
  const ratio = percent === null ? 0 : Math.min(1, Math.max(0, percent / 100));
  // A half circle of radius 40 is 125.66 long.
  const length = Math.PI * 40;
  const tick = target === null || target === undefined ? null : Math.min(1, Math.max(0, target / 100));
  const angle = tick === null ? 0 : Math.PI * (1 - tick);
  return <figure className="wd-gauge" data-tone={tone}>
    <svg viewBox="0 0 100 56" role="img" aria-label={ariaLabel} className="wd-chart-flow">
      <path className="wd-gauge-track" d="M 10 50 A 40 40 0 0 1 90 50" pathLength={length} />
      <path className="wd-gauge-value" d="M 10 50 A 40 40 0 0 1 90 50" strokeDasharray={`${ratio * length} ${length}`} />
      {tick !== null ? <line className="wd-gauge-target" x1={50 + 33 * Math.cos(angle)} y1={50 - 33 * Math.sin(angle)} x2={50 + 47 * Math.cos(angle)} y2={50 - 47 * Math.sin(angle)} /> : null}
    </svg>
    <figcaption>{display}</figcaption>
  </figure>;
}

/** Parts of a whole as a ring, with a legend naming each part, its count and its value. */
export function DonutChart({ ariaLabel, segments, centre, onSelect }: {
  ariaLabel: string; segments: Array<ReportItem & { secondary?: string }>; centre?: ReactNode; onSelect?: (key: string) => void;
}) {
  const t = useT();
  const total = segments.reduce((sum, segment) => sum + Math.max(0, finite(segment.value)), 0);
  const radius = 15.9155;
  let offset = 0;
  return <figure className="wd-donut">
    <span className="wd-donut-ring">
      <svg viewBox="0 0 36 36" role="img" aria-label={`${ariaLabel}: ${segments.map((segment) => `${segment.label} ${segment.display}`).join(", ")}`}>
        <circle className="wd-donut-track" cx="18" cy="18" r={radius} />
        {segments.map((segment, index) => {
          const part = total > 0 ? (Math.max(0, finite(segment.value)) / total) * 100 : 0;
          const circle = part > 0 ? <circle key={segment.key} data-series={index} cx="18" cy="18" r={radius} strokeDasharray={`${part} ${100 - part}`} strokeDashoffset={-offset} /> : null;
          offset += part;
          return circle;
        })}
      </svg>
      {centre ? <span className="wd-donut-centre">{centre}</span> : null}
    </span>
    <ul className="wd-donut-legend">
      {segments.map((segment, index) => {
        const body = <><i data-series={index} aria-hidden="true" /><span>{segment.label}</span><strong>{segment.display}</strong>{segment.secondary ? <small>{segment.secondary}</small> : null}</>;
        return <li key={segment.key}>{onSelect
          ? <button type="button" onClick={() => onSelect(segment.key)} aria-label={t("{label}: {value}. Open the records", { label: segment.label, value: [segment.display, segment.secondary].filter(Boolean).join(", ") })}>{body}</button>
          : <span>{body}</span>}</li>;
      })}
    </ul>
  </figure>;
}

/** Steps of a funnel, each as wide as its share of the first step, with the conversion from the step before. */
export function FunnelSteps({ ariaLabel, steps, onSelect }: {
  ariaLabel: string; steps: Array<ReportItem & { rate?: string }>; onSelect?: (key: string) => void;
}) {
  const t = useT();
  const first = Math.max(0, finite(steps[0]?.value));
  return <figure className="wd-funnel-steps">
    <ol aria-label={ariaLabel}>
      {steps.map((step) => {
        const body = <>
          <span className="wd-funnel-steps-bar" style={{ "--wd-bar": first > 0 ? Math.max(0.04, share(step.value, first)) : 0.04 } as CSSProperties}><i /></span>
          <span className="wd-funnel-steps-label">{step.label}</span>
          <strong>{step.display}</strong>
          {step.rate ? <small>{step.rate}</small> : <small aria-hidden="true" />}
        </>;
        return <li key={step.key}>{onSelect
          ? <button type="button" onClick={() => onSelect(step.key)} aria-label={t("{label}: {value}. Open the records", { label: step.label, value: [step.display, step.rate].filter(Boolean).join(", ") })}>{body}</button>
          : <span>{body}</span>}</li>;
      })}
    </ol>
  </figure>;
}

export type TargetState = { target: string; percent: string | null; gap: string | null; tone: "success" | "warning" | "danger" } | null;

/**
 * The figure against the same span just before: which way it moved, by how much (already formatted, e.g. "12%"),
 * whether that is good news, and the earlier period it is measured against (e.g. "1–12 Sep").
 */
export type ComparisonState = { direction: "up" | "down" | "flat"; change: string | null; tone?: "success" | "danger"; against: string; previous: string } | null;

function Comparison({ comparison }: { comparison: NonNullable<ComparisonState> }) {
  const t = useT();
  const arrow = comparison.direction === "up" ? <ArrowUp aria-hidden="true" size={12} /> : comparison.direction === "down" ? <ArrowDown aria-hidden="true" size={12} /> : null;
  const text = comparison.change === null ? t("Was {value} in {period}", { value: comparison.previous, period: comparison.against })
    : comparison.direction === "flat" ? t("Same as {period}", { period: comparison.against })
    : t("{change} vs {period}", { change: comparison.change, period: comparison.against });
  return <small className="wd-kpi-figure-change" data-tone={comparison.tone} title={t("Was {value} in {period}", { value: comparison.previous, period: comparison.against })}>
    {arrow}<span>{text}</span>
  </small>;
}

/**
 * A KPI figure with its target (PLM-134): Actual, Target, % achieved and the gap, coloured green at 100 % or more,
 * amber at 80–99 % and red under 80 %; "No target set" when none is entered. `noData` says the figure can't be
 * read yet instead of showing a misleading zero. `comparison` sets it against the period before; `empty` replaces the
 * chart when nothing is recorded yet (with the next action).
 */
export function KpiFigure({ label, value, detail, target, targetable, noData, tone, onOpen, comparison, note, empty, children }: {
  label: string; value: ReactNode; detail?: ReactNode; target?: TargetState; targetable?: boolean; noData?: boolean;
  /** A figure that is bad news whenever it is above zero (delayed, overdue). */
  tone?: "danger"; onOpen?: () => void; comparison?: ComparisonState;
  /** One muted line under the figure (e.g. what it is read from). */
  note?: ReactNode;
  empty?: ReactNode; children?: ReactNode;
}) {
  const t = useT();
  const figure = noData ? <span className="wd-kpi-figure-empty">{t("Not enough data yet")}</span> : value;
  return <section className="wd-kpi-figure" data-tone={!noData ? target?.tone ?? tone : undefined}>
    <header>
      <h3>{label}</h3>
      {onOpen && !noData && !empty
        ? <button type="button" className="wd-kpi-figure-value" onClick={onOpen} aria-label={t("{label}. Open the records", { label })}>{figure}</button>
        : <strong className="wd-kpi-figure-value">{figure}</strong>}
      {comparison && !noData ? <Comparison comparison={comparison} /> : null}
      {detail && !noData ? <small className="wd-kpi-figure-detail">{detail}</small> : null}
      {note ? <small className="wd-kpi-figure-note">{note}</small> : null}
    </header>
    {targetable && !noData ? target
      ? <dl className="wd-kpi-figure-target">
          <div><dt>{t("Target")}</dt><dd>{target.target}</dd></div>
          <div><dt>{t("Achieved")}</dt><dd>{target.percent ?? "—"}</dd></div>
          <div><dt>{t("Gap")}</dt><dd>{target.gap ?? "—"}</dd></div>
        </dl>
      : <small className="wd-kpi-figure-no-target">{t("No target set")}</small> : null}
    {empty ? <div className="wd-kpi-figure-empty-state">{empty}</div> : children ? <div className="wd-kpi-figure-chart">{children}</div> : null}
  </section>;
}
