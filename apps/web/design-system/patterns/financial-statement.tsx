"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";

/**
 * A financial statement as accountants read it (P&L, balance sheet, cash flow, trial balance): section headings,
 * indented lines that open to their detail, section totals over a rule, results under a double rule, ratios in a
 * quiet line, and right-aligned tabular figures per column (period, comparison, change, forecast). Values come in
 * already formatted by the caller's locale and currency. Works left to right and right to left.
 */
export type StatementColumnHead = {
  key: string;
  label: ReactNode;
  /** A second header line, e.g. the period's dates. */
  detail?: ReactNode;
  /** comparison and change columns read quieter; forecast columns are marked as projected. */
  tone?: "comparison" | "change" | "forecast";
};

export type StatementLine = {
  key: string;
  /** heading: a section title · line: an amount line · subtotal: a section total over a rule · result: gross/net profit under a double rule · ratio: a margin line. */
  kind: "heading" | "line" | "subtotal" | "result" | "ratio";
  label: ReactNode;
  /** A code before the label (an account code, a tax box). */
  code?: string | null;
  depth?: number;
  /** One per column; null leaves the cell empty. */
  values: Array<ReactNode | null>;
  /** Lines under this one, shown when it is opened. */
  children?: StatementLine[];
  /** Marks negative figures per column so they can be told apart beyond the brackets or sign. */
  negative?: boolean[];
};

function Row({ line, columns, depth, open, onToggle, openKeys }: {
  line: StatementLine; columns: StatementColumnHead[]; depth: number; open: boolean; onToggle: (key: string) => void; openKeys: ReadonlySet<string>;
}) {
  const t = useT();
  const expandable = Boolean(line.children?.length);
  const label = <>
    {line.code ? <span className="wd-statement-code">{line.code}</span> : null}
    <span className="wd-statement-name">{line.label}</span>
  </>;
  const Cell = line.kind === "heading" ? "th" : "td";
  return <>
    <tr className="wd-statement-row" data-kind={line.kind} data-depth={Math.min(depth, 4)} data-open={expandable ? open : undefined}>
      <th scope="row" className="wd-statement-label" colSpan={line.kind === "heading" && line.values.every((value) => value === null) ? columns.length + 1 : undefined}>
        {expandable
          ? <button type="button" className="wd-statement-toggle" aria-expanded={open} onClick={() => onToggle(line.key)}
              aria-label={open ? t("Hide the lines of {label}", { label: typeof line.label === "string" ? line.label : "" }) : t("Show the lines of {label}", { label: typeof line.label === "string" ? line.label : "" })}>
              {open ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" data-directional="true" size={14} />}
            </button>
          : depth > 0 ? <span className="wd-statement-toggle-space" aria-hidden="true" /> : null}
        {label}
      </th>
      {line.kind === "heading" && line.values.every((value) => value === null) ? null
        : columns.map((column, index) => <Cell key={column.key} className="wd-statement-value" data-tone={column.tone} data-negative={line.negative?.[index] || undefined}>
            {line.values[index] ?? null}
          </Cell>)}
    </tr>
    {expandable && open ? line.children!.map((child) => <Row key={child.key} line={child} columns={columns} depth={depth + 1} open={openKeys.has(child.key)}
      onToggle={onToggle} openKeys={openKeys} />) : null}
  </>;
}

export function StatementTable({ label, labelHeader, columns, lines, defaultOpen = [], className }: {
  label: string;
  /** The first column's header (usually empty or "Account"). */
  labelHeader?: ReactNode;
  columns: StatementColumnHead[];
  lines: StatementLine[];
  /** Keys of lines open at first. */
  defaultOpen?: readonly string[];
  className?: string;
}) {
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set(defaultOpen));
  const toggle = (key: string) => setOpenKeys((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return <div className={["wd-statement", className].filter(Boolean).join(" ")} role="region" aria-label={label} tabIndex={0}>
    <table className="wd-statement-table" aria-label={label}>
      <thead>
        <tr>
          <th scope="col" className="wd-statement-label">{labelHeader ?? null}</th>
          {columns.map((column) => <th scope="col" key={column.key} className="wd-statement-value" data-tone={column.tone}>
            <span>{column.label}</span>{column.detail ? <small>{column.detail}</small> : null}
          </th>)}
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => <Row key={line.key} line={line} columns={columns} depth={line.depth ?? 0} open={openKeys.has(line.key)} onToggle={toggle} openKeys={openKeys} />)}
      </tbody>
    </table>
  </div>;
}
