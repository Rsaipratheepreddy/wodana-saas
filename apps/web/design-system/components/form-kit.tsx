"use client";

import { useCallback, useEffect, useEffectEvent, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, CircleAlert, History } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { Button } from "./actions";
import type { FormFieldMarkers } from "./form-context";
import { Form } from "./forms";
import { ControlledModalDialog, useDialogClose } from "./overlays";

/* ── Layout ─────────────────────────────────────────────────────────────────────────────────────────── */

/** A group of related fields with an optional short title. Sections stack in one column. */
export function FormSection({ children, title }: { children: ReactNode; title?: ReactNode }) {
  return <fieldset className="wd-form-section">{title ? <legend className="wd-form-section-title">{title}</legend> : null}{children}</fieldset>;
}

/** Two short, closely related fields side by side (a date and its time); one column on a narrow screen. */
export function FormRow({ children }: { children: ReactNode }) {
  return <div className="wd-form-row">{children}</div>;
}

/**
 * The fields most people skip, folded away under "More details". Stays mounted, so values and validation
 * are kept; it opens by itself when a blocked save needs one of its fields.
 */
export function MoreDetails({ children, defaultOpen = false, filled = 0, isOpen, label, onOpenChange }: {
  children: ReactNode; defaultOpen?: boolean; /** How many of its fields hold a value, shown while folded. */ filled?: number; label?: string;
  /** Controlled: the form opens it itself (after an assistant filled a field inside). */
  isOpen?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = isOpen ?? ownOpen;
  const setOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    setOwnOpen(value); onOpenChange?.(value);
  };
  const region = useId();
  return <div className="wd-more-details" data-open={open || undefined} onInvalidCapture={() => { if (!open) flushSync(() => setOpen(true)); }}>
    <Button aria-controls={region} aria-expanded={open} className="wd-more-details-toggle" onPress={() => setOpen((value) => !value)} size="compact" variant="quiet">
      <ChevronDown aria-hidden="true" size={14} />{label ?? t("More details")}{!open && filled ? <span className="wd-count-chip">{filled}</span> : null}
    </Button>
    <div className="wd-more-details-body" hidden={!open} id={region}>{children}</div>
  </div>;
}

/* ── Drafts ─────────────────────────────────────────────────────────────────────────────────────────── */

export type FormDraft = {
  /** A saved draft was put back into the form when it opened. */
  restored: boolean;
  /** Forget the draft (after a successful save). */
  clear: () => void;
  /** Forget the draft and put the form back as it opened. */
  discard: () => void;
};

const DRAFT_PREFIX = "wodana.draft.v1:";
const DAY = 86_400_000;

function readDraft(key: string, maxAgeDays: number): { value: unknown } | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { savedAt?: number; value?: unknown };
    if (typeof saved.savedAt !== "number" || Date.now() - saved.savedAt > maxAgeDays * DAY) { window.localStorage.removeItem(DRAFT_PREFIX + key); return null; }
    return { value: saved.value };
  } catch { return null; }
}
function writeDraft(key: string, value: unknown) {
  try { window.localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ savedAt: Date.now(), value })); } catch { /* storage full or off: the form still works */ }
}
function removeDraft(key: string) {
  try { window.localStorage.removeItem(DRAFT_PREFIX + key); } catch { /* nothing to remove */ }
}

/**
 * Keeps a form's unsaved changes on this device, so closing it (or losing the tab) loses nothing: opening it
 * again puts them back. `key` names the form and its record (include the workspace and, for an edit, the
 * record's id and version); null turns drafts off. `value` must be plain data.
 */
export function useFormDraft<T>(key: string | null | undefined, value: T, { isDirty, restore, maxAgeDays = 14 }: { isDirty: boolean; restore: (value: T) => void; maxAgeDays?: number }): FormDraft {
  const serialized = JSON.stringify(value ?? null);
  const initial = useRef<{ serialized: string; value: T } | null>(null);
  if (initial.current === null) initial.current = { serialized, value };
  // What needs no draft: the form as it opened, or as it was last saved.
  const baseline = useRef(serialized);
  const latest = useRef({ serialized, isDirty });
  const [restored, setRestored] = useState(false);
  const onRestore = useEffectEvent((saved: T) => restore(saved));

  useEffect(() => { latest.current = { serialized, isDirty }; }, [serialized, isDirty]);

  useEffect(() => {
    if (!key) return;
    const saved = readDraft(key, maxAgeDays);
    if (!saved || JSON.stringify(saved.value ?? null) === initial.current?.serialized) return;
    onRestore(saved.value as T);
    setRestored(true);
  }, [key, maxAgeDays]);

  const skipFirst = useRef(true);
  useEffect(() => {
    if (!key) return;
    // The first pass is the form as it opened; a saved draft may be on its way back in.
    if (skipFirst.current) { skipFirst.current = false; return; }
    const timer = window.setTimeout(() => {
      if (isDirty && serialized !== baseline.current) writeDraft(key, JSON.parse(serialized));
      else removeDraft(key);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [key, serialized, isDirty]);

  // Closing within the debounce keeps the last keystrokes too.
  useEffect(() => () => {
    if (key && latest.current.isDirty && latest.current.serialized !== baseline.current) writeDraft(key, JSON.parse(latest.current.serialized));
  }, [key]);

  const clear = useCallback(() => {
    baseline.current = latest.current.serialized;
    setRestored(false);
    if (key) removeDraft(key);
  }, [key]);
  const discard = useCallback(() => {
    const start = initial.current!;
    baseline.current = start.serialized;
    setRestored(false);
    if (key) removeDraft(key);
    restore(start.value);
  }, [key, restore]);
  return { restored, clear, discard };
}

/** "Restored your draft · Discard", at the top of a form that reopened with a draft. */
export function DraftNotice({ onDiscard }: { onDiscard: () => void }) {
  const t = useT();
  return <p className="wd-draft-notice" role="status"><History aria-hidden="true" size={14} /><span>{t("Restored your draft")}</span><span aria-hidden="true">·</span><button className="wd-text-button" onClick={onDiscard} type="button">{t("Discard")}</button></p>;
}

/* ── Version conflicts ─────────────────────────────────────────────────────────────────────────────── */

/** A save refused because someone else changed the record first (HTTP 409). */
export function isVersionConflict(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error && (error as { status?: unknown }).status === 409;
}

export type FormConflictHandlers = {
  /** Put the latest saved record into the form (the person's changes go). */
  onReload: () => void | Promise<void>;
  /** Take the latest version but keep the person's changes; the form then saves them again. */
  onKeepMine?: () => void | Promise<void>;
};

/** The blocked-save banner for a version conflict: reload the latest, or keep my changes and save over it. */
export function FormConflictBanner({ onKeepMine, onReload }: { onKeepMine?: () => void; onReload: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState<"reload" | "keep" | null>(null);
  const run = (which: "reload" | "keep", action: () => void | Promise<void>) => { setBusy(which); void Promise.resolve(action()).finally(() => setBusy(null)); };
  return <div className="wd-form-banner" data-tone="danger" role="alert">
    <CircleAlert aria-hidden="true" size={16} />
    <strong>{t("Someone else saved a change first")}</strong>
    <div className="wd-form-banner-actions">
      <Button isDisabled={busy !== null} isLoading={busy === "reload"} onPress={() => run("reload", onReload)} size="compact">{t("Reload")}</Button>
      {onKeepMine ? <Button isDisabled={busy !== null} isLoading={busy === "keep"} onPress={() => run("keep", onKeepMine)} size="compact" variant="primary">{t("Keep my changes")}</Button> : null}
    </div>
  </div>;
}

/* ── Footer and keyboard ───────────────────────────────────────────────────────────────────────────── */

/** ⌘/Ctrl+Enter submits the form from any field, including a multi-line one. */
export function submitOnModEnter(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "defaultPrevented" | "preventDefault" | "target">, form: HTMLFormElement | null) {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.defaultPrevented || !form) return;
  // A part of the form with its own ⌘Enter (an assistant reading pasted text) keeps it.
  if (event.target instanceof Element && event.target.closest("[data-wd-own-enter]")) return;
  event.preventDefault();
  form.requestSubmit();
}

/** Cancel, then the primary action at the inline end; other actions (Delete) sit at the inline start. */
export function FormFooter({ cancelLabel, formId, hideSubmit = false, isSubmitDisabled, isSubmitting, onCancel, secondary, submitLabel, submitVariant = "primary" }: {
  cancelLabel?: string; formId: string; hideSubmit?: boolean; isSubmitDisabled?: boolean; isSubmitting?: boolean; onCancel: () => void; secondary?: ReactNode; submitLabel: string; submitVariant?: "primary" | "danger";
}) {
  const t = useT();
  return <div className="wd-form-footer">
    {secondary ? <div className="wd-form-footer-start">{secondary}</div> : null}
    <div className="wd-dialog-actions">
      <Button isDisabled={isSubmitting} onPress={onCancel}>{cancelLabel ?? t("Cancel")}</Button>
      {hideSubmit ? null : <Button aria-keyshortcuts="Meta+Enter Control+Enter" form={formId} isDisabled={isSubmitDisabled} isLoading={isSubmitting} type="submit" variant={submitVariant}>{submitLabel}</Button>}
    </div>
  </div>;
}

function DialogFooter(props: Omit<Parameters<typeof FormFooter>[0], "onCancel">) {
  const close = useDialogClose();
  return <FormFooter {...props} onCancel={close} />;
}

/* ── The dialog ─────────────────────────────────────────────────────────────────────────────────────── */

export type FormDialogProps = {
  /** Defaults to open: most callers render the dialog only while it is open. */
  isOpen?: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  size?: "md" | "lg" | "xl";
  children: ReactNode;
  /** Saves. Throw to keep the dialog open with the error (a 409 shows the conflict banner). */
  onSubmit: (event: FormEvent<HTMLFormElement>) => unknown;
  submitLabel: string;
  submitVariant?: "primary" | "danger";
  cancelLabel?: string;
  isDirty?: boolean;
  isSubmitDisabled?: boolean;
  /** The work is done (saved, but something after it failed): only Cancel/Close is left, so nothing is sent twice. */
  hideSubmit?: boolean;
  /** Busy from outside (a save the caller runs itself). */
  isSubmitting?: boolean;
  /** Actions for the footer's inline start (Delete, Archive). */
  secondaryAction?: ReactNode;
  draft?: FormDraft;
  conflict?: FormConflictHandlers;
  /** An error the caller shows itself (a load failure, or a save it reports). */
  error?: ReactNode;
  errorTitle?: string;
  /** Sits above the fields: an assistant ("Fill with Woddy"), a record context line. */
  lead?: ReactNode;
  formId?: string;
  formClassName?: string;
  fieldMarkers?: FormFieldMarkers;
  /** On a desktop, the first field takes focus when the dialog opens (default). */
  autoFocus?: boolean;
  closeOnSuccess?: boolean;
  isDismissable?: boolean;
};

const FIRST_FIELD = "input:not([type=hidden]):not([disabled]):not([aria-hidden=true]):not([readonly]), textarea:not([disabled]):not([readonly]), .wd-select-button:not([disabled])";

/**
 * Every create and edit dialog: a title, one column of fields, and Cancel then the primary action at the
 * bottom end. Enter in a single-line field and ⌘/Ctrl+Enter anywhere submit; Esc closes (asking first when
 * there are unsaved changes). A blocked save lists the fields to fix at the top; a failed save keeps the
 * dialog open with the reason; a version conflict offers Reload or Keep my changes. With a draft, the
 * changes survive closing and come back with "Restored your draft · Discard".
 */
export function FormDialog({
  autoFocus = true, cancelLabel, children, closeOnSuccess = false, conflict, description, draft, error, errorTitle, fieldMarkers, formClassName, formId: formIdProp,
  hideSubmit, isDirty = false, isDismissable, isOpen = true, isSubmitDisabled, isSubmitting: externalBusy = false, lead, onClose, onSubmit, secondaryAction, size, submitLabel, submitVariant, title,
}: FormDialogProps) {
  const t = useT();
  const generated = useId();
  const formId = formIdProp ?? `form-${generated.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const form = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [resubmit, setResubmit] = useState(0);
  const submitting = busy || externalBusy;

  // Keep my changes: the caller took the latest version; once that renders, save again.
  useEffect(() => { if (resubmit) form.current?.requestSubmit(); }, [resubmit]);

  useEffect(() => {
    if (!isOpen || !autoFocus || typeof window === "undefined" || !window.matchMedia?.("(pointer: fine)").matches) return;
    const timer = window.setTimeout(() => {
      if (form.current?.contains(document.activeElement)) return;
      form.current?.querySelector<HTMLElement>(FIRST_FIELD)?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, autoFocus]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || externalBusy) return;
    inFlight.current = true; setBusy(true); setFailure(null); setConflicted(false);
    try {
      await onSubmit(event);
      draft?.clear();
      if (closeOnSuccess) onClose();
    } catch (cause) {
      if (conflict && isVersionConflict(cause)) setConflicted(true);
      else setFailure(cause instanceof Error && cause.message ? translateKnown(t, cause.message) : t("Could not save."));
    } finally { inFlight.current = false; setBusy(false); }
  };

  const closeNow = (open: boolean) => { if (!open) onClose(); };
  return <ControlledModalDialog description={description} footer={<DialogFooter cancelLabel={cancelLabel} formId={formId} hideSubmit={hideSubmit} isSubmitDisabled={isSubmitDisabled || conflicted} isSubmitting={submitting} secondary={secondaryAction} submitLabel={submitLabel} submitVariant={submitVariant} />}
    isDirty={isDirty && !submitting} isDismissable={isDismissable ?? !submitting} isOpen={isOpen} keepsDraft={Boolean(draft)} onKeyDown={(event) => submitOnModEnter(event, form.current)} onOpenChange={closeNow} size={size} title={title}>
    <Form className={formClassName} fieldMarkers={fieldMarkers} id={formId} onSubmit={(event) => void submit(event)} ref={form}>
      {draft?.restored ? <DraftNotice onDiscard={draft.discard} /> : null}
      {conflicted && conflict ? <FormConflictBanner
        onKeepMine={conflict.onKeepMine ? async () => { await conflict.onKeepMine!(); setConflicted(false); setResubmit((count) => count + 1); } : undefined}
        onReload={async () => { await conflict.onReload(); draft?.clear(); setConflicted(false); }} /> : null}
      {failure || error ? <FormError title={errorTitle ?? t("Not saved")}>{failure ?? error}</FormError> : null}
      {lead}
      {children}
    </Form>
  </ControlledModalDialog>;
}

/** Why a save failed, at the top of the form. */
export function FormError({ children, title }: { children: ReactNode; title: string }) {
  return <div className="wd-form-banner" data-tone="danger" role="alert"><CircleAlert aria-hidden="true" size={16} /><div><strong>{title}</strong><span>{children}</span></div></div>;
}
