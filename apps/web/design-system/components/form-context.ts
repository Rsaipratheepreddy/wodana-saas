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
