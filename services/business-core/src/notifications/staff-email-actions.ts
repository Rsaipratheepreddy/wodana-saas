/**
 * The one named action on a notification email: what the reader does next ("Review quote",
 * "Approve order"). Emails render in English on the server, like their subjects and bodies. An event
 * without its own label falls back to its module's, then to "Open in workspace".
 */
const EVENT_ACTIONS: Record<string, string> = {
  "crm.lead.assigned": "Open enquiry",
  "crm.meeting.booked": "Open meeting",
  "design.site_visit.booked": "Open site visit",
  "design.review_requested": "Review design",
  "design.client_changes": "Review changes",
  "quotation.review_requested": "Review quote",
  "quotation.client_accepted": "Open quote",
  "purchasing.approval_needed": "Approve order",
  "purchasing.late": "Open order",
  "purchasing.order_late": "Open order",
  "work.assigned": "Open task",
  "work.overdue": "Open task",
  "hrms.leave_requested": "Review leave",
  "hrms.leave_approved": "Open leave",
  "hrms.leave_rejected": "Open leave",
  "hrms.checkout_missing": "Open attendance",
  "hrms.document_expiring": "Open document",
  "site.incident": "Open report",
  "site.report_missing": "Add report",
  "site.report_waiting": "Review report",
  "warranty.claim": "Open claim",
  "payables.run_submitted": "Review payment run",
  "petty_cash.submitted": "Review expense",
  "stock.adjustment_needs_approval": "Review adjustment",
  "stock.low": "Restock",
  "receivables.overdue": "Open invoice",
  "hrms.timesheet_submitted": "Review timesheet",
  "hrms.crew_day_submitted": "Review crew day",
  "delivery.test": "Open delivery health",
};

const MODULE_ACTIONS: Record<string, string> = {
  crm: "Open enquiry",
  design: "Open design",
  quotation: "Open quote",
  purchasing: "Open order",
  work: "Open task",
  hrms: "Open in workspace",
  site: "Open report",
  warranty: "Open claim",
  project: "Open project",
  factory: "Open work order",
  stock: "Open stock",
  payables: "Open payment run",
  petty_cash: "Open expense",
  receivables: "Open invoice",
  account: "Open workspace",
  ai: "Open AI credits",
};

export function staffEmailAction(eventType: string | null | undefined, recipientType?: string | null) {
  if (recipientType === "portal_contact") return "Open your project";
  const event = String(eventType ?? "");
  return EVENT_ACTIONS[event] ?? MODULE_ACTIONS[event.split(".")[0]] ?? "Open in workspace";
}
