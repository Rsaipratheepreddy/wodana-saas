"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { Button, Callout, Checkbox, Form, NumericInput, RadioSet, SelectField, TextAreaField, TextInput } from "@/design-system";
import type { PublicEnquiryForm } from "@/lib/crm/lead-forms";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { CrmPhoneField } from "./crm-phone-field";
import styles from "./lead-forms.module.css";

export function PublicEnquiryFormView({ form, token, preview = false, link, submitTo, extra, bare = false, onReceived }: {
  form: PublicEnquiryForm; token?: string; preview?: boolean; link?: { source?: string; channel?: string; placement?: string };
  /** Another endpoint for the same form (e.g. the company gallery), with extra fields such as the picked items. */
  submitTo?: string; extra?: Record<string, unknown>; bare?: boolean; onReceived?: () => void;
}) {
  const t = useT();
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [phoneCountries, setPhoneCountries] = useState<Record<string, string>>({});
  const [customAreas, setCustomAreas] = useState<Record<string, boolean>>({});
  const [requestId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [received, setReceived] = useState(false);
  const [serviceConsent, setServiceConsent] = useState(false);
  const [error, setError] = useState("");
  const emirateQuestion = form.questions.find(question => question.field === "emirate");
  const emirate = String(answers[emirateQuestion?.id ?? ""] ?? "");
  const update = (id: string, value: string | string[]) => {
    if (id === emirateQuestion?.id) setCustomAreas(previous => Object.fromEntries(Object.keys(previous).map(key => [key, false])));
    setAnswers(previous => ({ ...previous, [id]: value, ...(id === emirateQuestion?.id ? Object.fromEntries(form.questions.filter(question => question.field === "area").map(question => [question.id, ""])) : {}) }));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (preview) return;
    if (!serviceConsent) { setError(t("Confirm that we may contact you about this enquiry.")); return; }
    setSaving(true); setError("");
    try {
      const phoneCountryCodes = Object.fromEntries(form.questions.filter(question => question.type === "tel").map(question => [question.id, phoneCountries[question.id] ?? form.defaultCountryCode ?? ""]));
      const response = await fetch(submitTo ?? `/api/enquiry-forms/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, revision: form.revision, answers, phoneCountryCodes, serviceConsent, ...(link ? { link } : {}), ...(extra ?? {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(". ") : result.message ?? t("Your enquiry could not be submitted. Please try again."));
      setReceived(true); onReceived?.();
    } catch (failure) { setError(failure instanceof Error ? translateKnown(t, failure.message) : t("Please try again.")); }
    finally { setSaving(false); }
  };
  if (received) return <div className={styles.received}><h1>{t("Thank you for your enquiry")}</h1><p>{t("Our team will review your request and get in touch.")}</p></div>;
  return <Form className={[styles.customerForm, preview && styles.compactPreview].filter(Boolean).join(" ")} onSubmit={submit}>
    {bare ? null : <header className={styles.customerHeading}>
      {form.branding && <div className={styles.customerBrand}>{form.branding.logoUrl ? <Image src={form.branding.logoUrl} alt={t("{name} logo", { name: form.branding.displayName })} width={140} height={56} unoptimized /> : <strong>{form.branding.displayName}</strong>}</div>}
      <h1>{form.title}</h1>
      {form.description && <p>{form.description}</p>}
      <small>{t("Fields marked * are required.")}</small>
      {preview && <p className={styles.previewNotice}>{t("Preview · answers here are not submitted")}</p>}
    </header>}
    {form.questions.map(question => <section key={question.id} data-question-id={question.id} className={styles.customerQuestion}>
      {question.field === "area" ? emirate === "other" || !(form.areas?.[emirate]?.length)
        ? <TextInput label={question.title} description={question.description} value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} />
        : <><SelectField label={question.title} description={question.description} items={[{ id: "", label: t("Not specified") }, ...(form.areas?.[emirate] ?? []), { id: "other", label: t("Other area") }]} selectedKey={customAreas[question.id] ? "other" : String(answers[question.id] ?? "")} onSelectionChange={key => { const custom = key === "other"; setCustomAreas(previous => ({ ...previous, [question.id]: custom })); update(question.id, custom ? "" : String(key ?? "")); }} />{customAreas[question.id] ? <TextInput label={t("Area name")} isRequired value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} /> : null}</>
        : question.type === "paragraph" ? <TextAreaField label={question.title} description={question.description} isRequired={question.required} value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} />
        : question.type === "dropdown" ? <SelectField label={question.title} description={question.description} isRequired={question.required} items={question.options} selectedKey={String(answers[question.id] ?? "") || null} onSelectionChange={key => update(question.id, String(key ?? ""))} />
        : question.type === "tel" ? <CrmPhoneField label={question.title} required={question.required} value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} countryCode={phoneCountries[question.id] ?? form.defaultCountryCode ?? ""} onCountryChange={value => setPhoneCountries(previous => ({ ...previous, [question.id]: value }))} locale={form.defaultLocale ?? undefined} />
        : question.type === "radio" ? <RadioSet label={question.title} description={question.description} isRequired={question.required} items={question.options} value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} />
        : question.type === "checkboxes" ? <fieldset className={styles.answerChoices}><legend>{question.title}{question.required ? " *" : ""}</legend>{question.description && <p>{question.description}</p>}
          {question.options.map(option => <Checkbox key={option.id} isSelected={Array.isArray(answers[question.id]) && answers[question.id].includes(option.id)} onChange={selected => { const current = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : []; update(question.id, selected ? [...current, option.id] : current.filter(value => value !== option.id)); }}>{option.label}</Checkbox>)}
        </fieldset> : question.type === "number" ? <NumericInput label={question.title} description={question.description} isRequired={question.required} value={answers[question.id] === undefined || answers[question.id] === "" ? undefined : Number(answers[question.id])} onChange={value => update(question.id, String(value))} />
        : <TextInput label={question.title} description={question.description} isRequired={question.required} inputType={question.type === "email" || question.type === "tel" || question.type === "date" ? question.type : "text"} value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} />}
    </section>)}
    {error && <Callout title={t("Enquiry not submitted")} tone="danger">{error}</Callout>}
    <div className={styles.customerConsent}><Checkbox isRequired isSelected={serviceConsent} onChange={setServiceConsent}>{form.consentLabel}</Checkbox><small>{t("Your details are used only to respond to this enquiry unless you separately choose marketing updates.")}</small></div>
    <div className={styles.customerFooter}><Button variant="primary" type="submit" isDisabled={preview} isLoading={saving}>{t("Submit enquiry")}</Button></div>
  </Form>;
}
