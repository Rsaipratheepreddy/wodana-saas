"use client";

import { useState, type FormEvent } from "react";
import { Button, Callout, Checkbox, SelectField, TextAreaField, TextInput } from "@/design-system";
import type { PublicEnquiryForm } from "@/lib/crm/lead-forms";
import styles from "./lead-forms.module.css";

export function PublicEnquiryFormView({ form, token, preview = false }: { form: PublicEnquiryForm; token?: string; preview?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [requestId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [received, setReceived] = useState(false);
  const [error, setError] = useState("");
  const update = (id: string, value: string | string[]) => setAnswers(previous => ({ ...previous, [id]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (preview) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/enquiry-forms/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, revision: form.revision, answers }) });
      const result = await response.json();
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(". ") : result.message ?? "Your enquiry could not be submitted. Please try again.");
      setReceived(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setSaving(false); }
  };
  if (received) return <div className={styles.received}><h1>Thank you for your enquiry</h1><p>Our team will review your request and get in touch.</p></div>;
  return <form className={styles.customerForm} onSubmit={submit}>
    <header className={styles.customerHeading}><h1>{form.title}</h1>{form.description && <p>{form.description}</p>}<small>Fields marked * are required.</small></header>
    {preview && <p className={styles.previewNotice}>Preview · answers entered here are not submitted.</p>}
    {form.questions.map(question => <section key={question.id} data-question-id={question.id} className={styles.customerQuestion}>
      {question.type === "paragraph" ? <TextAreaField label={question.title} description={question.description} isRequired={question.required} value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} />
        : question.type === "dropdown" ? <SelectField label={question.title} description={question.description} isRequired={question.required} items={question.options} selectedKey={String(answers[question.id] ?? "") || null} onSelectionChange={key => update(question.id, String(key ?? ""))} />
        : question.type === "radio" || question.type === "checkboxes" ? <fieldset className={styles.answerChoices}><legend>{question.title}{question.required ? " *" : ""}</legend>{question.description && <p>{question.description}</p>}
          {question.options.map(option => question.type === "checkboxes" ? <Checkbox key={option.id} isSelected={Array.isArray(answers[question.id]) && answers[question.id].includes(option.id)} onChange={selected => { const current = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : []; update(question.id, selected ? [...current, option.id] : current.filter(value => value !== option.id)); }}>{option.label}</Checkbox>
            : <label key={option.id} className={styles.radioChoice}><input type="radio" name={question.id} required={question.required} checked={answers[question.id] === option.id} onChange={() => update(question.id, option.id)} value={option.id} />{option.label}</label>)}
        </fieldset> : question.type === "number" || question.type === "date" ? <label className="wd-field"><span className="wd-label">{question.title}{question.required ? " *" : ""}</span><input className="wd-input" type={question.type} required={question.required} value={String(answers[question.id] ?? "")} onChange={event => update(question.id, event.target.value)} />{question.description && <small>{question.description}</small>}</label> : <TextInput label={question.title} description={question.description} isRequired={question.required} inputType={question.type === "email" || question.type === "tel" ? question.type : "text"} value={String(answers[question.id] ?? "")} onChange={value => update(question.id, value)} />}
    </section>)}
    {error && <Callout title="Enquiry not submitted" tone="danger">{error}</Callout>}
    <div className={styles.customerFooter}><p>Your details will be used to respond to this enquiry.</p><Button variant="primary" type="submit" isDisabled={preview} isLoading={saving}>Submit enquiry</Button></div>
  </form>;
}
