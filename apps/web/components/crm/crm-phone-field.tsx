"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogTrigger, ListBox, ListBoxItem, Popover } from "react-aria-components";
import { ChevronDown } from "lucide-react";
import { Button, SearchInput, TextInput, useDesignSystem } from "@/design-system";
import { phoneCountryOptions } from "@/lib/crm/phone";
import styles from "./crm-phone-field.module.css";

export function CrmPhoneField({ label, value, onChange, countryCode, onCountryChange, locale, required = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  countryCode: string;
  onCountryChange: (countryCode: string) => void;
  locale?: string;
  required?: boolean;
}) {
  const countries = useMemo(() => phoneCountryOptions(locale), [locale]);
  const selected = countries.find(country => country.id === countryCode);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { portalContainer } = useDesignSystem();
  const matches = countries.filter(country => `${country.description} ${country.label} ${country.id}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className={styles.phoneField}>
    <div className={styles.codeControl}>
      <span className="wd-field-label">Code</span>
      <DialogTrigger isOpen={open} onOpenChange={value => { setOpen(value); if (!value) setSearch(""); }}>
        <Button className={styles.codeButton} aria-label={`${label} country code`} aria-expanded={open}>
          <span>{selected?.label ?? "Select code"}</span><ChevronDown size={15} aria-hidden="true" />
        </Button>
        <Popover UNSTABLE_portalContainer={portalContainer ?? undefined} className={`wd-popover ${styles.countryPopover}`} placement="bottom start">
          <Dialog aria-label={`${label} country codes`} className={styles.countryDialog}>
            <SearchInput label={`Search ${label.toLowerCase()} country`} placeholder="Search country or code" value={search} onChange={setSearch} autoFocus />
            <ListBox aria-label={`${label} country codes`} className={styles.countryOptions} items={matches} selectionMode="single" selectedKeys={countryCode ? new Set([countryCode]) : new Set()} onSelectionChange={keys => {
              if (keys === "all") return;
              const next = keys.values().next().value;
              if (next) { onCountryChange(String(next)); setOpen(false); }
            }}>
              {country => <ListBoxItem id={country.id} textValue={`${country.description} ${country.label}`} className={styles.countryOption}><span>{country.label}</span><span>{country.description}</span></ListBoxItem>}
            </ListBox>
            {!matches.length ? <p className={styles.noCountries}>No matching country</p> : null}
          </Dialog>
        </Popover>
      </DialogTrigger>
    </div>
    <TextInput label={label} inputType="tel" value={value} onChange={onChange} isRequired={required} />
  </div>;
}
