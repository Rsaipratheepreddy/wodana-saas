import { tKey } from "../i18n/keys";
import type { Booking, BookingSubject, Clash, LogisticsOptions, PermitOwner, PermitsState, VehiclesState, Worker } from "./types";

export class LogisticsRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new LogisticsRequestError(typeof data?.message === "string" ? data.message : tKey("Could not save."), response.status);
  return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** The logistics API for one workspace (through the workspace's own route). */
export function logisticsApi(workspaceId: string) {
  const at = (value: string, query: Record<string, string> = {}) => `/api/logistics/${value}?${new URLSearchParams({ workspaceId, ...query })}`;
  const subject = (value: BookingSubject) => ({ kind: value.kind, ...(value.projectId ? { projectId: value.projectId } : { opportunityId: value.opportunityId ?? "" }),
    ...(value.workOrderId ? { workOrderId: value.workOrderId } : {}), ...(value.permitId ? { permitId: value.permitId } : {}) });
  const owner = (value: PermitOwner) => (value.projectId ? `projects/${value.projectId}` : `deals/${value.opportunityId}`);
  return {
    options: (signal?: AbortSignal) => request<LogisticsOptions>(at("options"), { signal }),
    booking: (value: BookingSubject, signal?: AbortSignal) => request<Booking>(at("booking", subject(value)), { signal }),
    /** Books, moves or staffs a booking; fields left out stay as they are. Version-checked; the day seen before is checked too. */
    save: (input: BookingSubject & Record<string, unknown>) => request<Booking & { warnings: Clash[] }>(at("bookings"), json("POST", input)),
    cancel: (input: BookingSubject & { was: { start: string | null } }) => request<{ cancelled: boolean }>(at("bookings/cancel"), json("POST", input)),
    conflicts: (input: BookingSubject & { day: string; endDay?: string | null; workerIds: string[]; driverWorkerId?: string | null; vehicleId?: string | null }, signal?: AbortSignal) =>
      request<{ warnings: Clash[] }>(at("bookings/conflicts"), { ...json("POST", input), signal }),
    /** Adds a person by name and phone (no login); replayed safely by its id. */
    addPerson: (input: { id: string; name: string; phone: string; trade: string; crewId?: string | null }) => request<Worker>(at("people"), json("POST", input)),
    vehicles: () => request<VehiclesState>(at("vehicles")),
    saveVehicle: (input: Record<string, unknown>) => request<VehiclesState>(at("vehicles"), json("POST", input)),
    saveSettings: (input: { version: number; permitWarningDays?: number; dealDeliveryPermit?: boolean; permitExpiryReminderDays?: number }) => request<VehiclesState>(at("settings"), json("PUT", input)),
    permits: (value: PermitOwner, signal?: AbortSignal) => request<PermitsState>(at(`${owner(value)}/permits`), { signal }),
    /** Records the collected permit with its file, on a project or a deal; replayed safely by its id and file. */
    collectPermit: (value: PermitOwner, permitId: string, fields: Record<string, string>, file: File) => {
      const body = new FormData();
      for (const [key, field] of Object.entries(fields)) body.set(key, field);
      body.set("file", file);
      return request<PermitsState>(at(`${owner(value)}/permits/${permitId}`), { method: "POST", body });
    },
    withdrawPermit: (value: PermitOwner, permitId: string, input: { version: number; reason: string }) => request<PermitsState>(at(`${owner(value)}/permits/${permitId}/withdraw`), json("POST", input)),
    /** A recorded permit's own reminder days, or null for the firm's default (PLM-136). */
    permitReminder: (value: PermitOwner, permitId: string, input: { version: number; reminderDays: number | null }) =>
      request<PermitsState>(at(`${owner(value)}/permits/${permitId}/reminder`), json("PUT", input)),
    permitFileUrl: (permitId: string) => at(`permits/${permitId}/file`),
  };
}
export type LogisticsApi = ReturnType<typeof logisticsApi>;
