"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, ControlledModalDialog, EmailInput, InlineNotice, PhoneField, SelectField, Skeleton, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { staffPortalApi } from "@/lib/client-portal/client";
import type { PortalContact } from "@/lib/client-portal/types";
import type { IssueDelivery } from "@/lib/quotation/client";
import { joinPhone, phoneCountry } from "@/lib/phone";
import styles from "./quote-builder.module.css";

type Contacts = { contacts: PortalContact[]; canManage: boolean; demo: boolean };

/**
 * Sending a quote asks who decides for the client. With none on the case, whoever sends quotes adds the
 * decision-maker here (name from the client record); with several, they choose. It says how the client will
 * hear, so "Sent" only ever claims what goes out.
 */
export function SendQuoteDialog({ workspaceId, caseId, quoteLabel, clientName, busy, onClose, onSend }: {
  workspaceId: string; caseId: string; quoteLabel: string; clientName: string; busy: boolean;
  onClose: () => void; onSend: (approverId: string) => void;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const api = useMemo(() => staffPortalApi(workspaceId, t), [workspaceId, t]);
  const [state, setState] = useState<Contacts | null>(null);
  const [error, setError] = useState("");
  const [approverId, setApproverId] = useState<string>("");
  const country = phoneCountry(null, locale) ?? "";
  const [draft, setDraft] = useState({ name: clientName, country, national: "", email: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api.contacts(caseId).then((next) => { if (!alive) return; setState(next); const deciders = next.contacts.filter((contact) => contact.active && contact.role === "approver"); if (deciders.length === 1) setApproverId(deciders[0].id); })
      .catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [api, caseId]);

  const deciders = (state?.contacts ?? []).filter((contact) => contact.active && contact.role === "approver");
  const chosen = deciders.find((contact) => contact.id === approverId) ?? null;
  const addDecider = async () => {
    setSaving(true); setError("");
    try {
      const next = await api.saveContact(caseId, { name: draft.name.trim(), phone: joinPhone(draft.country, draft.national), email: draft.email.trim() || null,
        role: "approver", active: true, testContact: state?.demo ?? false });
      setState(next);
      const added = next.contacts.find((contact) => contact.active && contact.role === "approver" && contact.name === draft.name.trim());
      if (added) setApproverId(added.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setSaving(false); }
  };

  return <ControlledModalDialog isOpen size="md" title={t("Send {quote} to {client}?", { quote: quoteLabel, client: clientName })} onOpenChange={(open) => { if (!open && !busy) onClose(); }}
    footer={<div className="wd-dialog-actions">
      <Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!chosen} onPress={() => chosen && onSend(chosen.id)}>{t("Send to client")}</Button>
    </div>}>
    {!state && !error ? <Skeleton lines={3} /> : null}
    {state ? <div className={styles.dialogForm}>
      {deciders.length > 1 ? <SelectField label={t("Who decides")} isRequired placeholder={t("Choose someone")} selectedKey={approverId || null}
        onSelectionChange={(key) => setApproverId(String(key))} items={deciders.map((contact) => ({ id: contact.id, label: contact.confirmedName ?? contact.name }))} /> : null}
      {chosen ? <InlineNotice tone="info" message={chosen.email
        ? t("{name} sees it in their portal and gets it by message or email.", { name: chosen.confirmedName ?? chosen.name })
        : t("{name} sees it in their portal. They have no email, so share the portal link if WhatsApp isn't set up.", { name: chosen.confirmedName ?? chosen.name })} /> : null}
      {!deciders.length && state.canManage ? <>
        <InlineNotice tone="info" message={t("Add the client's decision-maker: they sign in with their mobile number and decide in their portal.")} />
        <TextInput label={t("Name")} isRequired value={draft.name} onChange={(name) => setDraft({ ...draft, name })} maxLength={160} />
        <PhoneField label={t("Mobile number")} value={draft.national} countryCode={draft.country} locale={locale} isRequired
          onChange={(national) => setDraft({ ...draft, national })} onCountryChange={(next) => setDraft({ ...draft, country: next })} />
        <EmailInput label={t("Email")} value={draft.email} onChange={(email) => setDraft({ ...draft, email })} maxLength={254} />
        <div className={styles.formActions}><span className={styles.spacer} />
          <Button size="compact" isLoading={saving} isDisabled={!draft.name.trim() || !draft.national.trim()} onPress={() => void addDecider()}>{t("Add decision-maker")}</Button>
        </div>
      </> : null}
      {!deciders.length && !state.canManage ? <InlineNotice tone="error" message={t("Nobody decides for this client yet. Ask someone who manages client access to add the decision-maker.")} /> : null}
    </div> : null}
    {error ? <InlineNotice tone="error" message={error} /> : null}
  </ControlledModalDialog>;
}

/** Exactly what went out when a quote was sent: one line for the sender (Q-22). */
export function deliveryMessage(sent: IssueDelivery, t: ReturnType<typeof useT>): { tone: "success" | "info"; message: string } {
  if (sent.channel === "whatsapp") return { tone: "success", message: t("Sent · WhatsApp to {name}", { name: sent.decider }) };
  if (sent.channel === "email" && sent.emailed.length) return { tone: "success", message: t("Sent · email to {names}", { names: sent.emailed.join(", ") }) };
  const why = sent.reason === "hidden" ? t("the Decisions section is hidden for this project")
    : sent.reason === "not_sent" ? t("they turned these emails off")
      : sent.reason === "template_missing" ? t("the email template is missing")
        : t("nobody on the case has an email address");
  return { tone: "info", message: t("In {name}'s portal. No message went out: {why}. Share the portal link with them.", { name: sent.decider, why }) };
}
