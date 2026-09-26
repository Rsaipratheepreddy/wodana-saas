import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatMoney, formatNumber } from "../foundations/formatters";

export function Kpi({ change, formatter = "number", label, value }: { change?: number; formatter?: "number" | "money" | "percent"; label: string; value: number }) { const formatted = formatter === "money" ? formatMoney(value) : formatter === "percent" ? `${formatNumber(value)}%` : formatNumber(value); return <div className="wd-kpi"><span>{label}</span><strong>{formatted}</strong>{change != null ? <small data-positive={change >= 0}>{change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(change)}% from prior period</small> : null}</div>; }

export type SeriesPoint = { label: string; value: number };
export function LineChart({ ariaLabel, data }: { ariaLabel: string; data: SeriesPoint[] }) { const max = Math.max(...data.map((point) => point.value), 1); const points = data.map((point, index) => `${(index / Math.max(1, data.length - 1)) * 100},${100 - (point.value / max) * 90}`).join(" "); return <figure className="wd-chart"><svg aria-label={ariaLabel} preserveAspectRatio="none" role="img" viewBox="0 0 100 100"><line x1="0" x2="100" y1="100" y2="100" /><polyline fill="none" points={points} /></svg><figcaption>{data.map((point) => <span key={point.label}>{point.label}<strong>{point.value}</strong></span>)}</figcaption></figure>; }

export type BurndownPoint = { label: string; remaining: number | null; ideal: number };
/** Work left over time against the ideal straight line to zero; days to come have no line yet. */
export function BurndownChart({ ariaLabel, points, summary }: { ariaLabel: string; points: BurndownPoint[]; summary?: ReactNode }) {
  const max = Math.max(1, ...points.map((point) => Math.max(point.ideal, point.remaining ?? 0)));
  const x = (index: number) => (points.length <= 1 ? 50 : (index / (points.length - 1)) * 100);
  const y = (value: number) => 94 - (value / max) * 88;
  const line = (values: Array<number | null>) => values.map((value, index) => (value === null ? null : `${x(index)},${y(value)}`)).filter(Boolean).join(" ");
  return <figure className="wd-burndown">
    <svg aria-label={ariaLabel} preserveAspectRatio="none" role="img" viewBox="0 0 100 100">
      <line x1="0" x2="100" y1="94" y2="94" />
      <polyline className="wd-burndown-ideal" points={line(points.map((point) => point.ideal))} vectorEffect="non-scaling-stroke" />
      <polyline className="wd-burndown-actual" points={line(points.map((point) => point.remaining))} vectorEffect="non-scaling-stroke" />
    </svg>
    <figcaption><span>{points[0]?.label}</span>{summary ? <strong>{summary}</strong> : null}<span>{points.at(-1)?.label}</span></figcaption>
  </figure>;
}
export function BarChart({ ariaLabel, data }: { ariaLabel: string; data: SeriesPoint[] }) { const max = Math.max(...data.map((point) => point.value), 1); return <figure className="wd-bar-chart" role="img" aria-label={ariaLabel}>{data.map((point) => <div key={point.label}><span><i style={{ blockSize: `${(point.value / max) * 100}%` }} /></span><small>{point.label}</small><strong>{point.value}</strong></div>)}</figure>; }

export function Funnel({ steps }: { steps: Array<SeriesPoint & { color?: string }> }) { const max = Math.max(...steps.map((step) => step.value), 1); return <ol className="wd-funnel">{steps.map((step, index) => <li key={step.label} style={{ inlineSize: `${Math.max(24, (step.value / max) * 100)}%`, background: step.color }}><span>{index + 1}. {step.label}</span><strong>{step.value}</strong></li>)}</ol>; }

export function Heatmap({ columns, rows, values }: { columns: string[]; rows: string[]; values: number[][] }) { const max = Math.max(...values.flat(), 1); return <div className="wd-heatmap" style={{ "--wd-heat-columns": columns.length } as React.CSSProperties}><span />{columns.map((column) => <strong key={column}>{column}</strong>)}{rows.map((row, rowIndex) => <div className="wd-heat-row" key={row}><strong>{row}</strong>{values[rowIndex].map((value, columnIndex) => <span aria-label={`${row}, ${columns[columnIndex]}: ${value}`} key={`${row}-${columns[columnIndex]}`} style={{ "--wd-heat": value / max } as React.CSSProperties}>{value}</span>)}</div>)}</div>; }

export function AnalyticsPanel({ children, description, title }: { children: ReactNode; description?: string; title: string }) { return <section className="wd-analytics-panel"><header><div><strong>{title}</strong>{description ? <small>{description}</small> : null}</div></header>{children}</section>; }
