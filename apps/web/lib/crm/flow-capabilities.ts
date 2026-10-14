/** What a job's flow does, read by the server from its steps (branch paths included), never from its code. */
export type FlowCapabilities = {
  /** It holds an intro meeting. */
  intro: boolean;
  /** It has a design package round (a package to choose, Proposal 1: the design fee). */
  designPackage: boolean;
  /** It asks the furniture sub-path. */
  furniturePath: boolean;
  /** The client can approve on the spot. */
  clientApprovalOnSpot: boolean;
  /** It records a site visit. */
  siteVisit: boolean;
  /** The QS prices the quotation. */
  qsPricing: boolean;
};

const NONE: FlowCapabilities = { intro: false, designPackage: false, furniturePath: false, clientApprovalOnSpot: false, siteVisit: false, qsPricing: false };

/** The built-in starter flows' capabilities (as the server reads them from their steps), for a response without its own. */
const STARTER_CAPABILITIES: Record<string, FlowCapabilities> = {
  design: { ...NONE, intro: true, designPackage: true },
  fit_out: { ...NONE, intro: true, siteVisit: true, qsPricing: true },
  furniture: { ...NONE, furniturePath: true, clientApprovalOnSpot: true },
  basic: NONE,
};

/** What the job's flow does: the server's reading of its steps, or, from an older response, its starter flow's. */
export function flowCapabilities(flow: { flow: string; capabilities?: FlowCapabilities }): FlowCapabilities {
  return flow.capabilities ?? (Object.hasOwn(STARTER_CAPABILITIES, flow.flow) ? STARTER_CAPABILITIES[flow.flow] : NONE);
}
