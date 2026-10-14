import { allSteps, type FlowCheck, type FlowDefinition } from "./flow-definition";
import { STARTER_FLOWS } from "./starter-flows";

/**
 * What a job's flow does, read from its steps (branch paths included), never from its code: a workspace's own flow
 * (an enquiry type's copy of a starter, under any code) has the same features as the starter it was built from.
 *   intro                 it holds an intro meeting (the Intro card, Book intro)
 *   designPackage         it has a design package round: a package to choose, or a design quote (Proposal 1, the design fee)
 *   furniturePath         it asks the furniture sub-path (A–E)
 *   clientApprovalOnSpot  the client can approve on the spot
 *   siteVisit             it records a site visit
 *   qsPricing             the QS prices the quotation
 */
export type FlowCapabilities = {
  intro: boolean;
  designPackage: boolean;
  furniturePath: boolean;
  clientApprovalOnSpot: boolean;
  siteVisit: boolean;
  qsPricing: boolean;
};

/** The key the starter flows and the templates give the design round's quote step. */
const DESIGN_QUOTE_STEP = "design_quote";

export const NO_CAPABILITIES: FlowCapabilities = {
  intro: false, designPackage: false, furniturePath: false, clientApprovalOnSpot: false, siteVisit: false, qsPricing: false,
};

/** The capabilities one definition's steps give. */
export function definitionCapabilities(definition: FlowDefinition): FlowCapabilities {
  const steps = allSteps({ ...definition, branches: definition.branches ?? [] });
  const asks = (check: FlowCheck) => steps.some((step) => step.check === check);
  return {
    intro: asks("intro_meeting_completed"),
    designPackage: asks("package_chosen") || steps.some((step) => step.key === DESIGN_QUOTE_STEP),
    furniturePath: asks("sub_path_chosen") || (definition.branches ?? []).some((branch) => branch.question === "subPath"),
    clientApprovalOnSpot: asks("client_approved_on_spot"),
    siteVisit: asks("site_visit_recorded"),
    qsPricing: asks("qs_approved"),
  };
}

/**
 * The capabilities of the flow a job runs: its definition's, plus, for a built-in starter code (design, fit_out,
 * furniture, basic), the starter's own, so a firm that edited a starter keeps what the product always showed for it.
 */
export function flowCapabilities(definition: FlowDefinition | null | undefined, code?: string | null): FlowCapabilities {
  const own = definition ? definitionCapabilities(definition) : NO_CAPABILITIES;
  const starter = code && Object.hasOwn(STARTER_FLOWS, code) ? definitionCapabilities(STARTER_FLOWS[code].definition) : null;
  if (!starter) return own;
  return Object.fromEntries(Object.entries(own).map(([key, value]) => [key, value || starter[key as keyof FlowCapabilities]])) as FlowCapabilities;
}
