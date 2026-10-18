"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button as AriaButton, Dialog, DialogTrigger, ListBox, ListBoxItem, Popover } from "react-aria-components";
import { ChevronDown } from "lucide-react";
import { getExampleNumber, isSupportedCountry, type CountryCode } from "libphonenumber-js/max";
import mobileExamples from "libphonenumber-js/examples.mobile.json";
import { useT } from "@/lib/i18n/i18n-provider";
import { groupNational, joinPhone, phoneCountry, phoneCountryOptions, phoneProblem, phoneProblemText, splitPhone, toE164 } from "@/lib/phone";
import { countryFromLocale } from "@/lib/workspace/region-labels";
import { useDesignSystem } from "../foundations/provider";
import { SearchInput, TextInput } from "./forms";

export type PhoneFieldProps = {
  label: string;
  /** The local number. A full "+971…" value is split into the country code and the local number. */
  value: string;
  onChange: (national: string) => void;
  countryCode: string;
  onCountryChange: (countryCode: string) => void;
  locale?: string;
  isRequired?: boolean;
  /** Check that the number is a mobile (default), or accept any valid number. */
  kind?: "mobile" | "any";
  description?: string;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  autoFocus?: boolean;
  /** Warns under the field without blocking the save (an existing client with this number). */
  notice?: ReactNode;
  /** A problem the form found itself (required, or refused by the server); shown as the field's error. */
  errorMessage?: string;
};

/**
 * One phone control for every form: the country code sits inside the field, the number is checked
 * against that country, and a pasted or stored international number never repeats the code. Until a
 * country is chosen, the workspace region's country is used (and kept once a number is typed).
 */
export function PhoneField({ label, value, onChange, countryCode: chosenCountry, onCountryChange, locale: localeProp, isRequired, kind = "mobile", description, isDisabled, isReadOnly, autoFocus, notice, errorMessage }: PhoneFieldProps) {
  const t = useT();
  const { portalContainer, locale: regionLocale, regionLocale: workspaceLocale } = useDesignSystem();
  const locale = localeProp ?? regionLocale;
  const regionCountry = countryFromLocale(localeProp ?? workspaceLocale);
  const countryCode = chosenCountry || (regionCountry && isSupportedCountry(regionCountry) ? regionCountry : "");
  const countries = useMemo(() => phoneCountryOptions(locale), [locale]);
  const selected = countries.find((country) => country.id === countryCode);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  // A country whose name starts with what was typed comes first ("India" before "British Indian Ocean Territory").
  const matches = query ? countries.filter((country) => `${country.description} ${country.label} ${country.id}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(!a.description.toLocaleLowerCase().startsWith(query)) - Number(!b.description.toLocaleLowerCase().startsWith(query))) : countries;

  // A stored "+971…" (or one set by another form) is shown as code + local number.
  // Only acts while the value still carries a code, so it settles after one pass.
  useEffect(() => {
    if (!/^\s*(\+|00)/.test(value)) return;
    const next = splitPhone(value, countryCode);
    if (next.country !== chosenCountry) onCountryChange(next.country);
    if (next.national !== value) onChange(next.national);
  }, [value, countryCode, chosenCountry, onChange, onCountryChange]);

  // What the input shows: while it has focus, what the person typed; otherwise the number grouped the local way
  // ("50 742 1938" beside +971). The value reported stays the plain local number, so saved data doesn't change.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? groupNational(value, countryCode);
  const type = (raw: string) => {
    const next = splitPhone(raw, countryCode);
    if (next.country && next.country !== chosenCountry) onCountryChange(next.country);
    const international = /^\s*(\+|00)/.test(raw);
    setDraft(international ? groupNational(next.national, next.country || countryCode) : raw);
    onChange(international ? next.national : raw);
  };
  const tidy = () => {
    setDraft(null);
    if (value.trim()) setTouched(true);
    const next = splitPhone(value, countryCode);
    if (next.national !== value) onChange(next.national);
  };

  const example = countryCode && isSupportedCountry(countryCode) ? getExampleNumber(countryCode as CountryCode, mobileExamples) : undefined;
  // Checked against the country chosen now. The same check blocks a save (the browser's validity) and, once the person
  // has left the field or changed the country, shows under it and follows every change of the number or the country.
  const problem = isReadOnly || isDisabled ? null : phoneProblem(value, countryCode, phoneProblemText(t), { mobile: kind === "mobile", locale });
  const [touched, setTouched] = useState(false);
  const [checkedCountry, setCheckedCountry] = useState(countryCode);
  if (checkedCountry !== countryCode) { setCheckedCountry(countryCode); if (value.trim()) setTouched(true); }
  const shownError = errorMessage || (touched && problem ? problem : undefined);
  // Shown: invalid with this message. Touched and valid: valid now, whatever an earlier check left on screen.
  const isInvalid = shownError ? true : touched && value.trim() ? false : undefined;

  const picker = <DialogTrigger isOpen={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(""); }}>
    <AriaButton aria-label={t("{label} country code", { label })} className="wd-phone-code">
      <span>{selected?.label ?? t("Code")}</span><ChevronDown aria-hidden="true" size={14} />
    </AriaButton>
    <Popover UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-phone-popover" placement="bottom start">
      <Dialog aria-label={t("{label} country codes", { label })} className="wd-phone-dialog">
        <SearchInput autoFocus label={t("Search country or code")} onChange={setSearch} placeholder={t("Search country or code")} value={search} />
        <ListBox aria-label={t("{label} country codes", { label })} className="wd-phone-options" items={matches} selectionMode="single"
          selectedKeys={countryCode ? new Set([countryCode]) : new Set()}
          onSelectionChange={(keys) => {
            if (keys === "all") return;
            const next = keys.values().next().value;
            if (next) { onCountryChange(String(next)); setOpen(false); }
          }}>
          {(country) => <ListBoxItem className="wd-phone-option" id={country.id} textValue={`${country.description} ${country.label}`}><span>{country.label}</span><span>{country.description}</span></ListBoxItem>}
        </ListBox>
        {!matches.length ? <p className="wd-phone-empty">{t("No matching country")}</p> : null}
      </Dialog>
    </Popover>
  </DialogTrigger>;

  const field = <TextInput autoFocus={autoFocus} description={description} inputType="tel" isDisabled={isDisabled} isReadOnly={isReadOnly} isRequired={isRequired} label={label} onFocus={() => setDraft(shown)} onBlur={tidy} onChange={type}
    placeholder={example ? example.formatNational() : undefined} prefix={picker} validate={() => problem} value={shown} errorMessage={shownError} isInvalid={isInvalid} />;
  return notice ? <div className="wd-field-with-notice">{field}<div aria-live="polite" className="wd-field-notice">{notice}</div></div> : field;
}

/**
 * A phone kept as one international number ("+9715…"): typed as a country and a local number, stored exact
 * when it is valid. For records that hold a single phone string.
 */
export function PhoneNumberField({ value, onChange, kind = "any", ...props }: Omit<PhoneFieldProps, "value" | "onChange" | "countryCode" | "onCountryChange"> & { value: string; onChange: (value: string) => void }) {
  const { regionLocale } = useDesignSystem();
  // What was typed stays as typed; the stored value is one international number.
  const [phone, setPhone] = useState(() => splitPhone(value, phoneCountry(null, regionLocale) ?? ""));
  const [sent, setSent] = useState(value);
  if (value !== sent) { setSent(value); setPhone(splitPhone(value, phone.country)); }
  // A pasted number may report its country and its local part one after the other: build on the latest.
  const latest = useRef(phone);
  useEffect(() => { latest.current = phone; }, [phone]);
  const change = (patch: Partial<{ country: string; national: string }>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next; setPhone(next);
    const stored = next.national.trim() ? toE164(next.national, next.country) ?? joinPhone(next.country, next.national) : "";
    setSent(stored); onChange(stored);
  };
  return <PhoneField {...props} countryCode={phone.country} kind={kind} onChange={(national) => change({ national })} onCountryChange={(country) => change({ country })} value={phone.national} />;
}
