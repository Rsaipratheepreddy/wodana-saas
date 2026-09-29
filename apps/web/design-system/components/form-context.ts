"use client";

import { createContext, useContext } from "react";

/**
 * What the enclosing `Form` tells its fields. Inside a form, required fields carry no mark and the rest say
 * "Optional": fewer marks, and a person scanning the form sees what they may skip. Fields outside a `Form`
 * (filters, toolbars) keep their bare label.
 */
export type FormFieldMarkers = "optional" | "none";
export const FormFieldContext = createContext<{ markers: FormFieldMarkers } | null>(null);

export function useFormFieldContext() {
  return useContext(FormFieldContext);
}

/** ⌘/Ctrl+Enter submits the form from any field, including a multi-line one. */
export function submitOnModEnter(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "defaultPrevented" | "preventDefault" | "target">, form: HTMLFormElement | null) {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.defaultPrevented || !form) return;
  // A part of the form with its own ⌘Enter (an assistant reading pasted text) keeps it.
  if (event.target instanceof Element && event.target.closest("[data-wd-own-enter]")) return;
  event.preventDefault();
  form.requestSubmit();
}
