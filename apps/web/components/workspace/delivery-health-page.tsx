"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Callout, EmptyState, InlineNotice, NoAccessState, SettingsPage, SettingsRow, SettingsSection, Skeleton, formatDate, formatRelativeTime, isNoAccessError, useDesignSystem, type StatusTone } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { CHANNEL_LABELS, channelState, failureReason, nextStep, type ChannelState, type DeliveryHealth } from "@/lib/workspace/delivery-health";
import { DeliveryMessages } from "./delivery-messages";
import styles from "./delivery-health.module.css";

const STATE: Record<ChannelState, { label: string; tone: StatusTone }> = {
  working: { label: tKey("Working"), tone: "success" },
  failing: { label: tKey("Not delivering"), tone: "danger" },
  waiting: { label: tKey("Waiting"), tone: "warning" },
  "not-set-up": { label: tKey("Not set up"), tone: "neutral" },
};

async function readHealth(workspaceId: string): Promise<DeliveryHealth> {
  const response = await fetch(`/api/workspace/delivery-health?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "Delivery health didn't load.");
  return data as DeliveryHealth;
}

/** Settings → Connections → Delivery: whether email, WhatsApp and push reach people, and what to do when they don't. */
export function DeliveryHealthPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [health, setHealth] = useState<DeliveryHealth | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const load = useCallback(async () => {
    try { setHealth(await readHealth(workspaceId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Delivery health didn't load.")); }
  }, [workspaceId, t]);
  useEffect(() => {
    queueMicrotask(() => void load());
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const ago = (value: string) => formatRelativeTime(value, { locale });
  const at = (value: string) => formatDate(value, { locale, timeZone }, { dateStyle: "medium", timeStyle: "short" });
  const sendTest = async () => {
    setSending(true); setNotice(null);
    try {
      const response = await fetch(`/api/workspace/delivery-health?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: crypto.randomUUID() }) });
      const data = await response.json().catch(() => null) as { push?: string; message?: string } | null;
      if (!response.ok) throw new Error(data?.message ?? t("The test couldn't be sent."));
      setNotice({ tone: "success", message: data?.push === "queued" ? t("Test sent to your email and phone.") : t("Test sent to your email.") });
      window.setTimeout(() => void load(), 5_000);
    } catch (cause) {
      setNotice({ tone: "error", message: cause instanceof Error ? cause.message : t("The test couldn't be sent.") });
    } finally { setSending(false); }
  };

  if (error && !health) return isNoAccessError(error) ? <NoAccessState area={t("Delivery")} /> : <EmptyState illustration="error" title={t("Delivery health didn't load")} description={error} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!health) return <Skeleton lines={6} shape="form" />;
  const silent = health.worker.status === "stale" || health.worker.status === "not-reporting";
  return <SettingsPage title={t("Delivery")} width="wide" actions={<Button variant="primary" isLoading={sending} onPress={() => void sendTest()}>{t("Send me a test")}</Button>}>
    {notice ? <InlineNotice tone={notice.tone} message={notice.message} /> : null}
    {silent ? <Callout tone="danger" title={t("Messages aren't going out")}>
      {health.worker.lastSeenAt ? t("Nothing has been sent since {time}. Contact support.", { time: at(health.worker.lastSeenAt) }) : t("The delivery service isn't running. Contact support.")}
    </Callout> : null}
    {health.allowlist ? <Callout tone="info" title={t("Test environment")}>{t("Only listed test addresses and numbers receive messages.")}</Callout> : null}
    <SettingsSection id="channels" title={t("Channels")}>
      {health.channels.map((channel) => {
        const state = channelState(channel, health);
        const step = nextStep(t, channel, state);
        const facts = [
          channel.lastSuccessAt ? t("Last sent {time}", { time: ago(channel.lastSuccessAt) }) : t("Nothing sent in 30 days"),
          channel.channel === "push" && channel.devices ? t("{count} phones", { count: channel.devices }) : "",
          channel.waiting ? t("{count} waiting", { count: channel.waiting }) : "",
          channel.failed24h ? t("{count} not delivered in 24 hours", { count: channel.failed24h }) : "",
        ].filter(Boolean);
        return <SettingsRow key={channel.channel} align="start" label={t(CHANNEL_LABELS[channel.channel] as never)}
          hint={step ? (step.href ? <Link href={step.href}>{step.text}</Link> : step.text) : undefined}>
          <div className={styles.channel} data-channel={channel.channel}>
            <Badge tone={STATE[state].tone}>{t(STATE[state].label as never)}</Badge>
            <span className={styles.facts}>{facts.join(" · ")}</span>
            {channel.lastFailure ? <span className={styles.failure}>{t("Last failed {time}: {reason}", { time: ago(channel.lastFailure.at), reason: failureReason(t, channel.lastFailure) })}</span> : null}
          </div>
        </SettingsRow>;
      })}
    </SettingsSection>
    <SettingsSection id="messages" title={t("Messages")}>
      <DeliveryMessages workspaceId={workspaceId} />
    </SettingsSection>
  </SettingsPage>;
}
