"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { GripVertical, ImagePlus, Plus, Sigma } from "lucide-react";
import { Avatar, Badge, IconMenuButton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { LINE_KIND_LABEL, money, plain } from "@/lib/quotation/format";
import type { BuilderLine, CatalogHit, QuotePerson, QuoteThread } from "@/lib/quotation/types";
import { CommentButton } from "./quote-collab";
import styles from "./quote-builder.module.css";

export type RowColumn = "area" | "trade" | null;
type Option = { id: string; name: string };

/**
 * One line as a spreadsheet row: type to find a catalog item (choosing one fills the row), edit the
 * quantity, unit and rate in place; Enter saves and moves down, Escape undoes the cell. A formula
 * quantity or a build-up rate opens the line's details instead of being typed over.
 */
/** A line's picture: click to add or replace one; the × removes it. */
function ImageCell({ url, canEdit, title, onPick }: { url: string | null; canEdit: boolean; title: string; onPick: (file: File | null) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  return <span className={styles.thumb}>
    {url ? <img src={url} alt={t("Picture of {name}", { name: title })} /> : null}
    {canEdit ? <>
      <button type="button" className={styles.thumbButton} data-empty={url ? undefined : true} aria-label={url ? t("Change the picture of {name}", { name: title }) : t("Add a picture to {name}", { name: title })} onClick={() => input.current?.click()}>
        {url ? null : <ImagePlus aria-hidden="true" size={14} />}
      </button>
      {url ? <button type="button" className={styles.thumbRemove} aria-label={t("Remove the picture of {name}", { name: title })} onClick={() => onPick(null)}>×</button> : null}
      <input ref={input} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onPick(file); }} />
    </> : null}
  </span>;
}

export function QuoteRow({ line, draft, column, areas, trades, amount, currency, decimals, canEdit, search, comments = [], editingBy = [], image, onImage, catalogThumb, onNewCatalogItem, onComments, onChange, onCatalog, onOpen, onMenu, onDragStart, onDropBefore, onNewTrade, onNewArea }: {
  line: BuilderLine; draft?: boolean; column: RowColumn; areas: Option[]; trades: Option[]; amount: string | null; currency: string; decimals: number; canEdit: boolean;
  /** The picture column, when shown: the line's picture URL (its own or its catalog item's). */
  image?: { url: string | null } | null; onImage?: (file: File | null) => void; onNewArea?: () => void; catalogThumb?: (imageId: string) => string;
  comments?: QuoteThread[]; editingBy?: QuotePerson[]; onComments?: () => void;
  search: (text: string, signal: AbortSignal) => Promise<CatalogHit[]>;
  onChange: (fields: Partial<BuilderLine>) => void; onCatalog: (hit: CatalogHit, title: string) => void; onOpen: () => void; onNewCatalogItem?: (title: string) => void;
  onMenu: (action: string) => void; onDragStart: () => void; onDropBefore: () => void; onNewTrade: () => void;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  return <div role="row" className={styles.row} data-line-id={line.id} data-optional={line.optional || undefined} data-draft={draft || undefined} data-busy={editingBy.length ? true : undefined}
    onDragOver={(event) => { if (canEdit) { event.preventDefault(); event.currentTarget.dataset.dropTarget = "true"; } }}
    onDragLeave={(event) => { delete event.currentTarget.dataset.dropTarget; }}
    onDrop={(event) => { event.preventDefault(); delete event.currentTarget.dataset.dropTarget; onDropBefore(); }}>
    <span role="gridcell" className={styles.handleCell}>
      {editingBy.length ? <span className={styles.editing} title={editingBy.map((person) => person.name).join(", ")}><Avatar name={editingBy[0].name} size="sm" /></span> : null}
      {canEdit && !draft && !editingBy.length ? <button type="button" className={styles.handle} draggable aria-label={t("Move {name}", { name: line.title })} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", line.id); onDragStart(); }}><GripVertical aria-hidden="true" size={14} /></button> : null}
    </span>
    <span role="gridcell" className={styles.itemCell}>
      <ItemCell line={line} canEdit={canEdit} search={search} thumb={catalogThumb} onCommit={(title) => onChange({ title })} onCatalog={onCatalog} onNewCatalogItem={onNewCatalogItem} autoFocus={draft} />
      <span className={styles.itemMeta}>
        {line.kind !== "item" ? <Badge tone={line.kind === "client_supplied" ? "info" : "neutral"}>{t(LINE_KIND_LABEL[line.kind] as never)}</Badge> : null}
        {line.optional ? <Badge tone="warning">{t("Optional")}</Badge> : null}
        {line.description ? <span className={styles.description}>{line.description}</span> : null}
        {line.catalogSnapshot?.priceReason ? <span className={styles.warn}>{t(line.catalogSnapshot.priceReason as never)}</span> : null}
      </span>
    </span>
    {image ? <span role="gridcell" className={styles.imageCell}>
      <ImageCell url={image.url} canEdit={canEdit && !draft} title={line.title} onPick={(file) => onImage?.(file)} />
    </span> : null}
    {column ? <span role="gridcell" className={styles.pickCell}>
      <select aria-label={column === "area" ? t("Area") : t("Work package")} disabled={!canEdit || draft} className={styles.select}
        value={(column === "area" ? line.areaId : line.workPackageId) ?? ""}
        onChange={(event) => {
          if (event.target.value === "__new") { onNewTrade(); return; }
          if (event.target.value === "__new_area") { onNewArea?.(); return; }
          onChange(column === "area" ? { areaId: event.target.value || null } : { workPackageId: event.target.value || null });
        }}>
        <option value="">{column === "area" ? t("General") : t("No work package")}</option>
        {(column === "area" ? areas : trades).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        {column === "trade" && canEdit ? <option value="__new">{t("New work package…")}</option> : null}
        {column === "area" && canEdit && onNewArea ? <option value="__new_area">{t("New area…")}</option> : null}
      </select>
    </span> : null}
    <span role="gridcell" className={styles.numberCell}>
      {line.formula ? <button type="button" className={styles.formulaChip} onClick={onOpen} title={line.formula} data-error={line.formulaError ? true : undefined}>ƒ {plain(line.quantity, locale)}</button>
        : <CellInput label={t("Quantity")} value={plain(line.quantity, locale, 4)} disabled={!canEdit || draft} numeric onCommit={(value) => onChange({ quantity: value })} />}
    </span>
    <span role="gridcell" className={styles.unitCell}><CellInput label={t("Unit")} value={line.unit} disabled={!canEdit || draft} onCommit={(value) => onChange({ unit: value })} /></span>
    <span role="gridcell" className={styles.numberCell}>
      {line.pricingMode === "build_up" ? <button type="button" className={styles.formulaChip} onClick={onOpen} data-error={line.buildUpComplete === false || undefined}><Sigma aria-hidden="true" size={12} />{plain(line.rate, locale, decimals)}</button>
        : <CellInput label={t("Rate")} value={line.kind === "client_supplied" ? "0" : plain(line.rate, locale, 6)} disabled={!canEdit || draft || line.kind === "client_supplied"} numeric onCommit={(value) => onChange({ rate: value })} />}
    </span>
    <span role="gridcell" className={styles.amountCell}>{draft ? "" : money(amount, currency, decimals, locale)}</span>
    <span role="gridcell" className={styles.menuCell}>
      {!draft && onComments ? <CommentButton threads={comments} label={t("Comments on {name}", { name: line.title })} onOpen={onComments} /> : null}
      {!draft ? <IconMenuButton ariaLabel={t("Line actions for {name}", { name: line.title })} onAction={onMenu} items={[
        { id: "details", label: t("Details") },
        { id: "comment", label: t("Comment") },
        ...(canEdit ? [
          { id: "duplicate", label: t("Duplicate") },
          ...(!line.catalogItemId ? [{ id: "to_catalog", label: t("Add to catalog") }] : []),
          { id: "optional", label: line.optional ? t("Include in total") : t("Make optional") },
          { id: "delete", label: t("Delete"), tone: "danger" as const },
        ] : []),
      ]} /> : null}
    </span>
  </div>;
}

/** A cell that edits in place: commits on Enter or leaving the cell, Escape puts the value back. */
function CellInput({ label, value, disabled, numeric, onCommit }: { label: string; value: string; disabled?: boolean; numeric?: boolean; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const cancelled = useRef(false);
  const shown = focused ? text : value;
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    const next = numeric ? text.replace(/[^\d.]/g, "") : text.trim();
    if (next !== (numeric ? value.replace(/[^\d.]/g, "") : value) && (!numeric || next !== "")) onCommit(next);
  };
  return <input aria-label={label} className={styles.cell} data-numeric={numeric || undefined} inputMode={numeric ? "decimal" : undefined} disabled={disabled} value={shown}
    onFocus={(event) => { setText(value); setFocused(true); event.currentTarget.select(); }}
    onChange={(event) => setText(event.target.value)}
    onBlur={() => { setFocused(false); commit(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { cancelled.current = true; setText(value); event.currentTarget.blur(); }
      if (event.key === "Enter") { event.preventDefault(); moveDown(event); }
    }} />;
}

/** Enter moves to the same cell in the next row (like a spreadsheet). */
function moveDown(event: KeyboardEvent<HTMLInputElement>) {
  const cell = event.currentTarget.closest('[role="gridcell"]');
  const row = cell?.closest('[role="row"]');
  if (!cell || !row) { event.currentTarget.blur(); return; }
  const index = [...row.children].indexOf(cell);
  const rows = [...(row.closest('[role="grid"]')?.querySelectorAll('[role="row"]') ?? [])];
  const next = rows[rows.indexOf(row) + 1]?.children[index]?.querySelector<HTMLInputElement>("input:not([disabled])");
  event.currentTarget.blur();
  next?.focus();
}

/** The item name: typing searches the catalog; pick a result to fill the row, or keep the typed name as a custom line. */
function ItemCell({ line, canEdit, search, thumb, onCommit, onCatalog, onNewCatalogItem, autoFocus }: { line: BuilderLine; canEdit: boolean; search: (text: string, signal: AbortSignal) => Promise<CatalogHit[]>; thumb?: (imageId: string) => string; onCommit: (title: string) => void; onCatalog: (hit: CatalogHit, title: string) => void; onNewCatalogItem?: (title: string) => void; autoFocus?: boolean }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const listId = useId();
  const [text, setText] = useState(line.title);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const shown = focused ? text : line.title;
  useEffect(() => {
    if (!open || !text.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { search(text.trim(), controller.signal).then((items) => { setHits(items); setActive(0); }).catch(() => undefined); }, 160);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, text, search]);
  const fresh = text.trim() && text.trim() !== line.title && !hits.some((hit) => hit.name.toLowerCase() === text.trim().toLowerCase());
  const options = [...hits.map((hit) => ({ type: "hit" as const, hit })), ...(text.trim() && text.trim() !== line.title ? [{ type: "custom" as const }] : []), ...(fresh && onNewCatalogItem ? [{ type: "catalog" as const }] : [])];
  const choose = (index: number) => {
    const option = options[index];
    setOpen(false);
    if (!option) return;
    const typed = text.trim();
    cancelled.current = true; // leaving the cell mustn't also save the typed words
    if (option.type === "hit") onCatalog(option.hit, typed);
    else if (option.type === "catalog") onNewCatalogItem?.(typed);
    else onCommit(typed);
    requestAnimationFrame(() => input.current?.blur());
  };
  return <div className={styles.itemInput}>
    <input ref={input} autoFocus={autoFocus} aria-label={t("Item")} role="combobox" aria-expanded={open && options.length > 0} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
      className={styles.cell} data-title placeholder={t("Type to find an item…")} disabled={!canEdit} value={shown}
      onFocus={(event) => { setText(line.title); setFocused(true); event.currentTarget.select(); }}
      onChange={(event) => { setText(event.target.value); setOpen(true); }}
      onBlur={() => { setFocused(false); setOpen(false); if (cancelled.current) { cancelled.current = false; return; } if (text.trim() && text.trim() !== line.title) onCommit(text.trim()); }}
      onKeyDown={(event) => {
        if (open && options.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setActive((value) => (value + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length); return; }
        if (event.key === "Enter") {
          event.preventDefault();
          if (open && options.length) choose(active);
          else moveDown(event); // leaving the cell saves it
          return;
        }
        if (event.key === "Escape") { if (open) { setOpen(false); return; } cancelled.current = true; setText(line.title); event.currentTarget.blur(); }
      }} />
    {open && options.length ? <ul id={listId} role="listbox" aria-label={t("Catalog items")} className={styles.suggestions}>
      {options.map((option, index) => <li key={option.type === "hit" ? option.hit.id : option.type} id={`${listId}-${index}`} role="option" aria-selected={index === active}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
        {option.type === "hit" ? <>
          {thumb ? <span className={styles.hitThumb}>{option.hit.imageId ? <img src={thumb(option.hit.imageId)} alt="" /> : null}</span> : null}
          <span className={styles.hitName}>{option.hit.name}<small>{[option.hit.categoryName, option.hit.code].filter(Boolean).join(" · ")}</small></span>
          <span className={styles.hitPrice}>{option.hit.rate ? `${plain(option.hit.rate, locale, 2)} / ${option.hit.unitCode}` : option.hit.hasBuildUp ? t("Priced from parts") : t("No price")}</span>
        </> : <span className={styles.hitName}><span className={styles.customHit}><Plus aria-hidden="true" size={13} />{option.type === "catalog" ? t("Add “{name}” to the catalog too", { name: text.trim() }) : t("Add “{name}” as a new line", { name: text.trim() })}</span></span>}
      </li>)}
    </ul> : null}
  </div>;
}
