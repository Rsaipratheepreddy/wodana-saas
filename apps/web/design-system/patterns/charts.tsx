"use client";

import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

/**
 * Small inline-SVG/HTML charts. Colours come from semantic tokens (the brand colour follows the
 * tenant), time runs toward the inline end in both directions, and every chart carries a text
 * summary plus its exact values for screen readers.
 */
export type ChartPoint = { label: string; value: number; display?: string };

const peak = (points: ChartPoint[]) => Math.max(0, ...points.map(point => (Number.isFinite(point.value) ? point.value : 0)));
const share = (value: number, max: number) => (max > 0 && Number.isFinite(value) ? Math.max(0, value) / max : 0);
const shown = (point: ChartPoint) => point.display ?? String(point.value);

function ExactValues({ points, caption }: { points: ChartPoint[]; caption: string }) {
  return <table className="wd-visually-hidden"><caption>{caption}</caption><tbody>{points.map(point => <tr key={point.label}><th scope="row">{point.label}</th><td>{shown(point)}</td></tr>)}</tbody></table>;
}

/** A line trend without axes, for dense summaries. The last point is marked. */
export function Sparkline({ points, label, tone = "brand" }: { points: ChartPoint[]; label: string; tone?: "brand" | "neutral" }) {
  const max = peak(points);
  const x = (index: number) => (points.length <= 1 ? 50 : (index / (points.length - 1)) * 100);
  const y = (value: number) => 28 - share(value, max) * 24;
  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
  const last = points.at(-1);
  return <span className="wd-sparkline" data-tone={tone}>
    <svg aria-label={label} role="img" viewBox="0 0 100 32" preserveAspectRatio="none" className="wd-chart-flow">
      {points.length > 1 ? <polyline points={line} vectorEffect="non-scaling-stroke" /> : null}
      {last ? <circle cx={x(points.length - 1)} cy={y(last.value)} r="2.5" /> : null}
    </svg>
    <ExactValues points={points} caption={label} />
  </span>;
}

/** Tiny bars for a KPI card; the latest bar carries the brand colour. */
export function MiniBars({ points, label }: { points: ChartPoint[]; label: string }) {
  const max = peak(points);
  return <span className="wd-mini-bars">
    <span className="wd-mini-bars-plot" role="img" aria-label={label}>
      {points.map((point, index) => <i key={point.label} data-current={index === points.length - 1 || undefined} style={{ "--wd-bar": share(point.value, max) } as CSSProperties} />)}
    </span>
    <ExactValues points={points} caption={label} />
  </span>;
}

/**
 * Column chart with one highlighted bar (usually the current period) and a value tooltip on
 * hover or keyboard focus. Arrow keys move between bars (mirrored in right-to-left).
 */
export function BarChart({ ariaLabel, data, highlightIndex = data.length - 1, formatValue }: { ariaLabel: string; data: ChartPoint[]; highlightIndex?: number; formatValue?: (point: ChartPoint) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const status = useId();
  const max = peak(data);
  const text = (point: ChartPoint) => formatValue ? formatValue(point) : shown(point);
  const current = active ?? (focused ? highlightIndex : null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const step = event.key === "ArrowRight" ? (rtl ? -1 : 1) : event.key === "ArrowLeft" ? (rtl ? 1 : -1) : event.key === "Home" ? -data.length : event.key === "End" ? data.length : 0;
    if (!step || !data.length) return;
    event.preventDefault();
    setActive(Math.min(data.length - 1, Math.max(0, (current ?? highlightIndex) + step)));
  };
  return <figure className="wd-bar-chart-v2">
    <div className="wd-bar-chart-plot" role="img" aria-label={ariaLabel} aria-describedby={status} tabIndex={data.length ? 0 : undefined}
      onKeyDown={onKeyDown} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setActive(null); }} onPointerLeave={() => setActive(null)}>
      {data.map((point, index) => <div key={point.label} className="wd-bar-chart-column" onPointerEnter={() => setActive(index)} data-active={current === index || undefined} data-current={index === highlightIndex || undefined}>
        <span className="wd-bar-chart-track"><i style={{ "--wd-bar": share(point.value, max) } as CSSProperties} /></span>
        {current === index ? <span className="wd-bar-chart-tip" aria-hidden="true">{text(point)}</span> : null}
        <small aria-hidden="true">{point.label}</small>
      </div>)}
    </div>
    <span id={status} className="wd-visually-hidden" aria-live="polite">{current !== null && data[current] ? `${data[current].label}: ${text(data[current])}` : ""}</span>
    <ExactValues points={data.map(point => ({ ...point, display: text(point) }))} caption={ariaLabel} />
  </figure>;
}

export type SplitSegment = { id: string; label: string; value: number; display: string };

/** One bar split into parts, with a legend that names each part and its value. */
export function SplitBar({ segments, label, total }: { segments: SplitSegment[]; label: string; total?: number }) {
  const sum = total ?? segments.reduce((value, segment) => value + Math.max(0, segment.value), 0);
  return <div className="wd-split-bar">
    <span className="wd-split-bar-track" role="img" aria-label={`${label}: ${segments.map(segment => `${segment.label} ${segment.display}`).join(", ")}`}>
      {segments.map((segment, index) => segment.value > 0 ? <i key={segment.id} data-series={index} style={{ "--wd-part": share(segment.value, sum) } as CSSProperties} /> : null)}
    </span>
    <ul className="wd-split-bar-legend" aria-hidden="true">
      {segments.map((segment, index) => <li key={segment.id}><i data-series={index} /><span>{segment.label}</span><strong>{segment.display}</strong></li>)}
    </ul>
  </div>;
}

/** A ring showing how much of a target is reached, e.g. received of due. */
export function ProgressRing({ value, max, label, children }: { value: number; max: number; label: string; children?: ReactNode }) {
  const ratio = Math.min(1, share(value, max));
  const radius = 15.9155;
  return <span className="wd-progress-ring">
    <svg viewBox="0 0 36 36" role="img" aria-label={label}>
      <circle className="wd-progress-ring-track" cx="18" cy="18" r={radius} />
      <circle className="wd-progress-ring-value" cx="18" cy="18" r={radius} strokeDasharray={`${ratio * 100} 100`} />
    </svg>
    {children ? <span className="wd-progress-ring-label">{children}</span> : null}
  </span>;
}
