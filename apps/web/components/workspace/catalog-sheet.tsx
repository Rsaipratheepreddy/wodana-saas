"use client";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, DataGrid, Checkbox, SelectField, useDesignSystem } from "@/design-system";
import {
  blankCatalogRecord,
  catalogStructure,
  type CatalogKind,
  type CatalogRecord,
  type CatalogField,
} from "@/lib/workspace/catalog";
import { Dialog, DialogTrigger, Popover } from "react-aria-components";
import { CatalogRecordPicker, CatalogMultiplePicker } from "./catalog-picker";
import styles from "./catalog-sheet.module.css";
import { parseClipboard, recordCode, recordSections, isMasterRecord } from "@/lib/workspace/catalog-navigation";

type Column = {
  key: string;
  label: string;
  field?: CatalogField;
  relation?: string;
  multiple?: boolean;
};
type Drafts = Record<string, CatalogRecord>;
const primaryLinks = ["unit", "execution"];
const parentLinks = ["parent", "unit", "execution"];
const mixedDefinition = {...catalogStructure.custom, label:"Records", links:[], fields:[]};
export function CatalogSheet({
  kind,
  items,
  rows,
  canManage,
  onSave,
  onOpen,
  onSaved,
  onDirtyChange,
  initialColumns,
  createRow,
  openLabel = "Open",
  selectedIds = [],
  onSelectionChange,
  toolbarContent,
  onSaveComplete,
}: {
  initialColumns?: string[];
  createRow?: () => CatalogRecord;
  openLabel?: string;
  kind: CatalogKind | "all";
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  toolbarContent?: ReactNode;
  onSaveComplete?: (saved: number, failed: number) => void;
  items: CatalogRecord[];
  rows: CatalogRecord[];
  canManage: boolean;
  onSave: (record: CatalogRecord) => Promise<CatalogRecord>;
  onOpen: (record: CatalogRecord) => void;
  onSaved: (record: CatalogRecord) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const {portalContainer}=useDesignSystem();
  const definition = kind === "all" ? mixedDefinition : catalogStructure[kind];
  const primaryRelations = ["construction", "variant_rule"].includes(kind) ? parentLinks : primaryLinks;
  const columns = useMemo<Column[]>(
    () => [
      { key: "name", label: "Name" },
      ...(kind === "all" ? [
        {key:"description",label:"Description"},
        {key:"kind",label:"Type"},
        {key:"linked",label:"Linked records"},
        {key:"link:record_group",label:"Group",relation:"record_group"},
      ] : [{ key: "code", label: "Code" }]),
      ...definition.links
        .filter((l) => primaryRelations.includes(l.relation))
        .map((l) => ({
          key: `link:${l.relation}`,
          label: l.label,
          relation: l.relation,
          multiple: l.multiple,
        })),
      ...definition.fields.map((field) => ({
        key: `config:${field.key}`,
        label: field.label,
        field,
      })),
      ...definition.links
        .filter((l) => !primaryRelations.includes(l.relation))
        .map((l) => ({
          key: `link:${l.relation}`,
          label: l.label,
          relation: l.relation,
          multiple: l.multiple,
        })),
    ],
    [definition, kind, primaryRelations],
  );
  const [shown, setShown] = useState<string[]>(
    () =>
      initialColumns ?? (kind === "all" ? ["name", "description", "kind", "linked"] :
      columns
        .slice(
          0,
          Math.max(
            6,
            2 +
              definition.links.filter((l) =>
                primaryRelations.includes(l.relation),
              ).length,
          ),
        )
        .map((c) => c.key)),
  );
  const [drafts, setDrafts] = useState<Drafts>({});
  const [history, setHistory] = useState<Drafts[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [active, setActive] = useState<{
    id: string;
    key: string;
    value: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    onDirtyChange?.(Object.keys(drafts).length > 0 || Boolean(active));
  }, [drafts, active, onDirtyChange]);
  const visible = shown
    .map((key) => columns.find((c) => c.key === key))
    .filter((c): c is Column => Boolean(c));
  const byId = new Map(items.map((r) => [r.id, r]));
  const displayRows = [
    ...rows.map((r) => drafts[r.id] ?? r),
    ...Object.values(drafts).filter((r) => !rows.some((x) => x.id === r.id)),
  ];
  const recordValue = (r: CatalogRecord, c: Column) =>
    c.key === "linked" ? r.links.filter(l=>l.relation!=="record_group").map(l=>byId.get(l.targetId)?.name??"Unavailable").join(", ") : c.key === "kind" ? catalogStructure[r.kind].label : c.relation
      ? r.links
          .filter((l) => l.relation === c.relation)
          .map((l) => l.targetId)
          .join(",")
      : c.field
        ? String(r.configuration?.[c.field.key] ?? "")
        : String(r[c.key as "name" | "code"]);
  const label = (r: CatalogRecord, c: Column) =>
    c.key === "linked" ? recordValue(r,c) : c.key === "kind" ? catalogStructure[r.kind].label : c.relation
      ? r.links
          .filter((l) => l.relation === c.relation)
          .map((l) => byId.get(l.targetId)?.name ?? "Unavailable")
          .join(", ")
      : recordValue(r, c);
  function write(
    record: CatalogRecord,
    column: Column,
    value: string,
  ): CatalogRecord {
    if (record.archived) throw new Error("Restore archived records before editing.");
    if (column.key === "linked") throw new Error("Edit connections in record details, or choose their individual columns.");
    if (column.key === "code" && record.version > 0) {
      if (value !== record.code) throw new Error("Saved codes cannot change.");
      return record;
    }
    if (column.relation) {
      const relation = column.relation;
      const targets = value
        ? value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : [];
      const resolved = targets.map(
        (target) =>
          items.find(
            (r) =>
              (relation === "related" ? isMasterRecord(r) : r.kind === (relation === "parent" ? record.kind : relation)) &&
              !r.archived &&
              (!record.catalogId || r.catalogId === record.catalogId) &&
              (r.id === target ||
                r.code === target ||
                r.name.toLowerCase() === target.toLowerCase()),
          )?.id,
      );
      if (resolved.some((v) => !v))
        throw new Error(
          `Unknown ${column.label.toLowerCase()}; use an existing name or code.`,
        );
      if (!column.multiple && resolved.length > 1)
        throw new Error(`Choose one ${column.label.toLowerCase()}.`);
      return {
        ...record,
        links: [
          ...record.links.filter((l) => l.relation !== relation),
          ...Array.from(new Set(resolved)).map((targetId) => ({
            relation,
            targetId: targetId!,
          })),
        ],
      };
    }
    if (column.field) {
      const f = column.field;
      const configuration = { ...record.configuration };
      if (value === "") delete configuration[f.key];
      else {
        if (
          f.type === "number" &&
          (!Number.isFinite(Number(value)) ||
            (f.min != null && Number(value) < f.min) ||
            (f.max != null && Number(value) > f.max))
        )
          throw new Error(`Invalid ${f.label.toLowerCase()}.`);
        if (f.type === "select" && !f.options?.includes(value))
          throw new Error(`Choose a valid ${f.label.toLowerCase()}.`);
        configuration[f.key] = f.type === "number" ? Number(value) : value;
      }
      return { ...record, configuration };
    }
    if (column.key === "kind") {
      const target = recordSections.find(s=>[s.kind,s.label,s.singular].some(v=>v.toLowerCase()===value.trim().toLowerCase()));
      if (!target) throw new Error("Choose an existing record type, or Custom records.");
      if (record.kind === target.kind) return record;
      if (record.version) throw new Error("Saved record types cannot change.");
      return {...blankCatalogRecord(target.kind),id:record.id,name:record.name,code:record.code,description:record.description,catalogId:record.catalogId,links:record.links.filter(l=>l.relation === "record_group")};
    }
    const next = { ...record, [column.key]: value };
    if (column.key === "name" && !next.version && !next.code)
      next.code = recordCode(value,record.id);
    return next;
  }
  const remember = (next: Drafts) => {
    setHistory((h) => [...h.slice(-19), drafts]);
    setDrafts(next);
  };
  function commit() {
    if (!active) return true;
    const r = displayRows.find((r) => r.id === active.id);
    const c = columns.find((c) => c.key === active.key);
    if (!r || !c) return false;
    try {
      const next = write(r, c, active.value);
      remember({ ...drafts, [r.id]: next });
      setErrors((e) => ({ ...e, [r.id]: "" }));
      setActive(null);
      return true;
    } catch (error) {
      setErrors((e) => ({
        ...e,
        [r.id]: error instanceof Error ? error.message : "Invalid value.",
      }));
      return false;
    }
  }
  function keyboard(
    event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    row: number,
    col: number,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      setActive(null);
      return;
    }
    if (event.key !== "Enter" && event.key !== "Tab") return;
    event.preventDefault();
    if (!commit()) return;
    const direction = event.shiftKey ? -1 : 1;
    const step = event.key === "Enter" ? visible.length * direction : direction;
    let next = row * visible.length + col + step;
    while (next >= 0 && next < displayRows.length * visible.length) {
      let r = displayRows[Math.floor(next / visible.length)];
      const c = visible[next % visible.length];
      if (r.archived || c.key === "linked" || (["code","kind"].includes(c.key) && r.version > 0)) {
        next += step;
        continue;
      }
      // Preserve generated codes when moving straight from a new row's name.
      if (active?.id === r.id) {
        r = write(r, columns.find((c) => c.key === active.key)!, active.value);
      }
      setActive({ id: r.id, key: c.key, value: recordValue(r, c) });
      break;
    }
  }
  function paste(text: string, rowIndex: number, colIndex: number) {
    if (!text.includes("\t") && !text.includes("\n")) return false;
    const next = { ...drafts };
    try {
      const lines = parseClipboard(text);
      if (lines.length > 100) throw new Error("Paste up to 100 rows at a time.");
      for (let i = 0; i < lines.length; i++) {
        let r =
          displayRows[rowIndex + i] ??
          createRow?.() ??
          blankCatalogRecord(kind === "all" ? "custom" : kind);
        const values = lines[i];
        if (values.length + colIndex > visible.length)
          throw new Error("Show enough columns for this paste.");
        for (let j = 0; j < values.length; j++)
          r = write(r, visible[colIndex + j], values[j]);
        next[r.id] = r;
      }
      remember(next);
      setActive(null);
      setErrors({});
    } catch (error) {
      setErrors({
        sheet: error instanceof Error ? error.message : "Paste failed.",
      });
    }
    return true;
  }
  const save = async () => {
    if (active && !commit()) return;
    setSaving(true);
    let savedCount = 0;
    const failures: Record<string, string> = {};
    const remaining = { ...drafts };
    // Apply the active cell directly as React state updates are asynchronous.
    if (active) {
      const r = displayRows.find((r) => r.id === active.id)!;
      remaining[r.id] = write(
        r,
        columns.find((c) => c.key === active.key)!,
        active.value,
      );
    }
    for (const record of Object.values(remaining)) {
      try {
        const saved = await onSave(record);
        onSaved(saved);
        savedCount++;
        delete remaining[record.id];
      } catch (e) {
        failures[record.id] =
          e instanceof Error ? e.message : "Could not save this row.";
      }
    }
    setDrafts(remaining);
    setErrors(failures);
    setHistory([]);
    setSaving(false);
    onSaveComplete?.(savedCount, Object.keys(remaining).length);
  };
  return (
    <div className={styles.sheet}>
      <div className={styles.toolbar}>
        <div><span>
          {displayRows.length} rows
          {Object.keys(drafts).length
            ? ` · ${Object.keys(drafts).length} changed`
            : ""}
        </span>{toolbarContent}</div>
        <div>
          <DialogTrigger><Button size="compact" isDisabled={saving||Boolean(active)}>Columns</Button><Popover UNSTABLE_portalContainer={portalContainer??undefined} className="wd-popover wd-column-popover" placement="bottom end"><Dialog aria-label="Visible columns" className="wd-column-menu">
            {columns.map(c=><Checkbox key={c.key} isSelected={shown.includes(c.key)} isDisabled={c.key==="name"} onChange={checked=>setShown(current=>checked?[...current,c.key]:current.filter(k=>k!==c.key))}>{c.label}</Checkbox>)}
          </Dialog></Popover></DialogTrigger>
          {canManage && (
            <>
              <Button
                size="compact"
                isDisabled={!history.length || saving}
                onPress={() => {
                  setDrafts(history.at(-1)!);
                  setHistory((h) => h.slice(0, -1));
                  setActive(null);
                }}
              >
                Undo
              </Button>
              <Button
                size="compact"
                isDisabled={saving}
                onPress={() => {
                  if (active && !commit()) return;
                  const r = createRow?.() ?? blankCatalogRecord(kind === "all" ? "custom" : kind);
                  const next={...drafts};
                  if(active){const current=displayRows.find(row=>row.id===active.id)!;next[current.id]=write(current,columns.find(c=>c.key===active.key)!,active.value);}
                  remember({ ...next, [r.id]: r });
                  setActive({ id: r.id, key: "name", value: "" });
                }}
              >
                Add row
              </Button>
              <Button
                size="compact"
                variant="primary"
                isDisabled={(!Object.keys(drafts).length && !active) || saving}
                isLoading={saving}
                onPress={save}
              >
                Save changes
              </Button>
            </>
          )}
        </div>
      </div>
      {errors.sheet && (
        <p role="alert" className={styles.error}>
          {errors.sheet}
        </p>
      )}
      <div className={styles.scroll}>
        {!displayRows.length && <p className={styles.empty}>No records here yet. Add a row to start, or paste rows from Excel.</p>}
        <DataGrid ariaLabel={`${definition.label} editable sheet`} data={displayRows} getRowId={r=>r.id} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false} manualPagination columns={[
 {id:'__select',header:()=><>{onSelectionChange && canManage ? <input type="checkbox" aria-label="Select visible records" disabled={saving || Boolean(active) || Boolean(Object.keys(drafts).length)} checked={rows.length>0 && rows.every(r=>selectedIds.includes(r.id))} onChange={e=>onSelectionChange(e.target.checked ? rows.map(r=>r.id) : [])}/> : "#"}</>,size:44,enableHiding:false,enableSorting:false,enableColumnFilter:false,meta:{renderCell:r=>{const row=displayRows.findIndex(item=>item.id===r.id);return <>{onSelectionChange && canManage && r.version ? <input type="checkbox" aria-label={`Select ${r.name}`} disabled={saving || Boolean(active) || Boolean(Object.keys(drafts).length)} checked={selectedIds.includes(r.id)} onChange={e=>onSelectionChange(e.target.checked ? [...selectedIds,r.id] : selectedIds.filter(id=>id!==r.id))}/> : row + 1}</>;}}},
 ...visible.map((c,col)=>({id:c.key,header:c.label,size:c.key==='name'?260:200,enableSorting:false,enableColumnFilter:false,meta:{renderCell:(r:CatalogRecord)=>{const row=displayRows.findIndex(item=>item.id===r.id);
                  const editing = active?.id === r.id && active.key === c.key;
                  const editable =
                    canManage &&
                    !saving && c.key !== "linked" &&
                    !r.archived &&
                    !(["code","kind"].includes(c.key) && r.version > 0);
                  return <>
                      {editing ? (
                        <>
                          {c.relation || c.field?.type === "select" || c.key === "kind" ? (
                            <div className={styles.cellPicker} data-grid-interactive>
                              {c.multiple?<CatalogMultiplePicker label={`Edit ${c.label}`} items={items.filter(t=>(c.relation==="related"?isMasterRecord(t):t.kind===(c.relation==="parent"?r.kind:c.relation))&&!t.archived&&t.catalogId===r.catalogId&&t.id!==r.id).map(t=>({id:t.id,label:t.name}))} selected={active.value?active.value.split(","):[]} onChange={ids=>setActive({...active,value:ids.join(",")})}/>
                                : c.relation?<CatalogRecordPicker label={`Edit ${c.label}`} selectedKey={active.value||null} onChange={id=>setActive({...active,value:id})} items={items.filter(t=>(c.relation==="related"?isMasterRecord(t):t.kind===(c.relation==="parent"?r.kind:c.relation))&&!t.archived&&t.catalogId===r.catalogId&&t.id!==r.id).map(t=>({id:t.id,label:t.name}))}/>
                                : <SelectField label={`Edit ${c.label}`} selectedKey={active.value||"unset"} onSelectionChange={key=>setActive({...active,value:key==="unset"?"":String(key)})} items={[{id:"unset",label:"Not set"},...(c.key==="kind"?recordSections.map(s=>({id:s.label,label:s.label})):(c.field?.options??[]).map(id=>({id,label:id.replaceAll("_"," ")})))]}/>}
                              <div className={styles.pickerActions}><Button size="compact" variant="quiet" onPress={()=>setActive(null)}>Cancel</Button><Button size="compact" onPress={commit}>Apply</Button></div>
                            </div>
                          ) : (
                            <input
                              autoFocus
                              aria-label={`Edit ${c.label}`}
                              type={
                                c.field?.type === "number"
                                  ? "number"
                                  : c.field?.type === "date"
                                    ? "date"
                                    : "text"
                              }
                              step="any"
                              value={active.value}
                              onChange={(e) =>
                                setActive({ ...active, value: e.target.value })
                              }
                              onBlur={commit}
                              onKeyDown={(e) => keyboard(e, row, col)}
                              onPaste={(e) => {
                                if (
                                  paste(
                                    e.clipboardData.getData("text"),
                                    row,
                                    col,
                                  )
                                )
                                  e.preventDefault();
                              }}
                            />
                          )}
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={!editable}
                          onClick={() => {
                            if (active && !commit()) return;
                            setActive({
                              id: r.id,
                              key: c.key,
                              value: recordValue(r, c),
                            });
                          }}
                          onPaste={(e) => {
                            if (
                              editable &&
                              paste(e.clipboardData.getData("text"), row, col)
                            )
                              e.preventDefault();
                          }}
                          title={label(r, c)}
                          aria-label={`Edit ${c.label} for ${r.name || "new row"}`}
                        >
                          {label(r, c) || <span>—</span>}
                        </button>
                      )}
                      {c.key === "name" && errors[r.id] && (
                        <small role="alert" className={styles.error}>
                          {errors[r.id]}
                        </small>
                      )}
                    </>;}}})),
 {id:'action',header:'Details',size:110,enableSorting:false,enableColumnFilter:false,meta:{renderCell:r=><>
                  <button className={styles.details} onClick={() => onOpen(r)}>
                    {openLabel}
                  </button>
                </>}},
 ]}/>
      </div>
      {canManage && (
        <p className={styles.hint}>
          Click a cell to edit · Tab moves across · Enter moves down · Paste
          rows from Excel · Save changes applies the edited rows
        </p>
      )}
    </div>
  );
}
