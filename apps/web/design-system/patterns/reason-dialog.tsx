"use client";

import { useState, type ReactNode } from "react";
import { FormDialog } from "../components/form-kit";
import { TextAreaField } from "../components/forms";

export type ReasonDialogProps = {
  /** What is being decided ("Cancel this order?", "Put the job on hold"). */
  title: string;
  description?: ReactNode;
  /** The one field's label ("Reason", "What needs to change"). */
  label: string;
  /** The action at the bottom end ("Cancel order", "Send back"). */
  confirmLabel: string;
  /** Danger for an action that ends or removes something. */
  confirmVariant?: "primary" | "danger";
  placeholder?: string;
  /** The text the field opens with (a reason given before). */
  defaultValue?: string;
  maxLength?: number;
  isOpen?: boolean;
  /** Runs with the trimmed reason; throw to keep the dialog open with the error. */
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
};

/**
 * Asks for one required reason before an action (cancel, hold, reject, send back): a title, an optional line under
 * it, one text area, and the action at the bottom end after Cancel. Closes once the action succeeds.
 */
export function ReasonDialog({ title, description, label, confirmLabel, confirmVariant = "primary", placeholder, defaultValue = "", maxLength = 1000, isOpen = true, onConfirm, onClose }: ReasonDialogProps) {
  const [reason, setReason] = useState(defaultValue);
  const trimmed = reason.trim();
  return <FormDialog closeOnSuccess description={description} isDirty={trimmed !== defaultValue.trim()} isOpen={isOpen} isSubmitDisabled={!trimmed}
    onClose={onClose} onSubmit={() => onConfirm(trimmed)} submitLabel={confirmLabel} submitVariant={confirmVariant} title={title}>
    <TextAreaField isRequired label={label} maxLength={maxLength} onChange={setReason} placeholder={placeholder} value={reason} />
  </FormDialog>;
}
