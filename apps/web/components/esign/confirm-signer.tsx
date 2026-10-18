"use client";

import { useState } from "react";
import { MessageCircle, Mail, ShieldCheck } from "lucide-react";
import { Button, InlineNotice, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { signingApi, SigningView } from "@/lib/proposals/client";
import styles from "./esign.module.css";

/**
 * §0.3 P4: before signing, the signer confirms a one-time code sent to them (WhatsApp first, else email); the
 * certificate names how they were verified. A wrong code uses a try; the right one is confirmed for 30 minutes.
 */
export function ConfirmSigner({ api, code, onConfirmed }: { api: ReturnType<typeof signingApi>; code: NonNullable<SigningView["code"]>; onConfirmed: () => Promise<void> }) {
  const t = useT();
  const [sent, setSent] = useState<{ channel: string; sentTo: string | null } | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (channel: "whatsapp" | "email") => {
    setBusy(true); setError("");
    try { const result = await api.sendCode(channel); setSent({ channel: result.channel, sentTo: result.sentTo }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setError("");
    try {
      const result = await api.verifyCode(value);
      if (result.verified) await onConfirmed(); else setError(result.message ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <section className={styles.confirm} aria-labelledby="confirm-signer">
    <span className={styles.confirmIcon} aria-hidden="true"><ShieldCheck size={18} /></span>
    <div className={styles.confirmBody}>
      <h2 id="confirm-signer" className={styles.confirmTitle}>{t("Enter your code")}</h2>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {sent ? <form className={styles.confirmRow} onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
        <TextInput autoFocus label={t("Six-digit code")} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value}
          onChange={(next) => setValue(next.replace(/\D/g, "").slice(0, 6))} description={sent.sentTo ?? undefined} />
        <Button type="submit" variant="primary" isDisabled={value.length !== 6} isLoading={busy}>{t("Confirm")}</Button>
        <Button variant="quiet" isDisabled={busy} onPress={() => void send(sent.channel === "email" ? "email" : "whatsapp")}>{t("Send a new code")}</Button>
      </form> : <div className={styles.confirmRow}>
        {code.canWhatsapp || code.demo ? <Button variant="primary" isLoading={busy} onPress={() => void send("whatsapp")}><MessageCircle aria-hidden="true" size={15} />{t("Send code by WhatsApp")}</Button> : null}
        {code.canEmail ? <Button variant={code.canWhatsapp ? "secondary" : "primary"} isDisabled={busy} onPress={() => void send("email")}><Mail aria-hidden="true" size={15} />
          {code.canWhatsapp ? t("Send it by email instead") : t("Send a new code")}</Button> : null}
      </div>}
      {code.demo ? <p className={styles.confirmHint}>{t("Demo: the code is 123456.")}</p> : null}
    </div>
  </section>;
}
