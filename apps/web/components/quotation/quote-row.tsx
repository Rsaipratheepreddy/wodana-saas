"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ComboBox, Input, ListBox, ListBoxItem, Popover } from "react-aria-components";
import { GripVertical, ImagePlus, Plus, Sigma } from "lucide-react";
import { Avatar, Badge, IconMenuButton, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { LINE_KIND_LABEL, money, plain } from "@/lib/quotation/format";
import type { BuilderLine, CatalogHit, QuotePerson, QuoteThread } from "@/lib/quotation/types";
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

export function QuoteRow({ line, draft, serial, column, columns, areas, trades, units = [], materials = [], sizeUnit = "cm", amount, currency, decimals, canEdit, canAsk, search, comments = [], editingBy = [], imageUrl, onImage, catalogThumb, onNewCatalogItem, onComments, onChange, onCatalog, onOpen, onMenu, onDragStart, onDropBefore, onNewTrade, onNewArea, onDiscard, flash }: {
  line: BuilderLine; draft?: boolean; serial?: number; column: RowColumn; columns: RowColumns; areas: Option[]; trades: Option[];
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
    <span role="gridcell" className={styles.handleCell}>
      {editingBy.length ? <span className={styles.editing} title={editingBy.map((person) => person.name).join(", ")}><Avatar name={editingBy[0].name} size="sm" /></span> : null}
      {canEdit && !draft && !editingBy.length ? <button type="button" className={styles.handle} draggable aria-label={t("Move {name}", { name: line.title })} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", line.id); onDragStart(); }}><GripVertical aria-hidden="true" size={14} /></button> : null}
    </span>
    <span role="gridcell" className={styles.serialCell}>{serial ?? ""}</span>
    {columns.picture ? <span role="gridcell" className={styles.imageCell}>
      <ImageCell url={imageUrl ?? null} canEdit={canEdit && !draft} title={line.title} onPick={(file) => onImage?.(file)} />
    </span> : null}
    <span role="gridcell" className={styles.itemCell}>
      <ItemCell line={line} canEdit={canEdit && !fixed} search={search} thumb={catalogThumb} onCommit={(title) => onChange({ title })} onCatalog={onCatalog} onNewCatalogItem={onNewCatalogItem} draft={draft} onDiscard={onDiscard} />
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
    <span role="gridcell" className={styles.amountCell}>{draft ? "" : money(amount, currency, decimals, locale)}</span>
    <span role="gridcell" className={styles.menuCell}>
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

/** What the line is made of: pick one of the workspace's materials, or type your own ("Taj Mahal marble / veneer wood"). */
function MaterialCell({ value, options, disabled, onCommit }: { value: string; options: string[]; disabled?: boolean; onCommit: (value: string) => void }) {
  const t = useT();
  const { portalContainer, direction } = useDesignSystem();
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? value;
  const query = (text ?? "").trim().toLowerCase();
  const items = options.filter((name) => !query || name.toLowerCase().includes(query)).slice(0, 40).map((name) => ({ id: name, name }));
  const commit = (next: string) => { setText(null); if (next.trim() !== value) onCommit(next.trim()); };
  return <ComboBox aria-label={t("Material")} className={styles.picker} allowsCustomValue menuTrigger="input" inputValue={shown} items={items} isDisabled={disabled}
    onInputChange={setText} onSelectionChange={(key) => { if (key !== null) commit(String(key)); }}>
    <Input className={styles.pickerInput} onFocus={(event) => event.currentTarget.select()}
      onBlur={() => { if (text !== null) commit(text); }}
      onKeyDown={(event) => { if (event.key === "Escape") setText(null); if (event.key === "Enter") { const input = event.currentTarget; requestAnimationFrame(() => input.blur()); } }} />
    <Popover UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-picker-popover" dir={direction} placement="bottom start">
      <ListBox renderEmptyState={() => null}>{(item: { id: string; name: string }) => <ListBoxItem className="wd-picker-item" id={item.id} textValue={item.name}>{item.name}</ListBoxItem>}</ListBox>
    </Popover>
  </ComboBox>;
}

/** A cell that edits in place: commits on Enter or leaving the cell, Escape puts the value back. */
function CellInput({ label, value, disabled, numeric, allowEmpty, placeholder, onCommit }: { label: string; value: string; disabled?: boolean; numeric?: boolean; allowEmpty?: boolean; placeholder?: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const cancelled = useRef(false);
  const shown = focused ? text : value;
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    const next = numeric ? text.replace(/[^\d.]/g, "") : text.trim();
    if (next !== (numeric ? value.replace(/[^\d.]/g, "") : value) && (!numeric || allowEmpty || next !== "")) onCommit(next);
  };
  return <input aria-label={label} className={styles.cell} data-numeric={numeric || undefined} inputMode={numeric ? "decimal" : undefined} disabled={disabled} value={shown} placeholder={placeholder}
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
function ItemCell({ line, canEdit, search, thumb, onCommit, onCatalog, onNewCatalogItem, draft, onDiscard }: { line: BuilderLine; canEdit: boolean; search: (text: string, signal: AbortSignal, limit?: number) => Promise<CatalogHit[]>; thumb?: (imageId: string) => string; onCommit: (title: string) => void; onCatalog: (hit: CatalogHit, title: string) => void; onNewCatalogItem?: (title: string) => void; draft?: boolean; onDiscard?: () => void }) {
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
    <input ref={input} autoFocus={draft} aria-label={t("Item")} role="combobox" aria-expanded={open && options.length > 0} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
      className={styles.cell} data-title placeholder={t("Type to find an item…")} disabled={!canEdit} value={shown} title={line.title || undefined}
      onFocus={(event) => { setText(line.title); setFocused(true); event.currentTarget.select(); }}
      onChange={(event) => { setText(event.target.value); setOpen(true); }}
      onBlur={() => {
        setFocused(false); setOpen(false);
        if (cancelled.current) { cancelled.current = false; return; }
        // A new row becomes a line only by choosing an item or pressing Enter; left empty, it goes away.
        if (draft) { if (!text.trim()) onDiscard?.(); return; }
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
