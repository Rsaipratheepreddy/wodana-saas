import type { FlowDefinition, FlowField, FlowStepDefinition } from "./flow-definition";
import { SALES_COLUMNS, STARTER_FLOWS } from "./starter-flows";

/**
 * Plan §5a: the flow template library. Product content for interior-design firms: a firm picks one when it creates a
 * flow ("New flow → start from a template") and edits its copy from there. Every template ends at Won with the payment
 * proof and uses only the check catalogue; the unit test runs each one through the publisher's validator.
 *
 * Names, descriptions, groups, enquiry-type labels and step names are plain English and are the web's i18n keys.
 * Roles are the role-template codes every firm kit can give a workspace (`src/workspaces/role-templates.ts`).
 * No currency, country or firm appears here: amounts and terms come from the workspace's region and settings.
 */
export const FLOW_TEMPLATE_GROUPS = ["Furniture", "Interior design", "Fit-out", "Other"] as const;
export type FlowTemplateGroup = (typeof FLOW_TEMPLATE_GROUPS)[number];

export type FlowTemplate = {
  key: string;
  name: string;
  /** One line in plain words: what the flow is for. */
  description: string;
  group: FlowTemplateGroup;
  /** Enquiry types a firm would usually point at this flow (generic labels). */
  suggestedEnquiryTypes: string[];
  definition: FlowDefinition;
};

const step = (key: string, name: string, role: string, check: FlowStepDefinition["check"], column: string, extra: Partial<FlowStepDefinition> = {}): FlowStepDefinition =>
  ({ key, name, role, check, column, ...extra });

const line = (steps: FlowStepDefinition[]): FlowDefinition => ({ schema: 1, columns: [...SALES_COLUMNS], steps, branches: [] });

const DETAILS: FlowField[] = ["enquiryType", "clientEmail", "propertyLocation", "floorPlanOrArea"];

// Contact and qualification (Account manager flow AM1–AM7).
/** First response within one working hour; the clock counts the workspace's working hours. */
const firstContact = () => step("first_contact", "Make first contact", "sales", "contact_logged", "qualified", { deadline: { amount: 1, unit: "working_hours" } });
/** What conversion and the intro meeting need: floor plan or an estimated size, client email, location, enquiry type. */
const details = () => step("details", "Complete the client details", "sales", "details_complete", "qualified", { needs: [...DETAILS] });
const enquiryType = () => step("enquiry_type", "Choose the enquiry type", "sales", "details_complete", "qualification", { needs: ["enquiryType"] });
const introMeeting = () => step("intro_meeting", "Hold the intro meeting", "sales", "intro_meeting_completed", "qualification", { clientVisible: true });
const clientType = () => step("client_type", "Set the client type", "sales", "client_type_set", "qualification");

// Design package round (Proposal 1).
const designRound = () => [
  step("package", "Choose the design package", "sales", "package_chosen", "proposal"),
  step("discovery", "Complete discovery", "sales", "discovery_complete", "proposal"),
  step("design_quote", "Prepare the design quote", "sales", "quote_exists", "proposal"),
  step("send_quote", "Send the design quote", "sales", "quote_sent", "proposal", { clientVisible: true }),
  step("client_accepted", "Get the client's acceptance", "sales", "client_accepted", "negotiation", { clientVisible: true }),
  step("payment_proof", "Attach the design fee payment proof", "sales", "payment_proof_attached", "won", { clientVisible: true, notify: ["finance"] }),
];

// Joinery path (FJ4–FJ8): site measured by sales with a designer, quotation priced by the QS before it goes out.
/** The site visit is due within 72 hours of becoming the current step. */
const siteVisit = (optional = false) => step("site_visit", "Measure the site with the designer", "sales", "site_visit_recorded", "qualification",
  { clientVisible: true, deadline: { amount: 72, unit: "hours" }, ...(optional ? { optional } : {}) });
const pricedQuote = () => [
  step("quotation", "Prepare the quotation", "sales", "quote_exists", "proposal"),
  step("qs_price", "Price the quotation", "quantity_surveyor", "qs_approved", "proposal", { notify: ["quantity_surveyor"] }),
  step("send_quote", "Send the proposal", "sales", "quote_sent", "proposal", { clientVisible: true, notify: ["sales"] }),
  // Quotes are valid for 7 days.
  step("client_accepted", "Get the client's acceptance", "sales", "client_accepted", "negotiation", { clientVisible: true, deadline: { amount: 7, unit: "days" } }),
  step("payment_proof", "Attach the 50% deposit proof", "sales", "payment_proof_attached", "won", { clientVisible: true, notify: ["finance", "factory_lead"] }),
];

// Furniture sales (sub-paths A–E). Negotiation is used only when the client does not decide on the spot.
const negotiation = () => step("negotiation", "Agree the deal with the client", "sales", "client_approved_on_spot", "negotiation", { optional: true, clientVisible: true });
const furniturePayment = (name: string, notify: string[] = ["finance"]) =>
  step("payment_proof", name, "sales", "payment_proof_attached", "won", { clientVisible: true, notify });

export const FLOW_TEMPLATES: readonly FlowTemplate[] = [
  // Furniture
  {
    key: "furniture_all_paths",
    name: "Furniture – all paths",
    description: "One flow for every furniture sale; the path chosen decides the steps.",
    group: "Furniture",
    suggestedEnquiryTypes: ["Furniture only"],
    definition: STARTER_FLOWS.furniture.definition,
  },
  {
    key: "furniture_take_home",
    name: "Take home now",
    description: "Showroom pieces the client pays for and takes the same day.",
    group: "Furniture",
    suggestedEnquiryTypes: ["Furniture only"],
    definition: line([
      enquiryType(),
      clientType(),
      step("quotation", "Pick the items from stock", "sales", "quote_exists", "proposal"),
      step("client_approved", "Mark the client's approval", "sales", "client_approved_on_spot", "proposal", { clientVisible: true }),
      furniturePayment("Attach the payment proof"),
    ]),
  },
  {
    key: "furniture_in_stock_delivery",
    name: "In stock – delivery",
    description: "Stock pieces delivered to the client after payment.",
    group: "Furniture",
    suggestedEnquiryTypes: ["Furniture only"],
    definition: line([
      enquiryType(),
      clientType(),
      step("quotation", "Quote with the delivery date and charge", "sales", "quote_exists", "proposal"),
      negotiation(),
      furniturePayment("Attach the payment proof"),
    ]),
  },
  {
    key: "furniture_supplier_order",
    name: "Ordered from supplier",
    description: "Pieces bought in from a supplier once the client has paid in full.",
    group: "Furniture",
    suggestedEnquiryTypes: ["Furniture only"],
    definition: line([
      enquiryType(),
      clientType(),
      step("quotation", "Quote with the supplier lead time", "sales", "quote_exists", "proposal"),
      negotiation(),
      furniturePayment("Attach the full payment proof"),
    ]),
  },
  {
    key: "furniture_core_collection",
    name: "Core collection – made in the factory",
    description: "Collection pieces made from the approved drawing; a change of materials needs the creative director's approval.",
    group: "Furniture",
    suggestedEnquiryTypes: ["Furniture only"],
    definition: line([
      enquiryType(),
      clientType(),
      step("quotation", "Quote the price, materials and lead time", "sales", "quote_exists", "proposal"),
      negotiation(),
      furniturePayment("Attach the full payment proof", ["finance", "factory_lead"]),
    ]),
  },
  {
    key: "furniture_bespoke",
    name: "Bespoke furniture",
    description: "Custom pieces: the factory confirms they can be made and the QS prices them.",
    group: "Furniture",
    suggestedEnquiryTypes: ["Furniture only"],
    definition: line([
      enquiryType(),
      clientType(),
      step("feasibility", "Confirm feasibility with the factory", "factory_lead", "feasibility_confirmed", "qualification", { notify: ["factory_lead"] }),
      step("quotation", "Prepare the quotation", "sales", "quote_exists", "proposal"),
      step("qs_price", "Price the quotation", "quantity_surveyor", "qs_approved", "proposal", { notify: ["quantity_surveyor"] }),
      negotiation(),
      furniturePayment("Attach the full payment proof", ["finance", "factory_lead"]),
    ]),
  },
  // Interior design (the design package round; design work starts after payment)
  {
    key: "design_concept",
    name: "Concept package",
    description: "Mood boards, concepts and a material list per space, paid up front.",
    group: "Interior design",
    // PLM-127: concept clients are Interior design with the Concept package chosen after the intro; no separate type.
    suggestedEnquiryTypes: ["Interior design"],
    definition: line([firstContact(), details(), introMeeting(), clientType(), ...designRound()]),
  },
  {
    key: "design_bespoke",
    name: "Bespoke interior design",
    description: "Full design priced by area, with space planning and 3D renders, paid up front.",
    group: "Interior design",
    suggestedEnquiryTypes: ["Interior design"],
    definition: line([firstContact(), details(), introMeeting(), clientType(), ...designRound()]),
  },
  {
    key: "design_creative_director",
    name: "Designed by the creative director",
    description: "Premium design the creative director leads and reviews before the client sees it.",
    group: "Interior design",
    suggestedEnquiryTypes: ["Interior design"],
    definition: line([firstContact(), details(), introMeeting(), clientType(), ...designRound()]),
  },
  {
    key: "design_and_furniture",
    name: "Interior design + furniture",
    description: "Design fee first; the furniture quotation follows once the design is approved.",
    group: "Interior design",
    suggestedEnquiryTypes: ["Interior design + furniture"],
    definition: line([firstContact(), details(), introMeeting(), clientType(), siteVisit(true), ...designRound()]),
  },
  // Fit-out (joinery path)
  {
    key: "fit_out_joinery",
    name: "Fit-out / joinery",
    description: "Built-in joinery: measure the site, price it with the QS, then take the deposit.",
    group: "Fit-out",
    suggestedEnquiryTypes: ["Joinery only", "Renovation / fit-out"],
    definition: line([firstContact(), details(), introMeeting(), clientType(), siteVisit(), ...pricedQuote()]),
  },
  {
    key: "full_fit_out",
    name: "Full fit-out / turnkey",
    description: "The whole home or space delivered turnkey, with design when the client wants it.",
    group: "Fit-out",
    suggestedEnquiryTypes: ["Full fit-out", "Full fit-out + furniture", "Full interior design"],
    definition: line([
      firstContact(), details(), introMeeting(), clientType(), siteVisit(),
      step("discovery", "Complete discovery", "sales", "discovery_complete", "proposal"),
      step("package", "Choose the design package", "sales", "package_chosen", "proposal", { optional: true }),
      ...pricedQuote(),
    ]),
  },
  {
    key: "renovation",
    name: "Renovation",
    description: "Rooms to renovate: scope the work on site, price it with the QS, then take the deposit.",
    group: "Fit-out",
    suggestedEnquiryTypes: ["Renovation / fit-out"],
    definition: line([
      firstContact(), details(), introMeeting(), clientType(), siteVisit(),
      step("discovery", "Complete discovery", "sales", "discovery_complete", "proposal"),
      ...pricedQuote(),
    ]),
  },
  // Other
  {
    key: "returning_customer",
    name: "Returning customer re-order",
    description: "A past client ordering again: quote, approve and pay.",
    group: "Other",
    suggestedEnquiryTypes: ["Furniture only"],
    definition: line([
      enquiryType(),
      step("quotation", "Prepare the quotation", "sales", "quote_exists", "proposal"),
      step("client_approved", "Mark the client's approval", "sales", "client_approved_on_spot", "proposal", { clientVisible: true }),
      furniturePayment("Attach the payment proof"),
    ]),
  },
  {
    key: "architecture",
    name: "Architecture (to be defined)",
    description: "A placeholder until the firm agrees its architecture steps.",
    group: "Other",
    suggestedEnquiryTypes: ["Architecture"],
    definition: line([firstContact(), details(), introMeeting(), furniturePayment("Attach the payment proof")]),
  },
  {
    key: "basic",
    name: "Basic",
    description: "Payment proof only, for work without its own flow.",
    group: "Other",
    suggestedEnquiryTypes: [],
    definition: STARTER_FLOWS.basic.definition,
  },
];

export const FLOW_TEMPLATE_KEYS = FLOW_TEMPLATES.map((template) => template.key);

export function flowTemplate(key: string) {
  return FLOW_TEMPLATES.find((template) => template.key === key);
}
