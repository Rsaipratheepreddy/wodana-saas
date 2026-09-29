"use client";

import { useEffect, useState } from "react";
import { Badge, Button, InlineNotice, SettingsRow, Skeleton, TextInput, useDesignSystem } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import styles from "../crm-inbox.module.css";

type Check = { key: "https" | "number" | "templates" | "code_template" | "webhook"; ok: boolean; detail: string | null };
const LABEL: Record<Check["key"], MessageKey> = {
  https: tKey("Secure address (HTTPS)"), number: tKey("Number connected"), templates: tKey("Templates approved"),
  code_template: tKey("Sign-in code template"), webhook: tKey("Client messages arriving"),
};

/**
 * WhatsApp pre-flight (SP-7): what has to be true before clients depend on it, and a test code sent to a number the
 * admin types through the clients' own path (the delivery allowlist applies), so a problem shows here first.
 */
export function WhatsappPreflight({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  useEffect(() => {
    let alive = true;
    crmRequest<{ checks: Check[] }>(workspaceId, "inbox/whatsapp-check").then((result) => { if (alive) setChecks(result.checks); }).catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [workspaceId]);
  const detail = (check: Check) => {
    if (check.key === "templates" && check.detail) { const [approved, pending, rejected] = check.detail.split("/"); return t("{approved} approved · {pending} waiting · {rejected} rejected", { approved, pending, rejected }); }
    if (check.key === "webhook" && check.detail) return t("Last on {date}", { date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(check.detail)) });
    return check.detail ?? undefined;
  };
  const send = async () => {
    setSending(true); setNotice(null);
    try { await crmRequest(workspaceId, "inbox/whatsapp-test", "POST", { phone: phone.trim() }); setNotice({ tone: "success", message: t("Test code sent. Check that phone's WhatsApp.") }); }
    catch (cause) { setNotice({ tone: "error", message: cause instanceof Error ? cause.message : t("The test code could not be sent.") }); }
    finally { setSending(false); }
  };
  if (error) return <InlineNotice tone="error" message={error} />;
  if (!checks) return <Skeleton lines={3} />;
  return <>
    {checks.map((check) => <SettingsRow key={check.key} label={t(LABEL[check.key])} hint={detail(check)}>
      <Badge tone={check.ok ? "success" : "warning"}>{check.ok ? t("Ready") : t("Not yet")}</Badge>
    </SettingsRow>)}
    {canManage ? <SettingsRow label={t("Send a test code")}>
      <span className={styles.inline}>
        <TextInput aria-label={t("Mobile number for the test")} label={null} inputMode="tel" placeholder="+15551234567" value={phone} onChange={setPhone} />
        <Button size="compact" isLoading={sending} isDisabled={!phone.trim()} onPress={() => void send()}>{t("Send")}</Button>
      </span>
    </SettingsRow> : null}
    {notice ? <InlineNotice tone={notice.tone} message={notice.message} /> : null}
  </>;
}
