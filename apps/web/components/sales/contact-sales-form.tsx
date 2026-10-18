"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CircleCheck } from "lucide-react";
import { Button, Callout, Checkbox, Form, PhoneField, SelectField, TextAreaField, TextInput } from "@/design-system";
import { useLanguage, useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import {
  DEFAULT_CONSENT,
  DEFAULT_THANK_YOU_MESSAGE,
  DEFAULT_THANK_YOU_TITLE,
  FIELD_LABELS,
  type PublicSalesForm,
  type SalesFormField,
} from "@/lib/sales/contact-form";
import { countryFromLocale } from "@/lib/workspace/region-labels";
import { countryOptions } from "@/lib/workspace/regional-options";
import styles from "./contact-sales-form.module.css";

type Answers = { name: string; email: string; company: string; country: string; phone: string; teamSize: string; message: string };
const EMPTY: Answers = { name: "", email: "", company: "", country: "", phone: "", teamSize: "", message: "" };
const UTM = ["source", "medium", "campaign", "term", "content"] as const;

/**
 * Wodana's "Contact sales" form, built from the configuration operators keep in Wodana Control. A hidden
 * honeypot field and the time spent on the form keep scripts out; the server also limits each connection.
 */
export function ContactSalesForm({ form, source, preview = false, headingLevel = 2 }: {
  form: PublicSalesForm;
  /** Where the enquiry came from (the landing page or /contact-sales). */
  source: string;
  /** In Wodana Control: the same form, nothing is sent. */
  preview?: boolean;
  headingLevel?: 1 | 2;
}) {
  const t = useT();
  const { language } = useLanguage();
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [phoneCountry, setPhoneCountry] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [requestId] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [received, setReceived] = useState<{ title: string | null; message: string | null } | null>(null);
  const startedAt = useRef(0);
  useEffect(() => { startedAt.current = Date.now(); }, []);

  const countries = useMemo(() => countryOptions(language), [language]);
  const fields = form.fields;
  const label = (field: SalesFormField) => fields[field].label ?? t(FIELD_LABELS[field]);
  const set = (field: keyof Answers) => (value: string) => setAnswers((previous) => ({ ...previous, [field]: value }));
  const chooseCountry = (country: string) => {
    setAnswers((previous) => ({ ...previous, country }));
    // The phone code follows the country until the visitor picks one themselves.
    if (!answers.phone) setPhoneCountry(country);
  };
  const Heading = headingLevel === 1 ? "h1" : "h2";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (preview || saving) return;
    if (!consent) { setError(t("Confirm that we may contact you about this enquiry.")); return; }
    setSaving(true);
    setError("");
    try {
      const query = new URLSearchParams(window.location.search);
      const utm = Object.fromEntries(UTM.map((key) => [key, query.get(`utm_${key}`)?.slice(0, 150)]).filter(([, value]) => value));
      const response = await fetch("/api/sales/enquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: requestId || crypto.randomUUID(),
          name: answers.name,
          email: answers.email,
          ...(fields.company.enabled && answers.company ? { company: answers.company } : {}),
          ...(fields.country.enabled && answers.country ? { countryCode: answers.country } : {}),
          ...(fields.phone.enabled && answers.phone ? { phone: answers.phone, ...(phoneCountry ? { phoneCountry } : {}) } : {}),
          ...(fields.teamSize.enabled && answers.teamSize ? { teamSize: answers.teamSize } : {}),
          ...(fields.message.enabled && answers.message ? { message: answers.message } : {}),
          consent,
          website,
          elapsedMs: Math.max(0, Date.now() - startedAt.current),
          source,
          pagePath: window.location.pathname.slice(0, 300),
          ...(document.referrer ? { referrer: document.referrer.slice(0, 500) } : {}),
          ...(Object.keys(utm).length ? { utm } : {}),
          locale: language,
        }),
      });
      const result = await response.json().catch(() => ({})) as { message?: string | string[]; thankYouTitle?: string | null; thankYouMessage?: string | null };
      if (!response.ok) {
        const message = Array.isArray(result.message) ? result.message.join(" ") : result.message;
        throw new Error(message || t("Your enquiry could not be sent. Please try again."));
      }
      setReceived({ title: result.thankYouTitle ?? form.thankYouTitle, message: result.thankYouMessage ?? form.thankYouMessage });
    } catch (failure) {
      setError(failure instanceof Error ? translateKnown(t, failure.message) : t("Please try again."));
    } finally {
      setSaving(false);
    }
  };

  if (received) {
    return <div aria-live="polite" className={styles.received} role="status">
      <CircleCheck aria-hidden="true" className={styles.receivedIcon} size={40} strokeWidth={1.6} />
      <Heading className={styles.receivedTitle}>{received.title ?? t(DEFAULT_THANK_YOU_TITLE)}</Heading>
      <p>{received.message ?? t(DEFAULT_THANK_YOU_MESSAGE)}</p>
    </div>;
  }

  return <Form aria-label={t("Contact sales")} className={styles.form} onSubmit={submit}>
    <div className={styles.grid}>
      <TextInput autoComplete="name" isRequired label={label("name")} name="name" onChange={set("name")} value={answers.name} />
      <TextInput autoComplete="email" inputType="email" isRequired label={label("email")} name="email" onChange={set("email")} value={answers.email} />
      {fields.company.enabled ? <TextInput autoComplete="organization" isRequired={fields.company.required} label={label("company")} name="company" onChange={set("company")} value={answers.company} /> : null}
      {fields.country.enabled ? <SelectField isRequired={fields.country.required} items={countries} label={label("country")} name="country"
        onSelectionChange={(key) => chooseCountry(key ? String(key) : "")} selectedKey={answers.country || null} /> : null}
      {fields.phone.enabled ? <PhoneField countryCode={phoneCountry || answers.country || countryFromLocale(language) || ""} isRequired={fields.phone.required} kind="any"
        label={label("phone")} onChange={set("phone")} onCountryChange={setPhoneCountry} value={answers.phone} /> : null}
      {fields.teamSize.enabled ? <SelectField isRequired={fields.teamSize.required} items={form.teamSizes} label={label("teamSize")} name="teamSize"
        onSelectionChange={(key) => set("teamSize")(key ? String(key) : "")} selectedKey={answers.teamSize || null} /> : null}
      {fields.message.enabled ? <div className={styles.wide}><TextAreaField isRequired={fields.message.required} label={label("message")} name="message" onChange={set("message")} value={answers.message} /></div> : null}
    </div>
    {/* Honeypot: invisible to people and assistive technology; scripts that fill every field give themselves away. */}
    <div aria-hidden="true" className={styles.trap}>
      <label>{t("Website")}<input autoComplete="off" name="website" onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} type="text" value={website} /></label>
    </div>
    <Checkbox isRequired isSelected={consent} onChange={setConsent}>{form.consentLabel ?? t(DEFAULT_CONSENT)}</Checkbox>
    {error ? <Callout title={t("Not sent")} tone="danger">{error}</Callout> : null}
    <div className={styles.actions}>
      <Button className={styles.submit} isDisabled={preview} isLoading={saving} size="large" type="submit" variant="primary">{t("Contact sales")}</Button>
    </div>
  </Form>;
}
