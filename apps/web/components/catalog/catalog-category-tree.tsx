"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { FormDialog, IconMenuButton, SelectField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { catalogApi, type CatalogCategory } from "@/lib/workspace/catalog-v2";
import styles from "./catalog-page.module.css";

type Action = "edit" | "merge" | "delete";
const TOP = "__top";

/** Categories as a tree: the parents first, each one's children below it. */
function childrenOf(categories: CatalogCategory[]) {
  const byParent = new Map<string | null, CatalogCategory[]>();
  const known = new Set(categories.map((category) => category.id));
  for (const category of categories) {
    const parent = category.parentId && known.has(category.parentId) ? category.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), category]);
  }
  return byParent;
}

/** Every category below one. */
export function descendantsOf(categories: CatalogCategory[], id: string): Set<string> {
  const byParent = childrenOf(categories);
  const found = new Set<string>();
  const walk = (parent: string) => { for (const child of byParent.get(parent) ?? []) if (!found.has(child.id)) { found.add(child.id); walk(child.id); } };
  walk(id);
  return found;
}

/**
 * The catalog's categories, nested and collapsible; each shows how many items opening it lists (its own and its
 * sub-categories', counted on the server). Someone who manages the catalog renames, moves, merges or deletes a
 * category from its ⋯ menu.
 */
export function CatalogCategoryTree({ catalogId, categories, canManage, selectedId, onSelect, onChanged, workspaceId }: {
  catalogId: string; categories: CatalogCategory[]; canManage: boolean; selectedId: string | null; onSelect: (id: string | null) => void;
  onChanged: () => void; workspaceId: string;
}) {
  const t = useT();
  const byParent = useMemo(() => childrenOf(categories), [categories]);
  // Open: the ones someone opened, and the way down to the selected category.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const path = useMemo(() => {
    const ancestors = new Set<string>();
    let current = categories.find((category) => category.id === selectedId);
    while (current?.parentId && !ancestors.has(current.parentId)) { ancestors.add(current.parentId); current = categories.find((category) => category.id === current!.parentId); }
    return ancestors;
  }, [categories, selectedId]);
  const [acting, setActing] = useState<{ action: Action; category: CatalogCategory } | null>(null);
  const toggle = (id: string) => setOpened((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  const row = (category: CatalogCategory, depth: number): ReactNode => {
    const children = byParent.get(category.id) ?? [];
    const open = opened.has(category.id) || path.has(category.id);
    const empty = !category.itemCount && !children.length;
    return <li key={category.id} role="none">
      <div className={styles.treeRow} data-depth={Math.min(depth, 4)}>
        {children.length ? <button aria-expanded={open} aria-label={open ? t("Collapse {name}", { name: category.name }) : t("Expand {name}", { name: category.name })}
          className={styles.treeToggle} data-open={open || undefined} onClick={() => toggle(category.id)} type="button"><ChevronRight aria-hidden="true" size={14} /></button>
          : <span aria-hidden="true" className={styles.treeToggle} />}
        <button aria-current={selectedId === category.id ? "true" : undefined} className={styles.treeItem} onClick={() => onSelect(category.id)} type="button">
          <span>{category.name}</span>{category.itemCount ? <small>{category.itemCount}</small> : null}
        </button>
        {canManage ? <span className={styles.treeMenu}><IconMenuButton ariaLabel={t("Actions for {name}", { name: category.name })} onAction={(id) => setActing({ action: id as Action, category })}
          items={[{ id: "edit", label: t("Rename or move") }, { id: "merge", label: t("Merge into another category") },
            { id: "delete", label: t("Delete"), tone: "danger", isDisabled: !empty }]} /></span> : null}
      </div>
      {children.length && open ? <ul className={styles.treeList} role="group">{children.map((child) => row(child, depth + 1))}</ul> : null}
    </li>;
  };

  return <>
    <ul className={styles.treeList} role="list">
      <li role="none"><div className={styles.treeRow} data-depth="0"><span aria-hidden="true" className={styles.treeToggle} />
        <button aria-current={selectedId === null ? "true" : undefined} className={styles.treeItem} onClick={() => onSelect(null)} type="button"><span>{t("All items")}</span></button>
      </div></li>
      {(byParent.get(null) ?? []).map((category) => row(category, 0))}
    </ul>
    {acting ? <CategoryDialog action={acting.action} catalogId={catalogId} categories={categories} category={acting.category} onClose={() => setActing(null)}
      onDone={(removed) => { setActing(null); if (removed && selectedId === acting.category.id) onSelect(null); onChanged(); }} workspaceId={workspaceId} /> : null}
  </>;
}

function CategoryDialog({ action, catalogId, categories, category, onClose, onDone, workspaceId }: {
  action: Action; catalogId: string; categories: CatalogCategory[]; category: CatalogCategory; onClose: () => void; onDone: (removed: boolean) => void; workspaceId: string;
}) {
  const t = useT();
  const [name, setName] = useState(category.name);
  const [parentId, setParentId] = useState(category.parentId ?? TOP);
  const [intoId, setIntoId] = useState("");
  // Never under itself or one of its own sub-categories.
  const below = useMemo(() => descendantsOf(categories, category.id), [categories, category.id]);
  const others = categories.filter((other) => other.id !== category.id && !below.has(other.id)).sort((a, b) => a.name.localeCompare(b.name))
    .map((other) => ({ id: other.id, label: other.name }));
  const path = `${catalogId}/categories/${category.id}`;
  const version = category.version ?? 1;

  if (action === "delete") {
    return <FormDialog isOpen onClose={onClose} submitLabel={t("Delete")} submitVariant="danger" title={t("Delete {name}?", { name: category.name })}
      description={t("The category is empty.")}
      onSubmit={async () => { await catalogApi(workspaceId, `${path}?version=${version}`, { method: "DELETE" }); onDone(true); }}>{null}</FormDialog>;
  }
  if (action === "merge") {
    const target = categories.find((other) => other.id === intoId);
    return <FormDialog isDirty={Boolean(intoId)} isOpen isSubmitDisabled={!intoId} onClose={onClose} submitLabel={t("Merge")} title={t("Merge {name}", { name: category.name })}
      description={target ? t("{count} items move to {name}, and {from} is removed.", { count: String(category.itemCount ?? 0), name: target.name, from: category.name }) : undefined}
      onSubmit={async () => { await catalogApi(workspaceId, `${path}/merge`, { body: { version, intoId } }); onDone(true); }}>
      <SelectField isRequired items={others} label={t("Merge into")} onSelectionChange={(key) => setIntoId(String(key ?? ""))} selectedKey={intoId || null} />
    </FormDialog>;
  }
  const dirty = name.trim() !== category.name || (parentId === TOP ? null : parentId) !== category.parentId;
  return <FormDialog isDirty={dirty} isOpen isSubmitDisabled={!name.trim() || !dirty} onClose={onClose} submitLabel={t("Save")} title={t("Rename or move")}
    onSubmit={async () => {
      await catalogApi(workspaceId, path, { method: "PATCH", body: { version, name: name.trim(), parentId: parentId === TOP ? null : parentId } });
      onDone(false);
    }}>
    <TextInput isRequired label={t("Name")} maxLength={160} onChange={setName} value={name} />
    <SelectField items={[{ id: TOP, label: t("Top level") }, ...others]} label={t("Inside")} onSelectionChange={(key) => setParentId(String(key ?? TOP))} selectedKey={parentId} />
  </FormDialog>;
}
