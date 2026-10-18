"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { Button } from "../components/actions";

/**
 * The one save pattern for settings forms: while something is changed, a bar stays in reach at the
 * bottom of the page ("Unsaved changes · Discard · Save"); after saving it says "Saved" in place.
 * Switches that apply at once don't use it. Pass `form` to submit a form, or `onSave`.
 */
export function SaveBar({ isDirty, isSaving = false, saved = false, message, onDiscard, onSave, form, isDisabled = false }: {
  isDirty: boolean;
  isSaving?: boolean;
  /** The last save finished and nothing has changed since. */
  saved?: boolean;
  /** Replaces "Unsaved changes", e.g. "3 changes". */
  message?: ReactNode;
  onDiscard?: () => void;
  onSave?: () => void;
  /** The id of the form the Save button submits. */
  form?: string;
  isDisabled?: boolean;
}) {
  const t = useT();
  if (!isDirty) return saved ? <p className="wd-save-bar-saved" role="status"><Check aria-hidden="true" size={14} />{t("Saved")}</p> : null;
  return <div aria-label={t("Unsaved changes")} className="wd-save-bar" role="region">
    <span>{message ?? t("Unsaved changes")}</span>
    {onDiscard ? <Button isDisabled={isSaving} onPress={onDiscard} size="compact" variant="quiet">{t("Discard")}</Button> : null}
    <Button form={form} isDisabled={isDisabled} isLoading={isSaving} onPress={form ? undefined : onSave} size="compact" type={form ? "submit" : "button"} variant="primary">{t("Save")}</Button>
  </div>;
}
