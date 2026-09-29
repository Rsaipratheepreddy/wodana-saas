import { ConsoleRequestError } from "./console";

/** An operator's in-app notice in Wodana Control. Title and body are data (a reference, a company, a name). */
export type OperatorNotification = {
  id: string;
  eventType: string;
  title: string;
  body: string | null;
  link: string | null;
  sourceType: string;
  sourceId: string;
  readAt: string | null;
  createdAt: string;
};

export type OperatorNotificationList = { notifications: OperatorNotification[]; unread: number };

async function request(init?: RequestInit): Promise<OperatorNotificationList> {
  const response = await fetch("/api/internal/notifications", { ...init, cache: "no-store" });
  const data = await response.json().catch(() => null) as (OperatorNotificationList & { message?: string }) | null;
  if (!response.ok || !data) throw new ConsoleRequestError(typeof data?.message === "string" ? data.message : "", response.status);
  return data;
}

export const operatorNotificationsApi = {
  list: () => request(),
  markRead: (input: { ids?: string[]; all?: boolean }) =>
    request({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }),
};
