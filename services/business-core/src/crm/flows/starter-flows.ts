import type { FlowDefinition, FlowStepDefinition } from "./flow-definition";

/**
 * Plan §5a: the built-in starter flows. Each reproduces the pipeline gates live since r30 (proved by the equivalence
 * tests): a workspace gets copies of these on first read, and the interpreter falls back to them when a workspace has
 * no published flow for a code. Optional steps never block a move; they only show on the job's line.
 */
export const SALES_COLUMNS = ["qualified", "qualification", "proposal", "negotiation", "won"];

const step = (key: string, name: string, role: string, check: FlowStepDefinition["check"], column: string, extra: Partial<FlowStepDefinition> = {}): FlowStepDefinition =>
  ({ key, name, role, check, column, ...extra });

const enquiryType = step("enquiry_type", "Confirm the enquiry type", "sales", "details_complete", "qualification", { needs: ["enquiryType"] });
const paymentProof = step("payment_proof", "Attach the payment proof", "sales", "payment_proof_attached", "won", { clientVisible: true });

/** Design and fit-out share their gates since r30; their optional steps differ. */
const projectFlow = (optional: FlowStepDefinition[]): FlowDefinition => ({
  schema: 1,
  columns: SALES_COLUMNS,
  steps: [
    step("details", "Complete the client details", "sales", "details_complete", "qualified", { needs: ["clientEmail", "propertyLocation", "floorPlanOrArea"] }),
    enquiryType,
    step("intro_meeting", "Hold the intro meeting", "sales", "intro_meeting_completed", "qualification", { clientVisible: true }),
    step("client_type", "Set the client type", "sales", "client_type_set", "qualification"),
    step("discovery", "Complete discovery", "sales", "discovery_complete", "proposal"),
    ...optional,
    paymentProof,
  ],
  branches: [],
});

export const STARTER_FLOWS: Record<string, { name: string; definition: FlowDefinition }> = {
  furniture: {
    name: "Furniture",
    definition: {
      schema: 1,
      columns: SALES_COLUMNS,
      steps: [
        enquiryType,
        step("sub_path", "Choose the sub-path", "sales", "sub_path_chosen", "qualification"),
        step("client_type", "Set the client type", "sales", "client_type_set", "qualification"),
        step("quotation", "Prepare the quotation", "sales", "quote_exists", "proposal"),
        step("negotiation", "Agree the deal with the client", "sales", "client_approved_on_spot", "negotiation", { optional: true, clientVisible: true }),
        paymentProof,
      ],
      branches: [{
        key: "sub_path_branch", question: "subPath", after: "client_type", rejoin: "quotation",
        answers: [
          // A–D auto-qualify; E (bespoke) needs the factory's feasibility.
          { value: "take_home_now", steps: [] },
          { value: "in_stock_delivery", steps: [] },
          { value: "supplier_order", steps: [] },
          { value: "core_collection_factory", steps: [] },
          { value: "bespoke", steps: [step("feasibility", "Confirm feasibility with the factory", "factory_lead", "feasibility_confirmed", "qualification")] },
        ],
      }],
    },
  },
  design: {
    name: "Design",
    definition: projectFlow([
      step("package", "Choose the design package", "sales", "package_chosen", "proposal", { optional: true }),
      step("design_quote", "Prepare the design quote", "sales", "quote_exists", "proposal", { optional: true }),
      step("client_accepted", "Get the client's acceptance", "sales", "client_accepted", "proposal", { optional: true, clientVisible: true }),
    ]),
  },
  fit_out: {
    name: "Fit-out",
    definition: projectFlow([
      step("site_visit", "Record the site visit", "sales", "site_visit_recorded", "proposal", { optional: true, clientVisible: true }),
      step("qs_quote", "Price the quote with the QS", "quantity_surveyor", "qs_approved", "proposal", { optional: true }),
      step("client_accepted", "Get the client's acceptance", "sales", "client_accepted", "proposal", { optional: true, clientVisible: true }),
    ]),
  },
  basic: {
    name: "Basic",
    definition: { schema: 1, columns: SALES_COLUMNS, steps: [enquiryType, paymentProof], branches: [] },
  },
};

export const STARTER_FLOW_CODES = Object.keys(STARTER_FLOWS);

/** The starter flow for a code; an unknown code runs the basic flow (as an unset flow did in r30). */
export function starterFlow(code: string | null | undefined) {
  const resolved = code && STARTER_FLOWS[code] ? code : "basic";
  return { code: resolved, ...STARTER_FLOWS[resolved] };
}
