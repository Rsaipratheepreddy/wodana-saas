"use client";

import { useEffect, useMemo, useState } from "react";
import { Button as AriaButton, Dialog, DialogTrigger, ListBox, ListBoxItem, Popover } from "react-aria-components";
import { ChevronDown } from "lucide-react";
import { getExampleNumber, isSupportedCountry, type CountryCode } from "libphonenumber-js/max";
import mobileExamples from "libphonenumber-js/examples.mobile.json";
import { useT } from "@/lib/i18n/i18n-provider";
import { phoneCountryOptions, phoneProblem, splitPhone } from "@/lib/phone";
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
};

/**
 * One phone control for every form: the country code sits inside the field, the number is checked
 * against that country, and a pasted or stored international number never repeats the code.
 */
export function PhoneField({ label, value, onChange, countryCode, onCountryChange, locale, isRequired, kind = "mobile", description }: PhoneFieldProps) {
  const t = useT();
  const { portalContainer } = useDesignSystem();
  const countries = useMemo(() => phoneCountryOptions(locale), [locale]);
  const selected = countries.find((country) => country.id === countryCode);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const matches = query ? countries.filter((country) => `${country.description} ${country.label} ${country.id}`.toLocaleLowerCase().includes(query)) : countries;

  // A stored "+971…" (or one set by another form) is shown as code + local number.
  // Only acts while the value still carries a code, so it settles after one pass.
  useEffect(() => {
    if (!/^\s*(\+|00)/.test(value)) return;
    const next = splitPhone(value, countryCode);
    if (next.country !== countryCode) onCountryChange(next.country);
    if (next.national !== value) onChange(next.national);
  }, [value, countryCode, onChange, onCountryChange]);

  const type = (raw: string) => {
    const next = splitPhone(raw, countryCode);
    if (next.country && next.country !== countryCode) onCountryChange(next.country);
    onChange(/^\s*(\+|00)/.test(raw) ? next.national : raw);
  };
  const tidy = () => {
    const next = splitPhone(value, countryCode);
    if (next.national !== value) onChange(next.national);
  };

  const example = countryCode && isSupportedCountry(countryCode) ? getExampleNumber(countryCode as CountryCode, mobileExamples) : undefined;
  const validate = (current: string) => phoneProblem(current, countryCode, {
    tooShort: (country, code, digits) => `${t("Too short")} — ${country} ${t("mobile numbers are")} ${digits} ${t("digits after")} ${code}`,
    tooLong: (country, code, digits) => `${t("Too long")} — ${country} ${t("mobile numbers are")} ${digits} ${t("digits after")} ${code}`,
    invalid: (country) => `${t("Not a valid number for")} ${country}`,
    notMobile: (country) => `${t("Not a mobile number for")} ${country}`,
    chooseCountry: t("Choose the country code"),
  }, { mobile: kind === "mobile", locale });

  const picker = <DialogTrigger isOpen={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(""); }}>
    <AriaButton aria-label={`${label} ${t("country code")}`} className="wd-phone-code">
      <span>{selected?.label ?? t("Code")}</span><ChevronDown aria-hidden="true" size={14} />
    </AriaButton>
    <Popover UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-phone-popover" placement="bottom start">
      <Dialog aria-label={`${label} ${t("country codes")}`} className="wd-phone-dialog">
        <SearchInput autoFocus label={t("Search country or code")} onChange={setSearch} placeholder={t("Search country or code")} value={search} />
        <ListBox aria-label={`${label} ${t("country codes")}`} className="wd-phone-options" items={matches} selectionMode="single"
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

  return <TextInput description={description} inputType="tel" isRequired={isRequired} label={label} onBlur={tidy} onChange={type}
    placeholder={example ? example.formatNational() : undefined} prefix={picker} validate={validate} value={value} />;
}
