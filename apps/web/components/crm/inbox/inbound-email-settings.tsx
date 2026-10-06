"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { Button, InlineNotice, SettingsRow, SettingsSection, Skeleton, useConfirmationDialog } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import type { InboundEmailAddress } from "@/lib/crm/inbox";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./inbox-parts.module.css";

/**
 * Settings → Inbox → Email (PLM-025): the workspace's own inbound address. The firm forwards its enquiries mailbox to
 * it; each email becomes a conversation and replies go out by email. Copy it, make it, or replace it (the old one
 * stops working), with the forwarding steps for Google Workspace and Microsoft 365.
 */
export function InboundEmailSection({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const [data, setData] = useState<InboundEmailAddress | null>(null);
  const [failure, setFailure] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const command = useRef<string | null>(null);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const load = useCallback(async () => {
    try { setData(await crmRequest<InboundEmailAddress>(workspaceId, "inbox/email-address")); setFailure(""); }
    catch (error) { setFailure(error instanceof Error ? error.message : t("The email address could not be loaded.")); }
  }, [workspaceId, t]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const make = async () => {
    if (!data || busy) return;
    // One id per attempt: a retried click lands once.
    command.current ??= crypto.randomUUID();
    setBusy(true); setFailure(""); setNotice("");
    try {
      setData(await crmRequest<InboundEmailAddress>(workspaceId, "inbox/email-address", "POST", { version: data.version, commandId: command.current }));
      command.current = null;
      setNotice(data.address ? t("New address made. Update your forwarding.") : t("Address made."));
    } catch (error) { setFailure(error instanceof Error ? error.message : t("The email address could not be saved.")); await load(); command.current = null; }
    finally { setBusy(false); }
  };
  const copy = async () => {
    if (!data?.address) return;
    try { await navigator.clipboard.writeText(data.address); setNotice(t("Address copied.")); }
    catch { setFailure(t("Copy the address by selecting it.")); }
  };

  return <SettingsSection id="inbox-email" title={t("Email")}>
    {failure ? <InlineNotice tone="error" message={failure} /> : null}
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {!data && !failure ? <Skeleton lines={2} /> : null}
    {data ? <SettingsRow label={t("Inbox address")} hint={data.address ? t("Forward your enquiries mailbox here. Replies go out by email.") : undefined}>
      {!data.available ? <span className={styles.muted}>{t("Not available on this server yet.")}</span>
        : data.address ? <span className={styles.inline}>
          <code className={styles.address} dir="ltr">{data.address}</code>
          <Button size="compact" variant="secondary" onPress={() => void copy()}><Copy aria-hidden="true" size={13} />{t("Copy")}</Button>
          {data.canManage ? <Button size="compact" variant="quiet" isLoading={busy} onPress={() => requestConfirmation({
            title: t("Make a new address?"), body: t("The current address stops working at once."), confirmLabel: t("Make new address"), onConfirm: () => void make(),
          })}><RefreshCw aria-hidden="true" size={13} />{t("New address")}</Button> : null}
        </span>
        : data.canManage ? <Button size="compact" variant="primary" isLoading={busy} onPress={() => void make()}>{t("Create address")}</Button>
        : <span className={styles.muted}>{t("Not set up")}</span>}
    </SettingsRow> : null}
    {data?.address ? <SettingsRow label={t("Forwarding")} align="start">
      <div className={styles.steps}>
        <div><strong>{t("Google Workspace")}</strong><ol>
          <li>{t("In Gmail, open Settings → Forwarding and POP/IMAP.")}</li>
          <li>{t("Add a forwarding address and paste this address.")}</li>
          <li>{t("Gmail's confirmation code arrives here in the Inbox.")}</li>
          <li>{t("Choose Forward a copy of incoming mail, then Save.")}</li>
        </ol></div>
        <div><strong>{t("Microsoft 365")}</strong><ol>
          <li>{t("In Outlook, open Settings → Mail → Forwarding.")}</li>
          <li>{t("Turn on forwarding and paste this address.")}</li>
          <li>{t("Keep a copy of forwarded messages, then Save.")}</li>
          <li>{t("If nothing arrives, ask your administrator to allow external forwarding.")}</li>
        </ol></div>
      </div>
    </SettingsRow> : null}
    {confirmationDialog}
  </SettingsSection>;
}
