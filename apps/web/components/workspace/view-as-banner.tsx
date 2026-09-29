"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { exitViewAs, viewAsTimeLeft, type ViewAsSummary } from "@/lib/workspace/view-as";
import styles from "./view-as-banner.module.css";

/**
 * The one sign that someone is viewing the workspace as another person: who, read-only, the time left and
 * Exit. Exit, expiry, or the view ending in another tab all return to the page the viewer came from, as
 * themselves.
 */
export function ViewAsBanner({ viewAs }: { viewAs: ViewAsSummary }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const [leaving, setLeaving] = useState(false);
  const left = useRef(false);
  const { workspaceId, sessionId, returnPath, expiresAt } = viewAs;

  const leave = useCallback(async () => {
    if (left.current) return;
    left.current = true;
    setLeaving(true);
    window.location.assign(await exitViewAs(workspaceId, sessionId, returnPath));
  }, [workspaceId, sessionId, returnPath]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  // Expiry ends the view the same way as Exit.
  useEffect(() => {
    if (Date.parse(expiresAt) <= now) void leave();
  }, [expiresAt, now, leave]);

  // The view can also end elsewhere (Exit in another tab): then this tab goes back as well.
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState === "hidden" || left.current) return;
      const response = await fetch("/api/auth/session", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const payload = await response.json().catch(() => null) as { profile?: { viewAs?: { sessionId?: string } | null } } | null;
      if (payload?.profile && payload.profile.viewAs?.sessionId !== sessionId) void leave();
    };
    const interval = window.setInterval(() => void check(), 15_000);
    document.addEventListener("visibilitychange", check);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", check); };
  }, [sessionId, leave]);

  const who = viewAs.kind === "role"
    ? t("Previewing {role}", { role: viewAs.subjectName })
    : viewAs.subjectRoleLabel
      ? t("Viewing as {name} ({role})", { name: viewAs.subjectName, role: viewAs.subjectRoleLabel })
      : t("Viewing as {name}", { name: viewAs.subjectName });
  return <div aria-label={t("View as")} className={styles.banner} role="region">
    <Eye aria-hidden="true" className={styles.icon} size={15} />
    <strong className={styles.who}>{who}</strong>
    <span aria-hidden="true" className={styles.dot}>·</span>
    <span>{t("Read-only")}</span>
    <span aria-hidden="true" className={styles.dot}>·</span>
    <time className={styles.time} dateTime={expiresAt}>{t("{time} left", { time: viewAsTimeLeft(expiresAt, now) })}</time>
    <Button className={styles.exit} intent="read" isLoading={leaving} onPress={() => void leave()} size="compact" variant="primary">{t("Exit")}</Button>
  </div>;
}
