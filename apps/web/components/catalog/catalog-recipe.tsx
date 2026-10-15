"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Badge, Button, InlineNotice } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { COMPONENT_TYPES } from "@/lib/project-core/technical";
import { catalogApi } from "@/lib/workspace/catalog-v2";
import { useRequirementLabels } from "../project-core/project-technical-handover";
import { useProjectFormat } from "../project-core/format";
import type { RecipeComponent } from "./catalog-item-editors";
import styles from "./catalog-page.module.css";

/**
 * PLM-162 / PLM-166: a product's production recipe, grouped by kind (board, fabric, foam, hardware, labour, other), each
 * line with its formula per unit or per batch and, for labour, its hours. The factory verifies it; only then do projects
 * take their quantities from it. Saving the components again clears the verification.
 */
export function CatalogRecipe({ workspaceId, catalogId, item, canEdit, onEdit, onChanged }: {
  workspaceId: string; catalogId: string; canEdit: boolean; onEdit: () => void; onChanged: () => void;
  item: { id: string; version: number; components: RecipeComponent[]; recipeVerified?: { at: string; byName: string | null } | null; canVerifyRecipe?: boolean };
}) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useRequirementLabels();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const verify = async (verified: boolean) => {
    setBusy(true); setError("");
    try { await catalogApi(workspaceId, `${catalogId}/items/${item.id}/recipe-verification`, { body: { version: item.version, verified } }); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  const groups = COMPONENT_TYPES.map((type) => ({ type, lines: item.components.filter((component) => (component.componentType ?? "other") === type) })).filter((group) => group.lines.length);
  return <div className={styles.inspector}>
    {error ? <InlineNotice message={error} tone="error" /> : null}
    <div className={styles.actions}>
      {item.components.length ? <Badge tone={item.recipeVerified ? "success" : "warning"}>{item.recipeVerified
        ? t("Verified by {name} on {date}", { name: item.recipeVerified.byName ?? "", date: format.when(item.recipeVerified.at) }) : t("Not verified")}</Badge> : null}
      {item.components.length && item.canVerifyRecipe ? <Button isLoading={busy} onPress={() => void verify(!item.recipeVerified)} size="compact" variant={item.recipeVerified ? "quiet" : "primary"}>
        {item.recipeVerified ? t("Take back verification") : t("Verify recipe")}</Button> : null}
      {canEdit ? <Button onPress={onEdit} size="compact"><Pencil aria-hidden="true" size={14} />{t("Edit recipe")}</Button> : null}
    </div>
    {item.components.length && !item.recipeVerified ? <p className={styles.muted}>{t("Projects take quantities only from a verified recipe.")}</p> : null}
    {groups.length ? groups.map((group) => <div key={group.type}>
      <p className={styles.muted}>{labels.type[group.type]}</p>
      <ul className={styles.list}>{group.lines.map((component) => <li key={component.componentItemId}>
        <strong>{component.name}</strong>
        <code dir="ltr">{component.quantityFormula}</code>
        <small>{component.unitCode}{component.quantityBasis === "per_batch" && component.batchSize ? ` · ${t("per batch of {count}", { count: Number(component.batchSize) })}` : ""}{component.labourHours ? ` · ${t("{hours} h", { hours: Number(component.labourHours) })}` : ""}</small>
      </li>)}</ul>
    </div>) : <p className={styles.muted}>{t("No components yet")}</p>}
  </div>;
}
