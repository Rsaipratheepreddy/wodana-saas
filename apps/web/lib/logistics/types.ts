/**
 * Factory and installation bookings (PLM-063, PLM-069; PLM-135, PLM-136): deliveries, installations, factory slots,
 * permit collection and production, with the people who go (HRMS workers by name, no login needed), the vehicle and the
 * driver; the vehicles register; building permits on projects and deals.
 */
export type LogisticsKind = "delivery" | "installation" | "factory_slot" | "permit" | "production";
export const LOGISTICS_KINDS: LogisticsKind[] = ["delivery", "installation", "permit", "production", "factory_slot"];

export type Named = { id: string; name: string };
export type BookedPerson = Named & { lead: boolean };
export type Crew = { people: BookedPerson[]; crew: Named | null; vehicle: Named | null; driver: Named | null; note: string; version: number };

export type Worker = { id: string; name: string; phone: string; trade: string; crewId: string | null };
export type CrewOption = { id: string; name: string; trade: string; workerIds: string[] };
export type Vehicle = { id: string; name: string; plate: string; kind: string; capacityNote: string; active?: boolean; version?: number };

export type LogisticsOptions = {
  projects: Array<{ id: string; label: string; deliveryOn: string | null; installationOn: string | null; slotOn: string | null; permitRequired: boolean; plannedPermitId: string | null }>;
  /** Won orders delivered without a project (Furniture Only). */
  deals: Array<{ id: string; label: string; deliveryOn: string | null; plannedPermitId: string | null; permitRequired: boolean }>;
  workOrders: Array<{ id: string; projectId: string; label: string; start: string | null; end: string | null; status: string }>;
  workers: Worker[]; crews: CrewOption[]; vehicles: Vehicle[]; permitTypes: string[]; canBook: boolean; canAddPeople: boolean; permitWarningDays: number;
};

export type PermitFact = { id: string; status: "planned" | "collected" | "cancelled"; validFrom: string | null; validTo: string | null; collectOn: string | null };

export type Clash = { kind: "person" | "vehicle"; id: string; name: string; key: string; what: LogisticsKind; project: string; day: string };

export type Booking = Crew & {
  kind: LogisticsKind; projectId: string | null; opportunityId: string | null; workOrderId: string | null; permitId: string | null; project: string; start: string | null; end: string | null;
  assignmentId: string | null; permit: { required: boolean; permits: PermitFact[] }; canBook: boolean; canClear: boolean; warnings?: Clash[];
};

/** A project's (or work order's) booking, or a deal's delivery when the order has no project. */
export type BookingSubject = { kind: LogisticsKind; projectId?: string | null; opportunityId?: string | null; workOrderId?: string | null; permitId?: string | null };
/** Whose permit: a project or a deal (it shows on both). */
export type PermitOwner = { projectId: string; opportunityId?: undefined } | { opportunityId: string; projectId?: undefined };

export type VehiclesState = { vehicles: Array<Vehicle & { active: boolean; version: number }>; permitWarningDays: number; dealDeliveryPermit: boolean; settingsVersion: number; canManage: boolean };

export type Permit = {
  id: string; status: "planned" | "collected"; collectOn: string | null; permitType: string; permitNumber: string; validFrom: string | null; validTo: string | null; collectedOn: string | null;
  collectedBy: string | null; note: string; fileName: string | null; fileMime: string | null; recordedBy: string | null; recordedAt: string | null; version: number;
};
export type PermitsState = { required: boolean; deliveryOn: string | null; installationOn: string | null; today: string; permits: Permit[]; valid: boolean; covering: string | null; canRecord: boolean };
