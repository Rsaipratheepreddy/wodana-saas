"use client";

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Image from "next/image";
import { parseDate } from "@internationalized/date";
import { CircleCheck } from "lucide-react";
import { Button, Callout, Checkbox, DateField, FieldCaption, Form, NumericInput, Progress, RadioSet, SelectField, TextAreaField, TextInput } from "@/design-system";

const dateOf = (value: string) => { try { return value ? parseDate(value.slice(0, 10)) : null; } catch { return null; } };
import type { LeadFormQuestion, PublicEnquiryForm } from "@/lib/crm/lead-forms";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { CrmPhoneField } from "./crm-phone-field";
import styles from "./lead-forms.module.css";

export type EnquiryFormLayout = "classic" | "steps";

export function PublicEnquiryFormView({ form, token, preview = false, link, submitTo, extra, bare = false, layout = "classic", onReceived }: {
  form: PublicEnquiryForm; token?: string; preview?: boolean; link?: { source?: string; channel?: string; placement?: string };
  /** Another endpoint for the same form (e.g. the company gallery), with extra fields such as the picked items. */
  submitTo?: string; extra?: Record<string, unknown>; bare?: boolean;
  /** "steps" asks one question per screen (a link or QR code may choose it); "classic" shows them all. */
  layout?: EnquiryFormLayout; onReceived?: () => void;
}) {
  const t = useT();
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [phoneCountries, setPhoneCountries] = useState<Record<string, string>>({});
  const [customAreas, setCustomAreas] = useState<Record<string, boolean>>({});
  const [requestId] = useState(() => crypto.randomUUID());
  // Junk protection (S-13): when the form opened, and a field people never see that scripts fill in.
  const [openedAt] = useState(() => Date.now());
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [received, setReceived] = useState(false);
  const [serviceConsent, setServiceConsent] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const steps = layout === "steps";
  const sections = useRef<Record<string, HTMLElement | null>>({});
  const hintId = useId();
  const emirateQuestion = form.questions.find(question => question.field === "emirate");
  const emirate = String(answers[emirateQuestion?.id ?? ""] ?? "");
  const answered = (question: LeadFormQuestion) => { const value = answers[question.id]; return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim()); };
  const last = form.questions.length;
  const update = (id: string, value: string | string[]) => {
    if (id === emirateQuestion?.id) setCustomAreas(previous => Object.fromEntries(Object.keys(previous).map(key => [key, false])));
    setAnswers(previous => ({ ...previous, [id]: value, ...(id === emirateQuestion?.id ? Object.fromEntries(form.questions.filter(question => question.field === "area").map(question => [question.id, ""])) : {}) }));
  };
  /** In steps, "Next" checks only the question on screen; the browser's own messages show on its fields. */
  const next = () => {
    const question = form.questions[step];
    const section = question ? sections.current[question.id] : null;
    const invalid = [...(section?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select") ?? [])].find(control => !control.checkValidity());
    if (invalid) { invalid.reportValidity(); return; }
    if (question?.type === "checkboxes" && question.required && !answered(question)) { setError(t("Choose at least one option.")); return; }
    setError(""); setStep(value => Math.min(last, value + 1));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (!steps || step >= last || event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault(); next();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (preview) return;
    if (steps && step < last) { next(); return; }
    if (!serviceConsent) { setError(t("Confirm that we may contact you about this enquiry.")); return; }
    setSaving(true); setError("");
    try {
      const phoneCountryCodes = Object.fromEntries(form.questions.filter(question => question.type === "tel").map(question => [question.id, phoneCountries[question.id] ?? form.defaultCountryCode ?? ""]));
      const response = await fetch(submitTo ?? `/api/enquiry-forms/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, revision: form.revision, answers, phoneCountryCodes, serviceConsent, ...(link ? { link } : {}), ...(extra ?? {}),
        elapsedMs: Date.now() - openedAt, ...(website ? { website } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(". ") : result.message ?? t("Your enquiry could not be submitted. Please try again."));
      setReceived(true); onReceived?.();
    } catch (failure) { setError(failure instanceof Error ? translateKnown(t, failure.message) : t("Please try again.")); }
    finally { setSaving(false); }
  };
  if (received) return <div className={styles.received} role="status">
    <CircleCheck size={40} aria-hidden="true" />
    <h1>{t("Thank you for your enquiry")}</h1>
    <p>{t("Our team will review your request and get in touch.")}</p>
    {form.branding ? <small>{form.branding.displayName}</small> : null}
  </div>;
  const progress = steps ? step : form.questions.filter(answered).length;
  const onFinalScreen = !steps || step >= last;
  return <Form className={[styles.customerForm, preview && styles.compactPreview].filter(Boolean).join(" ")} data-layout={layout} onSubmit={submit} onKeyDown={onKeyDown}>
    {bare ? null : <header className={styles.customerHeading}>
      {form.branding && <div className={styles.customerBrand}>{form.branding.logoUrl ? <Image src={form.branding.logoUrl} alt={t("{name} logo", { name: form.branding.displayName })} width={140} height={56} unoptimized /> : <strong>{form.branding.displayName}</strong>}</div>}
      <h1>{form.title}</h1>
      {form.description && <p>{form.description}</p>}
      {preview && <p className={styles.previewNotice}>{t("Preview · answers here are not submitted")}</p>}
    </header>}
    {last > 1 ? <div className={styles.customerProgress}><Progress label={t("Form progress")} value={progress} max={last} /><small>{steps ? t("{current} of {total}", { current: Math.min(step + 1, last), total: last }) : t("{count} of {total} answered", { count: progress, total: last })}</small></div> : null}
    {form.questions.map((question, index) => <section key={question.id} data-question-id={question.id} className={styles.customerQuestion} hidden={steps && index !== step} ref={element => { sections.current[question.id] = element; }}>
      {question.field === "area" ? emirate === "other" || !(form.areas?.[emirate]?.length)
        ? <TextInput label={question.title} description={question.description} isRequired={question.required} value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} />
        : <><SelectField label={question.title} description={question.description} isRequired={question.required} items={[...(question.required ? [] : [{ id: "", label: t("Not specified") }]), ...(form.areas?.[emirate] ?? []), { id: "other", label: t("Other area") }]} selectedKey={customAreas[question.id] ? "other" : String(answers[question.id] ?? "")} onSelectionChange={key => { const custom = key === "other"; setCustomAreas(previous => ({ ...previous, [question.id]: custom })); update(question.id, custom ? "" : String(key ?? "")); }} />{customAreas[question.id] ? <TextInput label={t("Area name")} isRequired value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} /> : null}</>
        : question.type === "paragraph" ? <TextAreaField label={question.title} description={question.description} isRequired={question.required} value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} />
        : question.type === "dropdown" ? <SelectField label={question.title} description={question.description} isRequired={question.required} items={question.options} selectedKey={String(answers[question.id] ?? "") || null} onSelectionChange={key => update(question.id, String(key ?? ""))} />
        : question.type === "tel" ? <CrmPhoneField label={question.title} required={question.required} value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} countryCode={phoneCountries[question.id] ?? form.defaultCountryCode ?? ""} onCountryChange={value => setPhoneCountries(previous => ({ ...previous, [question.id]: value }))} locale={form.defaultLocale ?? undefined} />
        : question.type === "radio" ? <RadioSet label={question.title} description={question.description} isRequired={question.required} items={question.options} value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} />
        : question.type === "checkboxes" ? <fieldset className={styles.answerChoices}><legend><FieldCaption isRequired={question.required}>{question.title}</FieldCaption></legend>{question.description && <p>{question.description}</p>}
          {question.options.map(option => <Checkbox key={option.id} isSelected={Array.isArray(answers[question.id]) && answers[question.id].includes(option.id)} onChange={selected => { const current = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : []; update(question.id, selected ? [...current, option.id] : current.filter(value => value !== option.id)); }}>{option.label}</Checkbox>)}
        </fieldset> : question.type === "date" ? <DateField label={question.title} description={question.description} isRequired={question.required} value={dateOf(String(answers[question.id] ?? ""))} onChange={value => update(question.id, value?.toString() ?? "")} />
        : question.type === "number" ? <NumericInput label={question.title} description={question.description} isRequired={question.required} value={answers[question.id] === undefined || answers[question.id] === "" ? undefined : Number(answers[question.id])} onChange={value => update(question.id, String(value))} />
        : <TextInput label={question.title} description={question.description} isRequired={question.required} inputType={question.type === "email" || question.type === "tel" || question.type === "date" ? question.type : "text"} value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} />}
    </section>)}
    <div aria-hidden="true" className={styles.trap}><label>{t("Website")}<input tabIndex={-1} autoComplete="off" name="website" value={website} onChange={(event) => setWebsite(event.target.value)} /></label></div>
    {error && <Callout title={t("Enquiry not submitted")} tone="danger">{error}</Callout>}
    {onFinalScreen && <div className={styles.customerConsent}><Checkbox isRequired isSelected={serviceConsent} onChange={setServiceConsent}>{form.consentLabel}</Checkbox><small>{t("Your details are used only to respond to this enquiry unless you separately choose marketing updates.")}</small></div>}
    <div className={styles.customerFooter}>
      {steps && step > 0 ? <Button variant="quiet" onPress={() => { setError(""); setStep(value => Math.max(0, value - 1)); }}>{t("Back")}</Button> : null}
      {onFinalScreen
        ? <><Button variant="primary" type="submit" isDisabled={!serviceConsent} isLoading={saving} aria-describedby={serviceConsent ? undefined : hintId}>{t("Submit enquiry")}</Button>{serviceConsent ? null : <small id={hintId} className={styles.submitHint}>{t("Tick the box to submit")}</small>}</>
        : <Button variant="primary" onPress={next}>{t("Next")}</Button>}
    </div>
  </Form>;
}
