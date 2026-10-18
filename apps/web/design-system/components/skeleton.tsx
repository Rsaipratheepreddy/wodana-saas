"use client";

import type { CSSProperties } from "react";
import { useT } from "@/lib/i18n/i18n-provider";

type Size = string | number;
const size = (value: Size | undefined) => (typeof value === "number" ? `${value}rem` : value);

/** One placeholder block. Widths and heights are CSS lengths (numbers are rem). */
export function SkeletonBlock({ width, height, shape }: { width?: Size; height?: Size; shape?: "circle" | "pill" }) {
  const style: CSSProperties = { inlineSize: size(width), blockSize: size(height) };
  return <span aria-hidden="true" className="wd-skel" data-shape={shape} style={style} />;
}

// Stable, varied widths (no randomness: the server and the browser draw the same placeholder).
const vary = (index: number, from: number, range: number) => from + ((index * 37) % range);
const spread = (index: number, from: number, range: number) => `${vary(index, from, range)}%`;

/** Table rows shaped like the real grid: a two-line first column, plain cells, and a status pill last. */
export function TableSkeleton({ columns = 5, rows = 8, widths }: { columns?: number; rows?: number; widths?: number[] }) {
  const sizes = widths?.length ? widths : Array.from({ length: columns }, (_, index) => (index === 0 ? 2.4 : 1));
  const template = { gridTemplateColumns: sizes.map((width) => `minmax(0, ${width}fr)`).join(" ") };
  const last = sizes.length - 1;
  return <div aria-hidden="true" className="wd-skel-table">
    <div className="wd-skel-row" data-head="" style={template}>
      {sizes.map((_, column) => <SkeletonBlock height={0.5} key={column} width={spread(column, 28, 30)} />)}
    </div>
    {Array.from({ length: rows }, (_, row) => <div className="wd-skel-row" data-tall={sizes.length > 1 ? "" : undefined} key={row} style={template}>
      {sizes.map((_, column) => column === 0
        ? <span className="wd-skel-cell" key={column}><SkeletonBlock height={0.75} width={spread(row, 48, 40)} /><SkeletonBlock height={0.5} width={spread(row + 3, 26, 30)} /></span>
        : column === last && sizes.length > 2
          ? <SkeletonBlock height={1.25} key={column} shape="pill" width={vary(row + column, 3, 2)} />
          : <SkeletonBlock height={0.625} key={column} width={spread(row + column * 2, 34, 50)} />)}
    </div>)}
  </div>;
}

function Toolbar() {
  return <div className="wd-skel-toolbar">
    <span className="wd-skel-inline"><SkeletonBlock height={2} width={16} /><SkeletonBlock height={2} shape="pill" width={5.5} /><SkeletonBlock height={2} shape="pill" width={4.5} /></span>
    <SkeletonBlock height={2} width={6} />
  </div>;
}

function Board() {
  return <div className="wd-skel-board">
    {Array.from({ length: 4 }, (_, column) => <div className="wd-skel-column" key={column}>
      <span className="wd-skel-inline"><SkeletonBlock height={0.75} width={spread(column, 34, 30)} /><SkeletonBlock height={1} shape="pill" width={1.5} /></span>
      {Array.from({ length: 3 - (column % 2) }, (_, card) => <div className="wd-skel-card" key={card}>
        <SkeletonBlock height={0.75} width={spread(card + column, 60, 35)} />
        <SkeletonBlock height={0.5} width={spread(card + column + 2, 35, 30)} />
        <span className="wd-skel-inline"><SkeletonBlock height={1.25} shape="circle" width={1.25} /><SkeletonBlock height={0.5} width={4} /></span>
      </div>)}
    </div>)}
  </div>;
}

function Cards() {
  return <div className="wd-skel-cards">
    {Array.from({ length: 6 }, (_, index) => <div className="wd-skel-card" key={index}>
      <span className="wd-skel-inline"><SkeletonBlock height={2} shape="circle" width={2} /><SkeletonBlock height={0.75} width={spread(index, 40, 35)} /></span>
      <SkeletonBlock height={0.5} width={spread(index + 1, 60, 35)} />
      <SkeletonBlock height={0.5} width={spread(index + 4, 45, 35)} />
    </div>)}
  </div>;
}

/**
 * A placeholder for part of a page: text lines (default), table rows, a settings form, or a record's
 * facts (label and value pairs). `lines` is how many.
 */
export function Skeleton({ lines = 1, shape = "text" }: { lines?: number; shape?: "text" | "rows" | "form" | "facts" }) {
  if (shape === "rows") return <TableSkeleton columns={4} rows={lines} />;
  if (shape === "form") return <div aria-hidden="true" className="wd-skel-form">{Array.from({ length: lines }, (_, index) => <div className="wd-skel-field" key={index}>
    <SkeletonBlock height={0.625} width={spread(index, 18, 20)} /><SkeletonBlock height={2.25} width="100%" />
  </div>)}</div>;
  if (shape === "facts") return <div aria-hidden="true" className="wd-skel-properties">{Array.from({ length: lines }, (_, index) => <div className="wd-skel-property" key={index}>
    <SkeletonBlock height={0.5} width={spread(index, 30, 25)} /><SkeletonBlock height={0.75} width={spread(index + 2, 50, 40)} />
  </div>)}</div>;
  return <div aria-hidden="true" className="wd-skeleton-stack">{Array.from({ length: lines }, (_, index) => <span className="wd-skeleton" key={index} />)}</div>;
}

export type PageSkeletonVariant = "list" | "board" | "detail" | "form" | "cards";

/**
 * The placeholder for a whole page while it loads, shaped like the page that is coming: the header
 * with its action, tabs when the page has them, then a list (toolbar and rows), a board, a record
 * (properties, tabs and rows), a settings form or cards.
 */
export function PageSkeleton({ variant = "list", tabs = 0, rows = 8, columns = 5, page = false }: {
  variant?: PageSkeletonVariant; tabs?: number; rows?: number; columns?: number;
  /** A route's loading screen: padded like a page. */
  page?: boolean;
}) {
  const t = useT();
  return <div aria-busy="true" aria-label={t("Loading")} className="wd-skeleton-page" data-page={page || undefined} role="status">
    <div className="wd-skel-header">
      <span className="wd-skel-inline"><SkeletonBlock height={1.5} width={variant === "detail" ? 16 : 10} />{variant === "detail" ? <SkeletonBlock height={1.25} shape="pill" width={5} /> : null}</span>
      {variant === "form" ? null : <SkeletonBlock height={2.25} width={7} />}
    </div>
    {variant === "detail" ? <Skeleton lines={6} shape="facts" /> : null}
    {tabs ? <div className="wd-skel-tabs">{Array.from({ length: tabs }, (_, index) => <SkeletonBlock height={0.625} key={index} width={vary(index, 4, 3)} />)}</div> : null}
    {variant === "list" ? <><Toolbar /><TableSkeleton columns={columns} rows={rows} /></> : null}
    {variant === "board" ? <><Toolbar /><Board /></> : null}
    {variant === "detail" ? <TableSkeleton columns={columns} rows={Math.min(rows, 6)} /> : null}
    {variant === "form" ? <Skeleton lines={5} shape="form" /> : null}
    {variant === "cards" ? <Cards /> : null}
  </div>;
}
