"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Callout, Checkbox, ControlledModalDialog, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";

type MetaSdk = {
  init: (settings: Record<string, unknown>) => void;
  login: (callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void;
};
declare global { interface Window { FB?: MetaSdk } }
export type WhatsAppSetup = { state: string; appId: string; configId: string; version: string; connectionId: string };
export function isWhatsAppSetup(value: unknown): value is Omit<WhatsAppSetup, "connectionId"> & { mode: "embedded_signup" } {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return data.mode === "embedded_signup" && typeof data.state === "string" && data.state.length >= 20
    && typeof data.appId === "string" && /^\d+$/.test(data.appId)
    && typeof data.configId === "string" && /^\d+$/.test(data.configId)
    && typeof data.version === "string" && /^v\d+\.\d+$/.test(data.version);
}

export function WhatsAppSignup({ setup, workspaceId, onClose }: { setup: WhatsAppSetup | null; workspaceId: string; onClose: () => void }) {
  if (!setup) return null;
  return <Signup key={setup.state} setup={setup} workspaceId={workspaceId} onClose={onClose} />;
}

function Signup({ setup, workspaceId, onClose }: { setup: WhatsAppSetup; workspaceId: string; onClose: () => void }) {
  const t = useT();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pin, setPin] = useState("");
  const [existingApp, setExistingApp] = useState(false);
  const [finished, setFinished] = useState(false);
  const pinRef = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const details = useRef<{ code?: string; waba_id?: string; phone_number_id?: string; submitted?: boolean }>({});
  useEffect(() => {
    let active = true;
    const initialize = () => { if (active) { window.FB?.init({ appId: setup.appId, version: setup.version, xfbml: false }); setReady(Boolean(window.FB)); } };
    const loadError = () => { if (active) setError(t("Meta could not be loaded. Check your connection and try again.")); };
    let script = document.getElementById("wodana-meta-sdk") as HTMLScriptElement | null;
    if (window.FB) initialize();
    else {
      if (!script) { script = document.createElement("script"); script.id = "wodana-meta-sdk"; script.src = "https://connect.facebook.net/en_US/sdk.js"; script.async = true; document.head.appendChild(script); }
      script.addEventListener("load", initialize, { once: true });
      script.addEventListener("error", loadError, { once: true });
    }
    const finish = async () => {
      const current = details.current;
      if (!current.code || !current.waba_id || !current.phone_number_id || current.submitted) return;
      current.submitted = true;
      setFinished(true);
      if (timer.current) clearTimeout(timer.current);
      const response = await fetch(`/api/workspace/integration-connections/${setup.connectionId}/tools`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, action: "whatsapp.complete", payload: { state: setup.state, code: current.code, wabaId: current.waba_id, phoneNumberId: current.phone_number_id, ...(pinRef.current ? { registrationPin: pinRef.current } : {}) } }),
      }).catch(() => null);
      pinRef.current = "";
      if (!active) return;
      setPin("");
      if (response?.ok) window.location.reload();
      else { const payload = await response?.json().catch(() => null); setError(payload?.message ?? t("WhatsApp could not be connected. Reload to check its status.")); setBusy(false); }
    };
    const receive = (event: MessageEvent) => {
      if (!["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin)) return;
      try {
        const message = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (message?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (message.event === "FINISH" || message.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
          if (!/^\d+$/.test(message.data?.waba_id) || !/^\d+$/.test(message.data?.phone_number_id)) return;
          details.current.waba_id = String(message.data.waba_id);
          details.current.phone_number_id = String(message.data.phone_number_id);
          void finish();
        }
      } catch { /* Ignore unrelated or malformed window messages. */ }
    };
    const codeReceived = () => { void finish(); };
    window.addEventListener("message", receive);
    window.addEventListener("wodana-meta-code", codeReceived);
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
      script?.removeEventListener("load", initialize);
      script?.removeEventListener("error", loadError);
      window.removeEventListener("message", receive);
      window.removeEventListener("wodana-meta-code", codeReceived);
    };
  }, [setup, workspaceId, t]);
  return <ControlledModalDialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={t("Connect your WhatsApp Business number")} description={t("Sign in to Meta, choose your own business account and sender, then authorize Wodana.")} footer={<Button isDisabled={!ready || busy || finished || Boolean(pin && !/^\d{6}$/.test(pin))} onPress={() => {
    if (!window.FB) return;
    if (window.location.protocol !== "https:") { setError(t("Meta sign-in needs HTTPS. Open Wodana using its configured HTTPS address.")); return; }
    setBusy(true); setError(""); pinRef.current = pin; details.current = {};
    timer.current = setTimeout(() => { setBusy(false); setFinished(true); setError(t("Meta setup timed out. Reload this page and reconnect to start again.")); details.current.submitted = true; }, 180000);
    window.FB.login((response) => {
      if (!response.authResponse?.code) { if (timer.current) clearTimeout(timer.current); setError(t("Meta authorization was cancelled. You can try again.")); setBusy(false); return; }
      details.current.code = response.authResponse.code;
      window.dispatchEvent(new Event("wodana-meta-code"));
    }, { config_id: setup.configId, response_type: "code", override_default_response_type: true,
      // Coexistence keeps the WhatsApp Business app working on the same number; Meta runs its own onboarding for it.
      extras: { setup: {}, sessionInfoVersion: "3", ...(existingApp ? { featureType: "whatsapp_business_app_onboarding" } : {}) } });
  }} variant="primary">{busy ? t("Completing connection…") : t("Continue with Meta")}</Button>}>
    {error ? <Callout title={t("Connection needs attention")} tone="danger">{error}</Callout> : null}
    <p>{t("Each organization uses its own number. Choose an account you administer. An existing WhatsApp Business app number must complete Meta’s coexistence setup.")}</p>
    <Checkbox isSelected={existingApp} isDisabled={busy} onChange={setExistingApp}>{t("I already use the WhatsApp Business app on this number")}</Checkbox>
    {existingApp ? null : <>
      <TextInput label={t("Registration PIN (only for a new Cloud API sender)")} inputType="password" value={pin} onChange={setPin} isDisabled={busy} />
      <p>{t("For a new sender, enter a six-digit two-step verification PIN and retain it securely. Continuing authorizes registration if Meta reports that this sender is not connected. Wodana does not save the PIN.")}</p>
    </>}
  </ControlledModalDialog>;
}
