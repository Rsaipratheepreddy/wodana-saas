"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, InlineNotice, SelectField, SettingsRow, SettingsSection, Skeleton, TextAreaField, TextInput } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { CLOSING_KINDS, CLOSING_LABELS, TEMPLATE_STATUS, type ClosingKind, type ClosingSettings } from "@/lib/crm/inbox";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import styles from "./inbox-parts.module.css";

const HOURS = [1, 2, 3, 4, 5, 6, 8, 12, 24];

/**
 * Settings → Inbox → Closing messages (PLM-137): the three texts a chat can be closed with, {{name}} and {{form_link}}
 * filled in when sent; the enquiry form link; and after how many working hours without a reply "Closing the chat" is
 * offered. Each shows its WhatsApp template's state (sent outside the 24-hour window); the starter templates add them.
 */
export function ClosingMessagesSection({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const [data, setData] = useState<ClosingSettings | null>(null);
  const [draft, setDraft] = useState<{ texts: Record<ClosingKind, string>; formUrl: string; afterHours: number } | null>(null);
  const [failure, setFailure] = useState(""), [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => crmRequest<ClosingSettings>(workspaceId, "inbox/closing-messages").then((next) => {
    setData(next);
    setDraft({ texts: Object.fromEntries(next.messages.map((message) => [message.kind, message.text])) as Record<ClosingKind, string>, formUrl: next.formUrl ?? "", afterHours: next.afterHours });
  }).catch((error: Error) => setFailure(error.message)), [workspaceId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const changed = Boolean(data && draft && (draft.formUrl !== (data.formUrl ?? "") || draft.afterHours !== data.afterHours
    || data.messages.some((message) => draft.texts[message.kind] !== message.text)));
  const save = async () => {
    if (!data || !draft) return;
    const formUrl = draft.formUrl.trim();
    if (formUrl && !/^https:\/\/\S{3,}$/.test(formUrl)) { setFailure(t("Use a full https:// link")); return; }
    setSaving(true); setFailure(""); setNotice("");
    try {
      const texts = Object.fromEntries(data.messages.map((message) => {
        const text = draft.texts[message.kind].trim();
        return [message.kind, !text || text === message.defaultText ? null : text];
      }));
      await crmRequest(workspaceId, "inbox/closing-messages", "PUT", { version: data.version, texts, formUrl: formUrl || null, afterHours: draft.afterHours });
      setNotice(t("Closing messages saved.")); await load();
    } catch (error) { setFailure(error instanceof Error ? error.message : t("The closing messages could not be saved.")); }
    finally { setSaving(false); }
  };
  const canManage = Boolean(data?.canManage);
  return <SettingsSection id="inbox-closing" title={t("Closing messages")}
    actions={canManage ? <Button size="compact" variant="primary" isDisabled={!changed} isLoading={saving} onPress={() => void save()}>{t("Save")}</Button> : null}>
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {!data || !draft ? <Skeleton lines={4} shape="form" /> : <>
      {CLOSING_KINDS.map((kind) => {
        const message = data.messages.find((item) => item.kind === kind)!;
        const status = message.template ? TEMPLATE_STATUS[message.template.providerStatus as keyof typeof TEMPLATE_STATUS] ?? TEMPLATE_STATUS.pending : null;
        return <div key={kind} className={styles.form}>
          <TextAreaField label={t(CLOSING_LABELS[kind])} value={draft.texts[kind]} maxLength={1024} isReadOnly={!canManage}
            onChange={(text) => setDraft((current) => current && { ...current, texts: { ...current.texts, [kind]: text } })} />
          <span className={styles.inline}>
            {canManage ? data.fields.map((field) => <Button key={field} size="compact" variant="quiet"
              onPress={() => setDraft((current) => current && { ...current, texts: { ...current.texts, [kind]: `${current.texts[kind]}{{${field}}}` } })}>{field === "name" ? t("Client first name") : t("Enquiry form link")}</Button>) : null}
            <small>{message.templateCode}</small>
            {status ? <Badge tone={status.tone}>{t(status.label)}</Badge> : <Badge tone="neutral">{t("Not sent to Meta")}</Badge>}
            {message.template && !message.template.matchesText ? <Badge tone="warning">{t("Text changed since it was sent to Meta")}</Badge> : null}
            {kind === "received" && data.sentOnEnquiry ? <Badge tone="neutral">{t("Also sent when an enquiry is created")}</Badge> : null}
          </span>
          {message.templateProblem ? <small className={styles.reason}>{translateKnown(t, message.templateProblem)}</small> : null}
        </div>;
      })}
      <SettingsRow label={t("Enquiry form link")}>
        <TextInput aria-label={t("Enquiry form link")} label={null} inputType="url" maxLength={500} placeholder={data.formLink && !data.formUrl ? data.formLink : "https://"} isReadOnly={!canManage}
          value={draft.formUrl} onChange={(formUrl) => setDraft((current) => current && { ...current, formUrl })} />
      </SettingsRow>
      <SettingsRow label={t("Offer Closing the chat after")}>
        <span className={styles.inline}><SelectField aria-label={t("Offer Closing the chat after")} label={null} isDisabled={!canManage}
          items={[...new Set([...HOURS, draft.afterHours])].sort((a, b) => a - b).map((hours) => ({ id: String(hours), label: hours === 1 ? t("1 working hour") : t("{count} working hours", { count: hours }) }))} selectedKey={String(draft.afterHours)}
          onSelectionChange={(key) => key && setDraft((current) => current && { ...current, afterHours: Number(key) })} /></span>
      </SettingsRow>
    </>}
  </SettingsSection>;
}
