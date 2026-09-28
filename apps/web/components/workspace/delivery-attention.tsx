"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Callout, formatDate, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { asDeliveryHealth, type DeliveryHealth } from "@/lib/workspace/delivery-health";
import styles from "./delivery-health.module.css";

/**
 * The owner's Home banner: shown only when messages aren't going out (the delivery service silent for two
 * minutes) or more than 20 notices wait. Anyone without delivery health gets nothing.
 */
export function DeliveryAttention({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [health, setHealth] = useState<DeliveryHealth | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/workspace/delivery-health?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setHealth(asDeliveryHealth(data)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId]);
  if (!health?.attention.reason) return null;
  const waiting = health.channels.reduce((sum, channel) => sum + channel.waiting, 0);
  const since = health.attention.since ? formatDate(health.attention.since, { locale, timeZone }, { dateStyle: "medium", timeStyle: "short" }) : null;
  return <div className={styles.banner} data-delivery-attention={health.attention.reason}>
    <Callout tone="danger" title={health.attention.reason === "worker" ? t("Messages aren't going out") : t("{count} notices are waiting to go out", { count: waiting })}
      actions={<Link className="wd-button" data-size="compact" data-variant="secondary" href="/workspace/settings/delivery">{t("Open delivery")}</Link>}>
      {since ? t("Since {time}.", { time: since }) : t("Emails, WhatsApp messages and pushes are held.")}
    </Callout>
  </div>;
}
