"use client";

import { useState } from "react";
import { Button, Form, InlineNotice, PhoneField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { PortalError, type Challenge, type PortalApi } from "@/lib/client-portal/client";
import type { PortalInvite, PortalSite } from "@/lib/client-portal/types";
import { formatPhoneForDisplay, joinPhone, splitPhone } from "@/lib/phone";
import styles from "./portal.module.css";
import { secondsFromNow, useCountdown } from "./use-countdown";

type Channel = "whatsapp" | "email";

/**
 * Sign in with the mobile number the team has for you: a 6-digit code by WhatsApp, or by email when
 * WhatsApp isn't there. The answer never says whether a number has access. From an invitation link the
 * number is already filled in; an expired link says so and lets the client sign in as usual.
 */
export function SignIn({ site, api, invite = null, onSignedIn }: { site: PortalSite; api: PortalApi; invite?: PortalInvite | null; onSignedIn: (needsName: boolean) => void }) {
  const t = useT();
  const invited = invite?.status === "valid" ? splitPhone(invite.phone, site.region.country) : null;
  const [country, setCountry] = useState(invited?.country || site.region.country || "");
  const [national, setNational] = useState(invited?.national ?? "");
  const [channel, setChannel] = useState<Channel>(site.signIn.channels.includes("whatsapp") ? "whatsapp" : "email");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const wait = useCountdown(resendAt);
  const phone = joinPhone(country, national);
  // Isolated so the number keeps its order inside a right-to-left sentence.
  const shownPhone = `\u2066${formatPhoneForDisplay(phone)}\u2069`;

  const send = async (via: Channel) => {
    if (!phone) return setError(t("Enter your mobile number."));
    setBusy(true); setError(""); setWaiting(false);
    try {
      const next = await api.challenge({ phone, channel: via });
      setChannel(via); setChallenge(next); setCode("");
      setResendAt(secondsFromNow(next.resendAfter));
    } catch (cause) {
      const failure = cause as PortalError;
      if (failure.retryAfter) setResendAt(secondsFromNow(failure.retryAfter));
      // "A code is on its way" is information, not a failure.
      setWaiting(failure.status === 429);
      setError(failure.message);
    } finally { setBusy(false); }
  };

  const verify = async () => {
    if (!challenge || !/^\d{6}$/.test(code)) return setError(t("Enter the 6-digit code."));
    setBusy(true); setError("");
    try {
      const result = await api.login({ challengeId: challenge.challengeId, code });
      onSignedIn(result.needsName);
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };

  if (!challenge) return <section className={styles.signIn} aria-labelledby="portal-sign-in">
    <div className={styles.intro}>
      <h1 className={styles.title} id="portal-sign-in">{site.welcomeTitle || t("Welcome")}</h1>
      <p className={styles.lead}>{site.welcomeText || t("Sign in to follow your project.")}</p>
    </div>
    <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send(channel); }}>
      {invite?.status === "expired" ? <InlineNotice tone="info" message={t("This invite link has expired. Sign in with your mobile number, or ask your project team for a new one.")} /> : null}
      {error ? <InlineNotice tone={waiting ? "info" : "error"} message={error} /> : null}
      <PhoneField label={t("Mobile number")} value={national} onChange={setNational} countryCode={country} onCountryChange={setCountry} locale={site.region.locale} isRequired />
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" size="large" isLoading={busy}>{channel === "whatsapp" ? t("Send code by WhatsApp") : t("Send code by email")}</Button>
        {site.signIn.channels.length > 1 ? <Button variant="quiet" size="compact" isDisabled={busy}
          onPress={() => setChannel(channel === "whatsapp" ? "email" : "whatsapp")}>
          {channel === "whatsapp" ? t("Use email instead") : t("Use WhatsApp instead")}</Button> : null}
      </div>
    </Form>
  </section>;

  return <section className={styles.signIn} aria-labelledby="portal-code">
    <div className={styles.intro}>
      <h1 className={styles.title} id="portal-code">{t("Enter your code")}</h1>
      <p className={styles.lead}>{channel === "whatsapp" ? t("If {phone} has access, a 6-digit code is on its way by WhatsApp.", { phone: shownPhone })
        : t("If {phone} has access, a 6-digit code is on its way to the email we have for you.", { phone: shownPhone })}</p>
      {site.signIn.demo ? <p className={styles.muted}>{t("Demo: the code is 123456.")}</p> : null}
    </div>
    <Form className={styles.form} onSubmit={(event) => { event.preventDefault(); void verify(); }}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <div className={styles.codeInput}>
        <TextInput label={t("Code")} value={code} onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code"
          maxLength={6} isRequired autoFocus />
      </div>
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" size="large" isLoading={busy} isDisabled={code.length !== 6}>{t("Sign in")}</Button>
      </div>
      <div className={styles.links}>
        <Button variant="quiet" size="compact" isDisabled={busy || wait > 0} onPress={() => void send(channel)}>
          {wait > 0 ? t("Send a new code in {seconds} s", { seconds: wait }) : t("Send a new code")}</Button>
        {channel === "whatsapp" && site.signIn.channels.includes("email") ? <Button variant="quiet" size="compact" isDisabled={busy || wait > 0}
          onPress={() => void send("email")}>{t("Send it by email instead")}</Button> : null}
        <Button variant="quiet" size="compact" isDisabled={busy} onPress={() => { setChallenge(null); setCode(""); setError(""); }}>{t("Not you? Change number")}</Button>
      </div>
    </Form>
  </section>;
}
