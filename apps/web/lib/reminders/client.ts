import type {
  DeliveryHealthMessagesQuery, DeliveryHealthMessagesResponse, EngineReminderKind, MyDayActionResult, MyDayAssignee, MyDayQuery, MyDayResponse,
  MyDaySnoozeInput, NotificationPersonSettingsInput, NotificationPersonSettingsView, ReminderRuleDto, ReminderRuleInput, ReminderSettingsDto,
  ReminderSettingsResponse,
} from "@wodana/contracts";

/** A refused reminder request: the server's message (empty when it sent none) and the HTTP status (409 = changed by someone else). */
export class ReminderRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ReminderRequestError";
    this.status = status;
  }
}

export const isVersionConflict = (error: unknown) => error instanceof ReminderRequestError && error.status === 409;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string" ? (data as { message: string }).message : "";
    throw new ReminderRequestError(message, response.status);
  }
  return data as T;
}

const query = (values: Record<string, string | number | undefined | null>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  return params.toString();
};

const send = (method: "POST" | "PUT", body: unknown, keepalive = false): RequestInit =>
  ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive });

/**
 * My day, reminder settings, the person's notification settings and the delivery message list, through the web
 * app's workspace routes (business-core checks every permission and version).
 */
export function remindersApi(workspaceId: string) {
  const ws = (extra: Record<string, string | number | undefined | null> = {}) => query({ workspaceId, ...extra });
  const subject = (id: string, action: string) => `/api/workspace/my-day/${encodeURIComponent(id)}/${action}?${ws()}`;
  return {
    myDay: (filter: MyDayQuery = {}) => call<MyDayResponse>(`/api/workspace/my-day?${ws({ scope: filter.scope, urgency: filter.urgency, module: filter.module, limit: filter.limit })}`),
    snooze: (id: string, input: MyDaySnoozeInput, keepalive?: boolean) => call<MyDayActionResult>(subject(id, "snooze"), send("POST", input, keepalive)),
    unsnooze: (id: string, version: number, keepalive?: boolean) => call<MyDayActionResult>(subject(id, "unsnooze"), send("POST", { version }, keepalive)),
    complete: (id: string, version: number, keepalive?: boolean) => call<MyDayActionResult>(subject(id, "complete"), send("POST", { version }, keepalive)),
    reassign: (id: string, input: { membershipId: string; version: number }, keepalive?: boolean) => call<MyDayActionResult>(subject(id, "reassign"), send("POST", input, keepalive)),
    assignees: (id: string) => call<MyDayAssignee[]>(subject(id, "assignees")),
    settings: () => call<ReminderSettingsResponse>(`/api/workspace/reminders/settings?${ws()}`),
    saveSettings: (settings: ReminderSettingsDto) => call<ReminderSettingsResponse>(`/api/workspace/reminders/settings?${ws()}`, send("PUT", settings)),
    saveRule: (kind: EngineReminderKind, input: ReminderRuleInput) => call<ReminderRuleDto>(`/api/workspace/reminders/rules/${encodeURIComponent(kind)}?${ws()}`, send("PUT", input)),
    resetRule: (kind: EngineReminderKind, version: number) => call<ReminderRuleDto>(`/api/workspace/reminders/rules/${encodeURIComponent(kind)}?${ws({ version })}`, { method: "DELETE" }),
    personSettings: () => call<NotificationPersonSettingsView>(`/api/workspace/notification-person-settings?${ws()}`),
    savePersonSettings: (input: NotificationPersonSettingsInput) => call<Partial<NotificationPersonSettingsView>>(`/api/workspace/notification-person-settings?${ws()}`, send("PUT", input)),
    healthMessages: (filter: DeliveryHealthMessagesQuery = {}) => call<DeliveryHealthMessagesResponse>(`/api/workspace/delivery-health/messages?${ws({ ...filter })}`),
  };
}

export type RemindersApi = ReturnType<typeof remindersApi>;
