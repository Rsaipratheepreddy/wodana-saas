export const projectSectionIds = ["overview", "boq", "daily-progress", "plan-teams", "material-planning", "procurement", "production", "site-work", "snagging", "handover", "documents", "commercial"] as const;
export type ProjectSection = typeof projectSectionIds[number];

export type ProjectFlow = {
  title: string;
  summary: string;
  receives: string;
  steps: Array<{ title: string; detail: string }>;
  outcome: string;
  note: string;
  related: ProjectSection[];
};

export const projectFlows: Record<ProjectSection, ProjectFlow> = {
  boq: {
    title: "BOQ", summary: "Review the scope and quantities released for this project.",
    receives: "The accepted quotation and released bill of quantities.",
    steps: [{ title: "Review scope", detail: "Check rooms, items, specifications and quantities." }, { title: "Plan delivery", detail: "Connect the approved items to tasks and procurement." }],
    outcome: "A shared reference for project execution.", note: "Approved scope changes remain linked to the source quotation.", related: ["documents", "site-work", "procurement"],
  },
 "daily-progress": {title:"Daily progress",summary:"Site and factory updates reviewed before progress changes.",receives:"Assigned tasks and measured output.",steps:[{title:"Report",detail:"Record measured work and evidence."},{title:"Review",detail:"Approve or return the report."},{title:"Publish",detail:"Share the approved client update."}],outcome:"Verified progress linked to tasks.",note:"Attendance alone is not progress.",related:["plan-teams","site-work"]},
  overview: {
    title: "Dashboard",
    summary: "Follow the approved scope, project dates, blockers and decisions in one place.",
    receives: "The approved BOQ, drawings, contract and release conditions from Pre-execution.",
    steps: [
      { title: "Plan", detail: "Break the scope into tasks and book teams." },
      { title: "Deliver", detail: "Coordinate materials, factory jobs and site work." },
      { title: "Verify", detail: "Inspect completed work and resolve defects." },
      { title: "Hand over", detail: "Record acceptance and remaining obligations." },
    ],
    outcome: "A shared view of what is ready, what is blocked and who acts next.",
    note: "Commercial, documents and approvals stay connected throughout delivery. Factory and site work can run in parallel.",
    related: ["plan-teams", "commercial"],
  },
  "plan-teams": {
    title: "Schedules",
    summary: "Turn BOQ scope into tasks and book people or factory capacity across projects.",
    receives: "Scope items, target dates, required skills and project working calendars.",
    steps: [
      { title: "Define the work", detail: "Set areas, tasks, quantities and dependencies." },
      { title: "Check availability", detail: "Review crew bookings, leave and factory capacity across projects." },
      { title: "Confirm bookings", detail: "Reserve the required team and dates after resolving clashes." },
      { title: "Track changes", detail: "Update actual progress and flag later bookings affected by delays." },
    ],
    outcome: "A coordinated schedule with named owners and confirmed resource bookings.",
    note: "Assigning a team to a project does not reserve its time. Confirmed bookings must prevent double-booking; execution also requires readiness and release.",
    related: ["material-planning", "production", "site-work"],
  },
  "material-planning": {
    title: "Material planning",
    summary: "Work out what materials are needed, what is available and what must be ordered.",
    receives: "Approved BOQ scope, final measurements, specifications and task dates.",
    steps: [
      { title: "Calculate demand", detail: "List materials, hardware and consumables by item or task." },
      { title: "Check supply", detail: "Review usable stock, existing reservations and incoming orders." },
      { title: "Reserve stock", detail: "Allocate available quantities to the project." },
      { title: "Request shortages", detail: "Send remaining quantities and need-by dates to Procurement." },
    ],
    outcome: "Reserved stock and clear purchase requirements for the remaining need.",
    note: "A BOQ selling quantity is not a manufacturing material quantity. Items included in a supplier’s package must not be purchased twice.",
    related: ["procurement", "production", "site-work"],
  },
  procurement: {
    title: "Procurement",
    summary: "Manage supplier quotations, subcontract orders, promised dates and accepted deliveries.",
    receives: "Approved material requirements or a defined subcontract scope and budget.",
    steps: [
      { title: "Compare offers", detail: "Review specification, price, exclusions, delivery and payment terms." },
      { title: "Approve the order", detail: "Authorize the selected supplier or subcontractor and record their acknowledgement." },
      { title: "Track delivery", detail: "Collect vendor dates, progress and delivery evidence through their order page." },
      { title: "Verify receipt", detail: "Accept usable quantities or completed work before ordinary bill approval." },
    ],
    outcome: "Accepted materials or services, outstanding quantities and verified bills for Commercial.",
    note: "The vendor page is scoped to that vendor’s enquiry or order. Partial deliveries, rejected goods and approved advances need separate records.",
    related: ["material-planning", "site-work", "commercial"],
  },
  production: {
    title: "Production",
    summary: "Track custom items made in your workshop or by an outside factory.",
    receives: "Released item quantities, approved production drawings, materials and capacity bookings.",
    steps: [
      { title: "Prepare the job", detail: "Confirm measurements, drawing revision and the manufacturing route." },
      { title: "Confirm readiness", detail: "Check materials, booked capacity and required release approvals." },
      { title: "Make and inspect", detail: "Track operations, accepted quantities and rework." },
      { title: "Pack and dispatch", detail: "Coordinate accepted items with transport and site readiness." },
    ],
    outcome: "Quality-accepted items ready for delivery and installation.",
    note: "Use this tab only for manufactured scope. An outside factory confirms its dates; site fabrication and installation belong to Site work.",
    related: ["plan-teams", "procurement", "site-work"],
  },
  "site-work": {
    title: "Execution",
    summary: "Coordinate civil, electrical, plumbing, finishes, site fabrication and installation.",
    receives: "Released tasks, current drawings, site permissions, accepted materials and booked crews.",
    steps: [
      { title: "Check the area", detail: "Confirm access, prerequisites, materials and safe work arrangements." },
      { title: "Start the task", detail: "Confirm the assigned crew and approved scope for the shift." },
      { title: "Record progress", detail: "Log completed quantities, time, photos and blockers." },
      { title: "Request inspection", detail: "Submit finished work for verification and record corrections." },
    ],
    outcome: "Verified work by area, with outstanding defects passed to Snagging.",
    note: "Attendance records presence, not completion. A free crew alone does not make a task ready to start.",
    related: ["plan-teams", "snagging", "commercial"],
  },
  snagging: {
    title: "Snagging",
    summary: "Record defects, assign corrective work and verify the result.",
    receives: "Defects found during factory or site checks, installation and client walkthroughs.",
    steps: [
      { title: "Record the issue", detail: "Identify the area, item, severity and evidence." },
      { title: "Assign correction", detail: "Set the responsible team or vendor and a due date." },
      { title: "Fix the defect", detail: "Record corrective work and completion evidence." },
      { title: "Verify and close", detail: "Reinspect and accept the fix, or reopen the issue." },
    ],
    outcome: "Verified corrections and an explicit list of any remaining handover items.",
    note: "Defective work is not automatically a billable client change. Safety-critical and mandatory compliance issues block handover.",
    related: ["site-work", "handover", "commercial"],
  },
  handover: {
    title: "Handover",
    summary: "Complete client acceptance, documentation and warranty follow-up.",
    receives: "Verified scope, resolved blocking defects and required completion evidence.",
    steps: [
      { title: "Check completion", detail: "Review inspections, commissioning and applicable authority requirements." },
      { title: "Prepare documents", detail: "Collect as-built drawings, manuals, warranties and asset details." },
      { title: "Record acceptance", detail: "Confirm the client’s acceptance and any permitted outstanding items." },
      { title: "Track obligations", detail: "Follow warranty defects, final accounts and remaining contractual commitments." },
    ],
    outcome: "A documented handover with clear responsibility for remaining obligations.",
    note: "Physical handover and financial closure are separate. Payment and retention conditions follow the actual contract.",
    related: ["snagging", "documents", "commercial"],
  },
  documents: {
    title: "Scope & Design",
    summary: "Keep drawings, specifications, decisions and delivery evidence linked to the work.",
    receives: "Pre-execution references and documents created throughout project delivery.",
    steps: [
      { title: "Link the record", detail: "Attach each file to its scope item, task, order or inspection." },
      { title: "Review revisions", detail: "Identify the current version and its required reviewers." },
      { title: "Control changes", detail: "Review affected work when an approved document changes." },
      { title: "Prepare closeout", detail: "Collect approved final records for the handover pack." },
    ],
    outcome: "A traceable record of which information was approved and used for each activity.",
    note: "A new drawing revision must not silently replace the version already released to a factory or site team.",
    related: ["production", "site-work", "handover"],
  },
  commercial: {
    title: "Budget",
    summary: "Track the agreement, project budget, changes and accounting status throughout delivery.",
    receives: "The agreed BOQ, contract, payment plan, commitments and verified project costs.",
    steps: [
      { title: "Track the baseline", detail: "Keep the original agreement, approved changes and current budget linked." },
      { title: "Review costs", detail: "Compare incurred costs, remaining commitments and forecast work." },
      { title: "Approve billing", detail: "Verify client billing requests, vendor bills and contractual advances." },
      { title: "Connect accounting", detail: "Send approved records to the selected accounting system and receive status updates." },
    ],
    outcome: "A clear view of contract value, expected margin, amounts due and amounts paid.",
    note: "Use Zoho Books or QuickBooks as the accounting system for each company. Project approvals and budgets stay here; invoices, bills and settlement stay linked to accounting.",
    related: ["procurement", "plan-teams", "handover"],
  },
};

export const changeRequestFlow: ProjectFlow = {
  title: "Change requests",
  summary: "Assess a proposed change before updating agreed scope, costs or booked work.",
  receives: "A client, site or vendor request linked to the affected BOQ items and drawings.",
  steps: [
    { title: "Capture the request", detail: "Record what changes, why, who requested it and the affected scope." },
    { title: "Assess the impact", detail: "Review design, cost, dates, ordered materials and work already completed." },
    { title: "Obtain a decision", detail: "Collect the required technical, commercial and client decisions." },
    { title: "Apply the approved change", detail: "Record the variation and revise affected orders, drawings, bookings and releases." },
  ],
  outcome: "One linked change record, an approved scope revision and visible cost and schedule effects.",
  note: "Keep the original approved BOQ. Pending requests do not automatically change the contract value. Link the same record to Pre-execution Variations; delays and defects have their own workflows.",
  related: ["plan-teams", "documents", "procurement"],
};
