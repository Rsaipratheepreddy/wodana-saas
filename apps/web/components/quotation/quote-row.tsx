"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { GripVertical, ImagePlus, Plus, Sigma, X } from "lucide-react";
import { Avatar, Badge, IconMenuButton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { LINE_KIND_LABEL, money, plain } from "@/lib/quotation/format";
import type { BuilderLine, CatalogHit, QuoteColumn, QuotePerson, QuoteThread } from "@/lib/quotation/types";
import { CommentButton } from "./quote-collab";
import { CellPicker } from "./cell-picker";
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

/** Which optional columns the table shows. */
export type RowColumns = { picture: boolean; size: boolean; material: boolean };

export function QuoteRow({ line, draft, serial, column, columns, customColumns = [], areas, trades, units = [], materials = [], sizeUnit = "cm", amount, currency, decimals, canEdit, canAsk, search, comments = [], editingBy = [], imageUrl, onImage, catalogThumb, onNewCatalogItem, onComments, onChange, onCatalog, onOpen, onMenu, onDragStart, onDropBefore, onNewTrade, onNewArea, onDiscard, onPasteRows, flash }: {
  line: BuilderLine; draft?: boolean; serial?: number; column: RowColumn; columns: RowColumns; areas: Option[]; trades: Option[];
  /** The firm's own columns, after material. */
  customColumns?: QuoteColumn[];
  units?: Array<{ code: string; label: string }>; materials?: string[]; sizeUnit?: string;
  amount: string | null; currency: string; decimals: number; canEdit: boolean;
  /** The assistant can be asked about this line (⌘K). */
  canAsk?: boolean;
  /** The line's picture (its own or its catalog item's). */
  imageUrl?: string | null; onImage?: (file: File | null) => void; onNewArea?: () => void; catalogThumb?: (imageId: string) => string;
  comments?: QuoteThread[]; editingBy?: QuotePerson[]; onComments?: () => void;
  search: (text: string, signal: AbortSignal, limit?: number) => Promise<CatalogHit[]>;
  onChange: (fields: Partial<BuilderLine>) => void; onCatalog: (hit: CatalogHit, title: string) => void; onOpen: () => void; onNewCatalogItem?: (title: string) => void;
  onMenu: (action: string) => void; onDragStart: () => void; onDropBefore: () => void; onNewTrade: () => void;
  /** A new row left empty goes away. */
  onDiscard?: () => void;
  /** Rows pasted from a spreadsheet into a new row (tab-separated). */
  onPasteRows?: (text: string) => void;
  /** Just changed by the assistant: highlighted for a moment. */
  flash?: boolean;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  // A removal credits an agreed item as it was sold: only how much is removed can change.
  const fixed = line.changeOp === "omit";
  const locked = !canEdit || draft || fixed;
  // Sizes keep the unit they were written in; the first size typed records the workspace's unit.
  const size = (key: "length" | "width" | "height", value: string) => onChange({ [key]: value || null, ...(line.dimensionUnit ? {} : { dimensionUnit: sizeUnit }) });
  const unitOptions = [...units.map((unit) => ({ id: unit.code, name: unit.code })), ...(line.unit && !units.some((unit) => unit.code === line.unit) ? [{ id: line.unit, name: line.unit }] : [])];
  return <div role="row" className={styles.row} data-line-id={line.id} data-change={line.changeOp ?? undefined} data-optional={line.optional || undefined} data-draft={draft || undefined} data-busy={editingBy.length ? true : undefined} data-flash={flash || undefined}
    onDragOver={(event) => { if (canEdit) { event.preventDefault(); event.currentTarget.dataset.dropTarget = "true"; } }}
    onDragLeave={(event) => { delete event.currentTarget.dataset.dropTarget; }}
    onDrop={(event) => { event.preventDefault(); delete event.currentTarget.dataset.dropTarget; onDropBefore(); }}>
    <span role="gridcell" className={`${styles.handleCell} ${styles.gutter}`} data-stick="gutter">
      {editingBy.length ? <span className={styles.editing} title={editingBy.map((person) => person.name).join(", ")}><Avatar name={editingBy[0].name} size="sm" /></span> : null}
      {canEdit && !draft && !editingBy.length ? <button type="button" className={styles.handle} draggable aria-label={t("Move {name}", { name: line.title })} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", line.id); onDragStart(); }}><GripVertical aria-hidden="true" size={14} /></button> : null}
    </span>
    <span role="gridcell" className={styles.serialCell} data-stick="serial">{serial ?? ""}</span>
    {columns.picture ? <span role="gridcell" className={styles.imageCell} data-stick="picture">
      <ImageCell url={imageUrl ?? null} canEdit={canEdit && !draft} title={line.title} onPick={(file) => onImage?.(file)} />
    </span> : null}
    <span role="gridcell" className={styles.itemCell} data-stick="item">
      <ItemCell line={line} canEdit={canEdit && !fixed} search={search} thumb={catalogThumb} onCommit={(title) => onChange({ title })} onCatalog={onCatalog} onNewCatalogItem={onNewCatalogItem} draft={draft} onDiscard={onDiscard} onPasteRows={onPasteRows} />
      <span className={styles.itemMeta}>
        {line.changeOp === "omit" ? <Badge tone="danger">{t("Removes")}</Badge> : line.changeOp === "move" ? <Badge tone="info">{t("Moves")}</Badge> : null}
        {line.kind === "client_supplied" || line.kind === "relocate" ? <Badge tone="info">{t(LINE_KIND_LABEL[line.kind] as never)}</Badge> : null}
        {line.optional ? <Badge tone="warning">{t("Optional")}</Badge> : null}
        {line.description ? <span className={styles.description}>{line.description}</span> : null}
        {line.catalogSnapshot?.priceReason ? <span className={styles.warn}>{t(line.catalogSnapshot.priceReason as never)}</span> : null}
      </span>
    </span>
    {column ? <span role="gridcell" className={styles.pickCell}>
      <CellPicker label={column === "area" ? t("Area") : t("Work package")} isDisabled={locked}
        value={(column === "area" ? line.areaId : line.workPackageId) ?? null}
        options={column === "area" ? areas : trades} noneLabel={column === "area" ? t("General") : t("No work package")}
        onChange={(id) => onChange(column === "area" ? { areaId: id } : { workPackageId: id })}
        onCreate={canEdit ? (column === "area" ? onNewArea : onNewTrade) : undefined}
        createLabel={column === "area" ? t("New area…") : t("New work package…")} />
    </span> : null}
    {columns.size ? (["length", "width", "height"] as const).map((key) => <span key={key} role="gridcell" className={styles.numberCell}>
      <CellInput label={t(SIZE_LABEL[key] as never)} value={line[key] === null ? "" : plain(line[key], locale, 2)} disabled={locked} numeric allowEmpty onCommit={(value) => size(key, value)} />
    </span>) : null}
    {columns.material ? <span role="gridcell" className={styles.materialCell}>
      <MaterialCell value={line.material} options={materials} disabled={locked} onCommit={(material) => onChange({ material })} />
    </span> : null}
    {customColumns.map((custom) => <span key={custom.id} role="gridcell" className={custom.kind === "number" ? styles.numberCell : styles.textCell}>
      <CellInput label={custom.name} value={line.values?.[custom.id] ?? ""} disabled={locked} numeric={custom.kind === "number"} allowEmpty
        onCommit={(value) => onChange({ values: { ...(line.values ?? {}), [custom.id]: value } })} />
    </span>)}
    <span role="gridcell" className={styles.numberCell}>
      {line.formula ? <button type="button" className={styles.formulaChip} onClick={onOpen} title={line.formula} data-error={line.formulaError ? true : undefined}>ƒ {plain(line.quantity, locale)}</button>
        : <CellInput label={t("Quantity")} value={plain(line.quantity, locale, 4)} disabled={!canEdit || draft} numeric onCommit={(value) => onChange({ quantity: value })} />}
    </span>
    <span role="gridcell" className={styles.unitCell}>
      <CellPicker label={t("Unit")} value={line.unit || null} options={unitOptions} noneLabel="—" isDisabled={locked} onChange={(id) => onChange({ unit: id ?? "" })} />
    </span>
    <span role="gridcell" className={styles.numberCell}>
      {line.pricingMode === "build_up" ? <button type="button" className={styles.formulaChip} onClick={onOpen} data-error={line.buildUpComplete === false || undefined}><Sigma aria-hidden="true" size={12} />{plain(line.rate, locale, decimals)}</button>
        : <CellInput label={t("Rate")} value={line.kind === "client_supplied" ? "0" : plain(line.rate, locale, 6)} disabled={!canEdit || draft || line.kind === "client_supplied" || fixed} numeric onCommit={(value) => onChange({ rate: value })} />}
    </span>
    <span role="gridcell" className={styles.amountCell} data-stick="amount">{draft ? "" : money(amount, currency, decimals, locale)}</span>
    <span role="gridcell" className={`${styles.menuCell} ${styles.gutter}`} data-stick="menu">
      {!draft && onComments ? <CommentButton threads={comments} label={t("Comments on {name}", { name: line.title })} onOpen={onComments} /> : null}
      {!draft ? <IconMenuButton ariaLabel={t("Line actions for {name}", { name: line.title })} onAction={onMenu} items={[
        ...(canAsk ? [{ id: "ask", label: t("Ask AI about this line") }] : []),
        { id: "details", label: t("Details") },
        { id: "comment", label: t("Comment") },
        ...(canEdit ? [
          ...(line.changeOp === "omit" || line.changeOp === "move" ? [] : [{ id: "duplicate", label: t("Duplicate") }]),
          ...(!line.catalogItemId && !line.changeOp ? [{ id: "to_catalog", label: t("Add to catalog") }] : []),
          ...(!line.changeOp || line.changeOp === "add" ? [{ id: "optional", label: line.optional ? t("Include in total") : t("Make optional") }] : []),
          { id: "delete", label: t("Delete"), tone: "danger" as const },
        ] : []),
      ]} /> : null}
    </span>
  </div>;
}

const SIZE_LABEL = { length: "Length", width: "Depth", height: "Height" } as const;

/**
 * What the line is made of — often more than one thing ("PL core fabric", "veneer wood"). Each material
 * is a tag: pick from the workspace's materials or type your own (a "/" separates several); Backspace
 * on the empty field removes the last one. Saved as the list the estimator writes on the quote.
 */
function MaterialCell({ value, options, disabled, onCommit }: { value: string; options: string[]; disabled?: boolean; onCommit: (value: string) => void }) {
  const t = useT();
  const listId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const field = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const parts = splitMaterials(value);
  const query = text.trim().toLowerCase();
  const matches = options.filter((name) => !parts.some((part) => part.toLowerCase() === name.toLowerCase()) && (!query || name.toLowerCase().includes(query))).slice(0, 30);
  // Nothing called exactly that yet: offer to add what was typed.
  const offerNew = query && !options.some((name) => name.toLowerCase() === query) && !parts.some((part) => part.toLowerCase() === query);
  const suggestions = [...matches, ...(offerNew ? [NEW_MATERIAL] : [])];
  const save = (next: string[]) => { const joined = next.join(" / "); if (joined !== parts.join(" / ")) onCommit(joined); };
  const add = (typed: string) => {
    setText(""); setActive(0);
    const fresh = splitMaterials(typed).filter((name, index, all) => !parts.some((part) => part.toLowerCase() === name.toLowerCase()) && all.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === index);
    if (fresh.length) save([...parts, ...fresh]);
  };
  return <div className={styles.materials}>
    {parts.map((part, index) => <span key={part} className={styles.tag} data-tone={toneOf(part)}>
      {part}
      {disabled ? null : <button type="button" aria-label={t("Remove {name}", { name: part })} onClick={() => save(parts.filter((_, at) => at !== index))}><X aria-hidden="true" size={11} /></button>}
    </span>)}
    {disabled ? null : <span ref={field} className={styles.tagPicker}>
      <input aria-label={t("Material")} role="combobox" aria-expanded={open && suggestions.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && suggestions[active] ? `${listId}-${active}` : undefined}
        className={styles.tagInput} placeholder={parts.length ? "" : t("Add material")} value={text}
        onFocus={() => setOpen(true)} onChange={(event) => { setText(event.target.value); setOpen(true); setActive(0); }}
        onBlur={() => { setOpen(false); if (text.trim()) add(text); }}
        onKeyDown={(event) => {
          if (open && suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length); return; }
          if (event.key === "Enter") { event.preventDefault(); const choice = open ? suggestions[active] : undefined; add(!choice || choice === NEW_MATERIAL ? text : choice); return; }
          if (event.key === "Backspace" && !text && parts.length) save(parts.slice(0, -1));
          if (event.key === "Escape") { setOpen(false); setText(""); }
        }} />
      {open && suggestions.length ? <FloatingList anchor={field} id={listId} label={t("Materials")} className={styles.suggestions} onClose={close}>
        {suggestions.map((name, index) => <li key={name} id={`${listId}-${index}`} role="option" aria-selected={index === active}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => add(name === NEW_MATERIAL ? text : name)}>
          {name === NEW_MATERIAL ? <span className={styles.customHit}><Plus aria-hidden="true" size={13} />{t("Add “{name}”", { name: text.trim() })}</span>
            : <span className={styles.tag} data-tone={toneOf(name)}>{name}</span>}
        </li>)}
      </FloatingList> : null}
    </span>}
  </div>;
}

/**
 * A cell's suggestion list, drawn above the sheet (so the sheet's scroll area never clips it) and placed
 * under its field. It closes when the page scrolls.
 */
function FloatingList({ anchor, id, label, className, onClose, children }: { anchor: RefObject<HTMLElement | null>; id: string; label: string; className: string; onClose: () => void; children: ReactNode }) {
  const { portalContainer, direction } = useDesignSystem();
  const [place, setPlace] = useState<{ top?: number; bottom?: number; height: number; start: number; width: number } | null>(null);
  useLayoutEffect(() => {
    // Below the field when there's room, otherwise above it; never off the screen.
    const measure = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      const below = window.innerHeight - box.bottom - 12, above = box.top - 12;
      const start = direction === "rtl" ? window.innerWidth - box.right : box.left;
      setPlace(below >= 220 || below >= above
        ? { top: box.bottom + 4, height: Math.max(120, below), start, width: box.width }
        : { bottom: window.innerHeight - box.top + 4, height: Math.max(120, above), start, width: box.width });
    };
    measure();
    const close = () => onClose();
    // The field can grow (a new tag wraps the cell): follow it.
    const watcher = new ResizeObserver(measure);
    if (anchor.current) watcher.observe(anchor.current);
    window.addEventListener("scroll", close, true); window.addEventListener("resize", measure);
    return () => { watcher.disconnect(); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", measure); };
  }, [anchor, direction, onClose]);
  if (!place) return null;
  return createPortal(<ul id={id} role="listbox" aria-label={label} className={className} dir={direction}
    style={{ position: "fixed", top: place.top, bottom: place.bottom, insetInlineStart: place.start, minInlineSize: place.width, maxBlockSize: Math.min(place.height, 320) }}>{children}</ul>, portalContainer ?? document.body);
}

const NEW_MATERIAL = "\u0000new";
const splitMaterials = (value: string) => value.split("/").map((part) => part.trim()).filter(Boolean);
/** A stable tint per material, so the same material looks the same on every line. */
const TAG_TONES = ["info", "success", "warning", "brand", "neutral"] as const;
const toneOf = (name: string) => TAG_TONES[[...name.toLowerCase()].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 997, 7) % TAG_TONES.length];

/** A cell that edits in place: commits on Enter or leaving the cell, Escape puts the value back. */
function CellInput({ label, value, disabled, numeric, allowEmpty, placeholder, onCommit }: { label: string; value: string; disabled?: boolean; numeric?: boolean; allowEmpty?: boolean; placeholder?: string; onCommit: (value: string) => void }) {
  const { locale } = useDesignSystem();
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const cancelled = useRef(false);
  const shown = focused ? text : value;
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    if (!numeric) { const next = text.trim(); if (next !== value) onCommit(next); return; }
    // Numbers are read the way the workspace writes them ("2,55" or "2.55"); anything that isn't one puts the value back.
    const next = readNumber(text, locale), before = readNumber(value, locale);
    if (next === null) { if (allowEmpty && !text.trim() && before !== null) onCommit(""); else setText(value); return; }
    if (next !== before) onCommit(next);
  };
  return <input aria-label={label} className={styles.cell} data-numeric={numeric || undefined} inputMode={numeric ? "decimal" : undefined} disabled={disabled} value={shown} placeholder={placeholder}
    onFocus={(event) => { setText(value); setFocused(true); event.currentTarget.select(); }}
    onChange={(event) => setText(numeric ? event.target.value.replace(/[^\d.,]/g, "") : event.target.value)}
    onBlur={() => { setFocused(false); commit(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { cancelled.current = true; setText(value); event.currentTarget.blur(); }
      if (event.key === "Enter") { event.preventDefault(); moveDown(event); }
    }} />;
}

/**
 * A typed number as the server takes it ("1234.5"), reading the workspace's decimal mark and ignoring
 * its thousands mark; null when it isn't a number (empty, ".", "1.2.3").
 */
export function readNumber(text: string, locale: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  const group = parts.find((part) => part.type === "group")?.value ?? ",";
  let clean = text.trim().replace(/\s/g, "");
  if (!clean) return null;
  if (decimal !== ".") clean = clean.split(group === "." ? "." : "\u0000").join("").replace(decimal, ".");
  else clean = clean.split(group).join("");
  return /^\d+(\.\d+)?$/.test(clean) ? String(Number(clean)) : /^\d+\.$/.test(clean) ? String(Number(clean.slice(0, -1))) : null;
}

/** What a number cell accepts as you type: digits and one decimal point, nothing else. */
const onlyNumber = (value: string) => value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");

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
function ItemCell({ line, canEdit, search, thumb, onCommit, onCatalog, onNewCatalogItem, draft, onDiscard, onPasteRows }: { line: BuilderLine; canEdit: boolean; search: (text: string, signal: AbortSignal, limit?: number) => Promise<CatalogHit[]>; thumb?: (imageId: string) => string; onCommit: (title: string) => void; onCatalog: (hit: CatalogHit, title: string) => void; onNewCatalogItem?: (title: string) => void; draft?: boolean; onDiscard?: () => void; onPasteRows?: (text: string) => void }) {
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
  const closeList = useCallback(() => setOpen(false), []);
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
    <input ref={input} autoFocus={draft} aria-label={t("Item")} role="combobox" aria-expanded={open && options.length > 0} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
      className={styles.cell} data-title placeholder={t("Type to find an item…")} disabled={!canEdit} value={shown} title={line.title || undefined}
      onFocus={(event) => { setText(line.title); setFocused(true); event.currentTarget.select(); }}
      onChange={(event) => { setText(event.target.value); setOpen(true); }}
      onPaste={(event) => {
        // Rows copied from a spreadsheet become lines, one per row.
        const pasted = event.clipboardData.getData("text/plain");
        if (!draft || !onPasteRows || !/[\t\n]/.test(pasted.trim())) return;
        event.preventDefault(); cancelled.current = true; setOpen(false);
        onPasteRows(pasted);
      }}
      onBlur={() => {
        setFocused(false); setOpen(false);
        if (cancelled.current) { cancelled.current = false; return; }
        // Like a spreadsheet: what was typed in a new row stays as a line; left empty, the row goes away.
        if (draft) { if (text.trim()) onCommit(text.trim()); else onDiscard?.(); return; }
        if (text.trim() && text.trim() !== line.title) onCommit(text.trim());
      }}
      onKeyDown={(event) => {
        if (open && options.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setActive((value) => (value + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length); return; }
        if (event.key === "Enter") {
          event.preventDefault();
          if (open && options.length) choose(active);
          else if (draft && text.trim()) { cancelled.current = true; onCommit(text.trim()); }
          else moveDown(event); // leaving the cell saves it
          return;
        }
        if (event.key === "Escape") {
          if (open) { setOpen(false); return; }
          cancelled.current = true; setText(line.title);
          if (draft) onDiscard?.();
          event.currentTarget.blur();
        }
      }} />
    {open && options.length ? <FloatingList anchor={input} id={listId} label={t("Catalog items")} className={styles.suggestions} onClose={closeList}>
      {options.map((option, index) => <li key={option.type === "hit" ? option.hit.id : option.type} id={`${listId}-${index}`} role="option" aria-selected={index === active}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
        {option.type === "hit" ? <>
          {thumb ? <span className={styles.hitThumb}>{option.hit.imageId ? <img src={thumb(option.hit.imageId)} alt="" /> : null}</span> : null}
          <span className={styles.hitName}>{option.hit.name}<small>{[option.hit.categoryName, option.hit.code].filter(Boolean).join(" · ")}</small></span>
          <span className={styles.hitPrice}>{option.hit.rate ? `${plain(option.hit.rate, locale, 2)} / ${option.hit.unitCode}` : option.hit.hasBuildUp ? t("Priced from parts") : t("No price")}</span>
        </> : <span className={styles.hitName}><span className={styles.customHit}><Plus aria-hidden="true" size={13} />{option.type === "catalog" ? t("Add “{name}” to the catalog too", { name: text.trim() }) : draft ? t("Add “{name}” as a new line", { name: text.trim() }) : t("Rename to “{name}”", { name: text.trim() })}</span></span>}
      </li>)}
    </FloatingList> : null}
  </div>;
}
