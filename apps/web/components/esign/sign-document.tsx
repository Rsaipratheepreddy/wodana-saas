"use client";

import { useState } from "react";
import { Button, Checkbox, Form, FormLayout, FormSection, InlineNotice, PhoneNumberField, SegmentedControl, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { SignaturePad } from "./signature-pad";
import styles from "./esign.module.css";

export type Signature = { kind: "typed"; text: string } | { kind: "drawn"; png: string };
export type SignerInput = { name: string; email: string; phone: string; consent: boolean; signature: Signature };

/**
 * The signer's part of any signed document (R8): who signs (name, email, phone), how (typed or drawn) and the
 * consent to sign electronically. Reused for proposals now and change requests later; the caller sends it.
 */
export function SignDocument({ signer, busy, onSign }: {
  signer: { name: string; email: string | null; phone: string | null };
  busy: boolean;
  onSign: (input: SignerInput) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(signer.name);
  const [email, setEmail] = useState(signer.email ?? "");
  const [phone, setPhone] = useState(signer.phone ?? "");
  const [method, setMethod] = useState<"typed" | "drawn">("typed");
  const [typed, setTyped] = useState("");
  const [drawn, setDrawn] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const signature: Signature | null = method === "typed" ? (typed.trim().length >= 2 ? { kind: "typed", text: typed.trim() } : null) : drawn ? { kind: "drawn", png: drawn } : null;
  const ready = name.trim().length >= 2 && (email.trim() || phone.trim()) && signature && consent && !busy;

  return <Form className={styles.form} fieldMarkers="none" onSubmit={async (event) => {
    event.preventDefault();
    if (!ready || !signature) return;
    setError("");
    try { await onSign({ name: name.trim(), email: email.trim(), phone: phone.trim(), consent, signature }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("That didn't work. Please try again.")); }
  }}><FormLayout footer={<Button type="submit" variant="primary" isLoading={busy} isDisabled={!ready}>{t("Sign")}</Button>}>
    <FormSection title={t("Your details")}>
      <TextInput label={t("Full name")} isRequired autoComplete="name" maxLength={160} value={name} onChange={setName} />
      <TextInput label={t("Email")} inputType="email" autoComplete="email" maxLength={254} value={email} onChange={setEmail} />
      <PhoneNumberField label={t("Phone")} value={phone} onChange={setPhone} />
    </FormSection>
    <FormSection title={t("Your signature")}>
      <SegmentedControl label={t("How to sign")} value={method} onChange={(value) => setMethod(value as "typed" | "drawn")}
        options={[{ id: "typed", label: t("Type") }, { id: "drawn", label: t("Draw") }]} />
      {method === "typed" ? <>
        <TextInput label={t("Type your name to sign")} isRequired maxLength={160} value={typed} onChange={setTyped} />
        {typed.trim() ? <p className={styles.typed} aria-hidden="true">{typed.trim()}</p> : null}
      </> : <SignaturePad label={t("Signature pad")} onChange={setDrawn} />}
    </FormSection>
    <Checkbox isSelected={consent} onChange={setConsent}>{t("I have read this document and agree to sign it electronically. My signature here is as binding as one on paper.")}</Checkbox>
    {error ? <InlineNotice tone="error" message={error} /> : null}
  </FormLayout></Form>;
}
