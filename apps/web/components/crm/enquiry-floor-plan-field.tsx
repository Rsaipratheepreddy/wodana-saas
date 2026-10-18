"use client";

import { useEffect, useState } from "react";
import { RadioSet, SelectField, TextInput } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import type { FloorPlan } from "@/lib/crm/lead-options";
import type { RequirementNote } from "@/lib/crm/note-document";
import { useT } from "@/lib/i18n/i18n-provider";

/**
 * §0.3 P0: the enquiry's floor plan: one of its files, not available yet with a size estimate, or not needed.
 * A new enquiry has no files yet, so Uploaded opens once it is saved.
 */
export function EnquiryFloorPlanField({ workspaceId, leadId, value, onChange, isRequired, errorMessage, allowNotNeeded = true }: {
  workspaceId: string; leadId?: string; value: FloorPlan | undefined; onChange: (next: FloorPlan | undefined) => void;
  isRequired?: boolean; errorMessage?: string;
  /** Guide D: "Not needed" is for furniture-only enquiries. */
  allowNotNeeded?: boolean;
}) {
  const t = useT();
  const [files, setFiles] = useState<Array<{ id: string; label: string }> | null>(null);
  const wantsFiles = value?.status === "uploaded" && Boolean(leadId);
  useEffect(() => {
    if (!wantsFiles || files) return;
    const controller = new AbortController();
    crmRequest<{ items: RequirementNote[] }>(workspaceId, `leads/${leadId}/requirement-notes`, "GET", undefined, controller.signal)
      .then((data) => setFiles(data.items.filter((note) => !note.archived).flatMap((note) => (note.assets ?? []).map((asset) => ({ id: asset.id, label: asset.name })))))
      .catch(() => { if (!controller.signal.aborted) setFiles([]); });
    return () => controller.abort();
  }, [wantsFiles, files, workspaceId, leadId]);
  const set = (next: Partial<FloorPlan>) => onChange({ ...(value ?? { status: "not_available" }), ...next });
  return <div data-problem-key="floorPlan">
    <RadioSet label={t("Floor plan")} isRequired={isRequired} value={value?.status ?? null} errorMessage={errorMessage} isInvalid={Boolean(errorMessage)}
      onChange={(status) => set({ status: status as FloorPlan["status"] })}
      items={[
        { id: "uploaded", label: t("Uploaded"), isDisabled: !leadId },
        { id: "not_available", label: t("Not available yet") },
        ...(allowNotNeeded || value?.status === "not_required" ? [{ id: "not_required", label: t("Not needed") }] : []),
      ]} />
    {value?.status === "uploaded" && leadId ? <SelectField label={t("File")} isRequired placeholder={files?.length === 0 ? t("No files on this enquiry") : t("Choose a file")}
      isDisabled={!files?.length} items={files ?? []} selectedKey={value.assetId || null} onSelectionChange={(key) => set({ assetId: String(key ?? "") || undefined })} /> : null}
    {value?.status === "uploaded" || value?.status === "not_available" ? <TextInput label={t("Built-up area")} isRequired={value.status === "not_available"} maxLength={120}
      value={value.builtUpArea ?? ""} onChange={(builtUpArea) => set({ builtUpArea })} /> : null}
    {value?.status === "uploaded" || value?.status === "not_available" ? <TextInput label={t("Plot size")} maxLength={120}
      value={value.plotSize ?? ""} onChange={(plotSize) => set({ plotSize })} /> : null}
  </div>;
}
