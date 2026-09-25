"use client";

import { useId, useState } from "react";
import { Button } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { announceWorkspacePrimaryColor, DEFAULT_WORKSPACE_PRIMARY_COLOR, normalizeWorkspacePrimaryColor } from "@/lib/workspace/primary-color";
import styles from "./company-profile.module.css";

type Saved = { primaryColor: string | null; workspaceVersion: number };

/** The tenant's one brand colour: used by the app, sign-in, email, client portal and documents. */
export function BrandColour({ canManage, primaryColor, workspaceId, workspaceVersion, onSaved, onError }: {
  canManage: boolean;
  primaryColor: string | null;
  workspaceId: string;
  workspaceVersion: number;
  onSaved: (saved: Saved) => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const inputId = useId();
  const saved = normalizeWorkspacePrimaryColor(primaryColor);
  const [draft, setDraft] = useState(saved ?? DEFAULT_WORKSPACE_PRIMARY_COLOR);
  const [isSaving, setIsSaving] = useState(false);
  const shown = normalizeWorkspacePrimaryColor(draft) ?? DEFAULT_WORKSPACE_PRIMARY_COLOR;
  const changed = shown !== (saved ?? DEFAULT_WORKSPACE_PRIMARY_COLOR);

  const save = async (next: string | null) => {
    if (isSaving) return;
    setIsSaving(true); onError("");
    try {
      const response = await fetch("/api/workspace/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, workspaceVersion, primaryColor: next }),
      });
      const payload = await response.json().catch(() => null) as { message?: string; primaryColor?: string | null; workspace?: { version: number } } | null;
      if (!response.ok) throw new Error(payload?.message ?? t("The brand colour could not be saved."));
      const color = payload?.primaryColor ?? null;
      setDraft(color ?? DEFAULT_WORKSPACE_PRIMARY_COLOR);
      announceWorkspacePrimaryColor(color);
      onSaved({ primaryColor: color, workspaceVersion: payload?.workspace?.version ?? workspaceVersion + 1 });
    } catch (error) {
      onError(error instanceof Error ? error.message : t("The brand colour could not be saved."));
    } finally { setIsSaving(false); }
  };

  return (
    <div className={styles.brandColour}>
      <label className={styles.brandSwatch} htmlFor={inputId} style={{ backgroundColor: shown }}>
        <input
          aria-label={t("Brand colour")}
          className={styles.fileInput}
          disabled={!canManage || isSaving}
          id={inputId}
          onChange={(event) => setDraft(event.target.value.toUpperCase())}
          type="color"
          value={shown.toLowerCase()}
        />
      </label>
      <div className={styles.brandColourText}>
        <strong>{t("Brand colour")}</strong>
        <span dir="ltr">{shown}{saved ? "" : ` · ${t("Default")}`}</span>
      </div>
      {canManage && changed ? <Button isDisabled={isSaving} onPress={() => void save(shown)} size="compact" variant="primary">{t("Save colour")}</Button> : null}
      {canManage && changed ? <Button isDisabled={isSaving} onPress={() => setDraft(saved ?? DEFAULT_WORKSPACE_PRIMARY_COLOR)} size="compact" variant="quiet">{t("Cancel")}</Button> : null}
      {canManage && !changed && saved ? <Button isDisabled={isSaving} onPress={() => void save(null)} size="compact" variant="quiet">{t("Use default")}</Button> : null}
    </div>
  );
}
