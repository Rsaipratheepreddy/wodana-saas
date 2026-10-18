"use client";

import { useState, type ReactNode } from "react";
import { FormDialog, TextAreaField } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";

/**
 * E2-5 / PLM-081: a step this job doesn't need, marked with a reason (who and when are recorded). For material
 * selection it reads "Not required for this order"; the step can't simply be left blank.
 */
export function StepNotNeededDialog({ workspaceId, opportunityId, stepKey, stepName, loadVersion, material, onClose, onDone, secondaryAction }: {
  workspaceId: string; opportunityId: string; stepKey: string; stepName: string; loadVersion: () => Promise<number>; material: boolean; onClose: () => void; onDone: () => void;
  /** Where the step itself is done instead (the case's materials). */
  secondaryAction?: ReactNode;
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [commandId] = useState(() => crypto.randomUUID());
  const valid = reason.trim().length >= 3;
  return <FormDialog title={material ? t("Not required for this order") : t("Not needed for this job")} description={stepName} submitLabel={t("Save")}
    isDirty={Boolean(reason.trim())} isSubmitDisabled={!valid} onClose={onClose} secondaryAction={secondaryAction}
    onSubmit={async () => {
      await crmRequest(workspaceId, `opportunities/${opportunityId}/steps/${stepKey}/skip`, "POST", { version: await loadVersion(), reason: reason.trim(), commandId });
      onDone();
    }}>
    <TextAreaField autoFocus isRequired label={t("Reason")} maxLength={1000} value={reason} onChange={setReason}
      errorMessage={reason && !valid ? t("Say why this step isn't needed") : undefined} />
  </FormDialog>;
}
