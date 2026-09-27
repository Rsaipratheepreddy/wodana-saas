"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Form, InlineNotice, Spinner, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { PortalError, type Challenge, type PortalApi } from "@/lib/client-portal/client";
import styles from "../portal.module.css";
import { secondsFromNow, useCountdown } from "../use-countdown";

/**
 * A decision that matters (a quotation, a handover, the material list) is confirmed with a fresh code bound
 * to exactly that decision. The code goes by WhatsApp, or by email as the fallback.
 */
export function ConfirmCode({ api, purpose, channels, confirmLabel, onConfirm, onBack }: {
  api: PortalApi; purpose: string; channels: Array<"whatsapp" | "email">; confirmLabel: string;
  onConfirm: (proof: { challengeId: string; code: string }) => Promise<void>; onBack: () => void;
}) {
  const t = useT();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const wait = useCountdown(resendAt);
  const asked = useRef(false);
  const send = async (channel: "whatsapp" | "email") => {
    setBusy(true); setError(""); setCode("");
    try {
      const next = await api.challenge({ purpose, channel });
      setChallenge(next); setResendAt(secondsFromNow(next.resendAfter));
    } catch (cause) {
      const failure = cause as PortalError;
      if (failure.retryAfter) setResendAt(secondsFromNow(failure.retryAfter));
      setError(failure.message);
    } finally { setBusy(false); }
  };
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    queueMicrotask(() => void send(channels.includes("whatsapp") ? "whatsapp" : "email"));
  });
  const confirm = async () => {
    if (!challenge || !/^\d{6}$/.test(code)) return setError(t("Enter the 6-digit code."));
    setBusy(true); setError("");
    try { await onConfirm({ challengeId: challenge.challengeId, code }); }
    catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  return <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {!challenge && busy ? <Spinner label={t("Sending your code")} /> : null}
    {challenge ? <>
      <p className={styles.body}>{challenge.channel === "email"
        ? challenge.sentTo ? t("We sent a 6-digit code to {email}.", { email: challenge.sentTo }) : t("We sent a 6-digit code to your email.")
        : t("We sent a 6-digit code to your WhatsApp.")}</p>
      <div className={styles.codeInput}>
        <TextInput label={t("Code")} value={code} onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
      </div>
    </> : null}
    <div className={styles.links}>
      <button className={styles.textButton} type="button" disabled={busy || wait > 0} onClick={() => void send(challenge?.channel ?? "whatsapp")}>
        {wait > 0 ? t("Send a new code in {seconds} s", { seconds: wait }) : t("Send a new code")}</button>
      {channels.includes("email") && challenge?.channel !== "email" ? <button className={styles.textButton} type="button" disabled={busy || wait > 0} onClick={() => void send("email")}>
        {t("Send it by email instead")}</button> : null}
    </div>
    <div className={styles.choices}>
      <Button onPress={onBack} isDisabled={busy}>{t("Back")}</Button>
      <Button type="submit" variant="primary" isLoading={busy && Boolean(challenge)} isDisabled={!challenge || code.length !== 6}>{confirmLabel}</Button>
    </div>
  </Form>;
}
