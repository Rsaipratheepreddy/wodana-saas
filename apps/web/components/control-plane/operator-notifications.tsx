"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogTrigger, Heading } from "react-aria-components";
import { Button, IconButton, PopoverSurface } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { operatorNotificationsApi, type OperatorNotification } from "@/lib/internal/notifications";
import { useConsoleFormat } from "./labels";
import styles from "./operator-notifications.module.css";

/** Every minute is enough for a portal where operators react within hours (and cheap while nobody looks). */
const POLL_MS = 60_000;

/** Fired when a page reads a notice's source (opening an enquiry), so the bell's count follows at once. */
export const OPERATOR_NOTICES_EVENT = "wodana:operator-notices-changed";

function eventLabel(t: Translate, eventType: string) {
  if (eventType === "sales_enquiry.received") return t("New sales enquiry");
  if (eventType === "platform_integration.changed") return t("Platform connection changed");
  return t("Notification");
}

/** The operator's own notices in Wodana Control: a new sales enquiry, and later every control-plane event. */
export function OperatorNotifications() {
  const t = useT();
  const router = useRouter();
  const format = useConsoleFormat();
  const [items, setItems] = useState<OperatorNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await operatorNotificationsApi.list();
      setItems(result.notifications); setUnread(result.unread); setFailed(false);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void load());
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    const changed = () => void load();
    window.addEventListener(OPERATOR_NOTICES_EVENT, changed);
    return () => { window.clearInterval(timer); window.removeEventListener(OPERATOR_NOTICES_EVENT, changed); };
  }, [load]);

  const markRead = async (input: { ids?: string[]; all?: boolean }) => {
    try {
      const result = await operatorNotificationsApi.markRead(input);
      setItems(result.notifications); setUnread(result.unread); setFailed(false);
    } catch { setFailed(true); }
  };
  const openNotice = (item: OperatorNotification) => {
    setOpen(false);
    if (!item.readAt) void markRead({ ids: [item.id] });
    if (item.link?.startsWith("/internal")) router.push(item.link);
  };

  const label = unread ? t("Notifications, {count} unread", { count: unread }) : t("Notifications");
  return <DialogTrigger isOpen={open} onOpenChange={(next) => { setOpen(next); if (next) void load(); }}>
    <span className={styles.trigger}>
      <IconButton aria-label={label}><Bell aria-hidden="true" size={16} /></IconButton>
      {unread ? <span aria-hidden="true" className={styles.badge}>{unread > 9 ? "9+" : unread}</span> : null}
    </span>
    <PopoverSurface>
      <Dialog aria-label={t("Notifications")} className={styles.panel}>
        <header className={styles.header}>
          <Heading className={styles.title} slot="title">{t("Notifications")}</Heading>
          <Button isDisabled={!unread} onPress={() => void markRead({ all: true })} size="compact" variant="quiet">
            <CheckCheck aria-hidden="true" size={15} />{t("Mark all as read")}
          </Button>
        </header>
        {failed ? <p className={styles.message} role="alert">{t("Notifications could not be updated.")}
          <Button onPress={() => void load()} size="compact" variant="quiet">{t("Retry")}</Button></p> : null}
        {items.length ? <ul className={styles.list}>{items.map((item) => <li key={item.id}>
          <button className={styles.item} data-unread={item.readAt ? undefined : ""} onClick={() => openNotice(item)} type="button">
            <span className={styles.event}>{eventLabel(t, item.eventType)}</span>
            <strong>{item.title}</strong>
            {item.body ? <span className={styles.body}>{item.body}</span> : null}
            <time className={styles.time} dateTime={item.createdAt} title={format.dateTime(item.createdAt)}>{format.relative(item.createdAt)}</time>
          </button>
        </li>)}</ul> : !failed ? <p className={styles.message}>{t("No notifications yet")}</p> : null}
      </Dialog>
    </PopoverSurface>
  </DialogTrigger>;
}
