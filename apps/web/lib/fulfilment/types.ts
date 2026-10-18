/** A won order's fulfilment on its deal (PLM-083, PLM-125, PLM-126), as business-core returns it. */
export type FurniturePath = "take_home_now" | "in_stock_delivery" | "supplier_order" | "core_collection_factory" | "bespoke";
export type ReserveEvent = "none" | "quote_accepted" | "supplier_received" | "production_booked";
export type DeductEvent = "none" | "won" | "fulfilled" | "production_started";
export type LeadFrom = "won" | "drawing_approved";
export type FulfilmentStep = "paid" | "transfer" | "ordered" | "received" | "drawing_approved" | "slot_booked" | "in_production" | "ready" | "delivery_booked" | "collected" | "delivered" | "handed_over";

export type RuleSettings = {
  boqRequired: boolean | null; reserveOn: ReserveEvent; deductOn: DeductEvent; leadMinDays: number | null; leadMaxDays: number | null; leadFrom: LeadFrom;
  leadFromCatalogue: boolean; takeFromLocationId: string | null;
};
export type PathRule = RuleSettings & { furniturePath: FurniturePath | null; version: number };
export type RulesState = {
  flows: Array<{ id: string; name: string; enquiryTypes: string[]; furniture: boolean; rules: PathRule[] }>;
  places: Array<{ id: string; name: string }>; qsReview: boolean;
};

export type Reservation = {
  id: string; source: "quote_line" | "supplier_receipt" | "work_order_material"; itemId: string; itemName: string; unit: string; locationName: string | null;
  quantity: string; status: "reserved" | "deducted" | "released"; deducted: string; returned: string; short: string;
};

export type DealFulfilment = {
  opportunityId: string; status: string; furniturePath: FurniturePath | null; projectId: string | null; version: number;
  rule: Omit<RuleSettings, "boqRequired">;
  boq: { chosen: boolean | null; byDefault: boolean; required: boolean };
  plan: { steps: Array<{ key: FulfilmentStep; state: "done" | "current" | "pending"; at: string | null }>; expected: { from: string; by: string } | null;
    handedOver: boolean; late: boolean; cancelled: boolean } | null;
  reservations: Reservation[];
  orders: Array<{ id: string; number: string; status: string; supplierName: string; shipment: string | null; eta: string | null; trackingRef: string | null }>;
  /** The order's items from its quotation (what a supplier order is raised for). */
  items: Array<{ id: string; title: string; quantity: string; unit: string; stockItemId: string | null }>;
  transfer: { requestedAt: string; by: string | null; note: string; arrivedAt: string | null } | null;
  /** PLM-135: who goes on the delivery (people by name), the vehicle and the driver. */
  delivery: { on: string; note: string; by: string | null; people?: Array<{ id: string; name: string; lead: boolean }>; vehicle?: { id: string; name: string } | null;
    driver?: { id: string; name: string } | null; crewVersion?: number } | null;
  /** PLM-136: the building permit the delivery needs, where the firm asks deals for one (null when the order is taken home). */
  permit?: { required: boolean; valid: boolean; validTo: string | null; collected: boolean; plannedId: string | null } | null;
  cancelled: { at: string; reason: string; by: string | null } | null;
  can: { fulfil: boolean; boq: boolean; cancel: boolean; order: boolean };
};
