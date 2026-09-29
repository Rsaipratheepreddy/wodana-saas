"use client";

import { useState } from "react";
import { Dialog, DialogTrigger, Popover } from "react-aria-components";
import { Copy, MessageCircle, Send, Share2 } from "lucide-react";
import { Button, InlineNotice, Skeleton, TextInput, useDesignSystem, usePortalThemeAttributes } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { quoteApi, QuoteShare } from "@/lib/quotation/client";
import styles from "./quote-builder.module.css";

type Api = Pick<ReturnType<typeof quoteApi>, "share" | "resend">;

/** A WhatsApp link that opens the chat with this number and the message already written. */
export const whatsappLink = (phone: string, message: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;

/**
 * Share a sent quote (Q-9): copy the client's portal link, open WhatsApp to a client contact with the message
 * written, or send the notice again (the approved WhatsApp template through the inbox, else email).
 */
export function ShareQuote({ api, onNotice }: { api: Api; onNotice?: (notice: { tone: "success" | "info"; message: string } | null) => void }) {
  const t = useT();
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const [share, setShare] = useState<QuoteShare | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const load = async () => {
    setError("");
    try { setShare(await api.share()); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load the share options.")); }
  };
  const copy = async () => {
    if (!share?.portalUrl) return;
    try { await navigator.clipboard.writeText(share.portalUrl); setCopied(true); } catch { setError(t("Copy didn't work here. Select the link and copy it.")); }
  };
  const resend = async (close: () => void) => {
    setSending(true); setError("");
    try {
      const sent = await api.resend();
      onNotice?.(sent.channel === "whatsapp" ? { tone: "success", message: t("Sent again · WhatsApp") }
        : sent.channel === "email" && sent.emailed.length ? { tone: "success", message: t("Sent again · email to {names}", { names: sent.emailed.join(", ") }) }
          : { tone: "info", message: t("Nothing went out: the client has no WhatsApp template or email set up. Share the link instead.") });
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not send it again.")); }
    finally { setSending(false); }
  };
  return <DialogTrigger onOpenChange={(open) => { if (open) { setCopied(false); void load(); } }}>
    <Button size="compact"><Share2 aria-hidden="true" size={14} />{t("Share")}</Button>
    <Popover {...portalTheme} className="wd-popover" dir={direction} placement="bottom end">
      <Dialog aria-label={t("Share the quote")} className={styles.sharePanel}>{({ close }) => <>
        {!share && !error ? <Skeleton lines={3} /> : null}
        {error ? <InlineNotice tone="error" message={error} /> : null}
        {error && !share ? <Button size="compact" onPress={() => void load()}>{t("Retry")}</Button> : null}
        {share ? <>
          {share.portalUrl ? <div className={styles.shareLink}>
            <TextInput aria-label={t("Portal link")} label={null} isReadOnly value={share.portalUrl} />
            <Button size="compact" onPress={() => void copy()}><Copy aria-hidden="true" size={14} />{copied ? t("Copied") : t("Copy link")}</Button>
          </div> : <InlineNotice tone="info" message={t("The client portal is off, so there is no link to share.")} />}
          {share.contacts.length ? <ul className={styles.shareContacts}>{share.contacts.map((contact) => <li key={contact.id}>
            <a className="wd-button" data-size="compact" href={whatsappLink(contact.phone, share.message)} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden="true" size={14} />{t("WhatsApp {name}", { name: contact.name })}</a>
          </li>)}</ul> : <p className={styles.waiting}>{t("No client contact has a mobile number yet.")}</p>}
          {share.canResend ? <Button size="compact" variant="primary" isLoading={sending} onPress={() => void resend(close)}><Send aria-hidden="true" size={14} />{t("Send again")}</Button> : null}
        </> : null}
      </>}</Dialog>
    </Popover>
  </DialogTrigger>;
}
