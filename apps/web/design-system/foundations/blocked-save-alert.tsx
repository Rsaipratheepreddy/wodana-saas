"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, X } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";

type Blocked = { fields: string[]; key: number };
export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Control = FormControl;

/** The name a person sees for a form control: its field label, else its own label. */
export const fieldName = (control: Control) => {
  const field = control.closest(".wd-field");
  const label = field?.querySelector(".wd-field-label")?.textContent
    ?? control.labels?.[0]?.textContent
    ?? control.getAttribute("aria-label")
    ?? control.name;
  return (label ?? "").replace(/\s*\*\s*$/, "").replace(/\s*·\s*optional$/i, "").trim();
};

/** Takes the person to a control: the visible part of its field (a dropdown's button, not its hidden select). */
export function focusField(control: Control) {
  const field = control.closest(".wd-field");
  // The visible control: a select's hidden native twin (inside aria-hidden) must not take focus.
  const candidates = field ? [...field.querySelectorAll<HTMLElement>("input:not([type=hidden]), textarea, button, [tabindex]:not([tabindex='-1'])")] : [];
  const focusable = candidates.find((element) => !element.closest("[aria-hidden=true]") && element.tabIndex !== -1) ?? control;
  focusable.scrollIntoView?.({ block: "center", behavior: "smooth" });
  focusable.focus?.({ preventScroll: true });
}

/** Controls in document order. */
export const inDocumentOrder = <T extends Node>(nodes: T[]) => [...nodes].sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

/**
 * When the browser blocks a save because required fields are empty, tell the person which ones
 * and take them to the first. Collects the `invalid` events a blocked submit fires on every form
 * inside the provider, so each form gets this without its own code.
 */
export function useBlockedSaveAlert() {
  const t = useT();
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const pending = useRef<Control[] | null>(null);

  const onInvalidCapture = useCallback((event: FormEvent<HTMLElement>) => {
    const control = event.target as Control;
    if (!("validity" in control)) return;
    event.preventDefault(); // replace the browser bubble, which is invisible on hidden dropdown inputs
    // A shared Form names the fields to fix at its own top; it needs no second alert.
    if (control.closest("[data-wd-error-summary]")) return;
    if (!pending.current) {
      pending.current = [];
      // A blocked submit fires one invalid event per field; collect them all before reporting.
      window.setTimeout(() => {
        const controls = inDocumentOrder(pending.current ?? []);
        pending.current = null;
        if (!controls.length) return;
        setBlocked({ fields: [...new Set(controls.map(fieldName))].filter(Boolean), key: Date.now() });
        focusField(controls[0]);
      }, 0);
    }
    pending.current.push(control);
  }, []);

  useEffect(() => {
    if (!blocked) return;
    const timer = window.setTimeout(() => setBlocked(null), 8000);
    return () => window.clearTimeout(timer);
  }, [blocked]);

  const alert = blocked && typeof document !== "undefined" ? createPortal(
    <div className="wd-blocked-save" role="alert" key={blocked.key}>
      <CircleAlert aria-hidden="true" size={16} />
      <div>
        <strong>{t("Not saved yet")}</strong>
        <span>{blocked.fields.length ? t("Complete the required fields: {fields}", { fields: blocked.fields.join(", ") }) : t("Check the highlighted fields.")}</span>
      </div>
      <button aria-label={t("Dismiss")} className="wd-blocked-save-close" onClick={() => setBlocked(null)} type="button"><X aria-hidden="true" size={14} /></button>
    </div>,
    document.body,
  ) : null;

  return { onInvalidCapture, alert };
}

/** App-wide boundary (root layout): every form, including ones in dialogs, gets the blocked-save alert. */
export function BlockedSaveBoundary({ children }: { children: ReactNode }) {
  const { onInvalidCapture, alert } = useBlockedSaveAlert();
  return <div onInvalidCapture={onInvalidCapture} style={{ display: "contents" }}>{children}{alert}</div>;
}
