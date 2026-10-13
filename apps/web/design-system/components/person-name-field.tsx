"use client";

import { useState } from "react";
import { normalizePersonName, personNameProblem } from "@wodana/contracts/person-name";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { TextInput, type TextInputProps } from "./forms";

/** A digit or a symbol a name never has: refused while it is typed, not only when the field is left. */
const NEVER_IN_A_NAME = /[^\p{L}\p{M}\s'’‘.-]/u;

/** The line under a staff-typed name that can't be saved, or null (an empty name is the field's "Required"). */
export function personNameError(name: string, t: Translate): string | null {
  return personNameProblem(name) === "characters" ? t("Use letters and spaces only") : null;
}

export type PersonNameFieldProps = Omit<TextInputProps, "value" | "onChange" | "inputType"> & {
  value: string; onChange: (value: string) => void;
  /** The name already saved (it may have come from a channel as it is): kept without a check until it is changed. */
  savedValue?: string | null;
};

/**
 * A person's name typed by staff (a customer, a client, a contact): letters of any script and spaces, with a hyphen,
 * an apostrophe or a full stop where names have them. Anything else shows "Use letters and spaces only" under the
 * field and blocks the save; the name is trimmed when the field is left.
 */
export function PersonNameField({ value, onChange, onBlur, errorMessage, isInvalid: invalidFromForm, isReadOnly, isDisabled, savedValue, ...props }: PersonNameFieldProps) {
  const t = useT();
  const [touched, setTouched] = useState(false);
  const unchanged = savedValue != null && normalizePersonName(value) === normalizePersonName(savedValue);
  const problem = isReadOnly || isDisabled || unchanged ? null : personNameError(value, t);
  // A digit or symbol shows at once; an unfinished name ("Al-") waits until the field is left.
  const shownProblem = problem && (touched || NEVER_IN_A_NAME.test(value)) ? problem : undefined;
  // The field's own check is the freshest; otherwise what the form found (required, or refused by the server).
  const shown = shownProblem ?? (invalidFromForm ? errorMessage : undefined);
  // Once left and valid, the field is valid now, whatever an earlier check left on screen.
  const isInvalid = shown || invalidFromForm ? true : touched && value.trim() ? false : undefined;
  return <TextInput {...props} errorMessage={shown} isDisabled={isDisabled} isInvalid={isInvalid} isReadOnly={isReadOnly}
    onBlur={(event) => {
      setTouched(true);
      const tidy = normalizePersonName(value);
      if (tidy !== value && !isReadOnly && !isDisabled) onChange(tidy);
      onBlur?.(event);
    }}
    onChange={onChange} validate={() => problem} value={value} />;
}
