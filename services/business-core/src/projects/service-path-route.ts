/** The enquiry scope is selected in CRM; a label alone cannot decide whether work is made to order. */
export type ServicePathScope = {
  design: boolean;
  mainQuotation: boolean;
  materialSelection: boolean;
  procurement: boolean;
  manufacturing: boolean;
  siteWorks: boolean;
  installation: boolean;
};

export type ServicePathStage =
  | "enquiry"
  | "requirements"
  | "design_quote"
  | "design_qs_review"
  | "design_client_approval"
  | "design_agreement_payment"
  | "main_quote"
  | "main_qs_review"
  | "main_client_approval"
  | "main_agreement_payment"
  | "deal_file"
  | "site_visit"
  | "design_specifications"
  | "material_list_signoff"
  | "procurement"
  | "manufacturing_readiness"
  | "factory_production"
  | "site_works"
  | "installation"
  | "snagging"
  | "client_handover";

export type ServicePathRoute = {
  /** The single Deal File / Project Ref is created after this round is paid and owner-approved. */
  firstPaidRound: "design" | "main";
  crm: ServicePathStage[];
  project: ServicePathStage[];
};

export function servicePathRoute(scope: ServicePathScope): ServicePathRoute {
  if (!scope.design && !scope.mainQuotation)
    throw new Error("Select design or a main fitout/furniture quotation.");
  if (!scope.mainQuotation && (scope.materialSelection || scope.procurement || scope.manufacturing || scope.siteWorks || scope.installation))
    throw new Error("Delivery work requires a main quotation.");
  if (scope.manufacturing && !scope.procurement)
    throw new Error("Manufacturing requires procurement and production release.");
  if (scope.materialSelection && !scope.procurement)
    throw new Error("A material list requires a procurement stage.");

  const crm: ServicePathStage[] = ["enquiry", "requirements"];
  const project: ServicePathStage[] = [];
  if (scope.design) {
    crm.push("design_quote", "design_qs_review", "design_client_approval", "design_agreement_payment");
  } else {
    crm.push("main_quote", "main_qs_review", "main_client_approval", "main_agreement_payment");
  }
  crm.push("deal_file");
  if (scope.design) project.push("site_visit", "design_specifications");
  if (scope.design && scope.mainQuotation)
    project.push("main_quote", "main_qs_review", "main_client_approval", "main_agreement_payment");
  if (scope.materialSelection) project.push("material_list_signoff");
  if (scope.procurement) project.push("procurement");
  if (scope.manufacturing) project.push("manufacturing_readiness", "factory_production");
  if (scope.siteWorks) project.push("site_works");
  if (scope.installation) project.push("installation");
  if (scope.mainQuotation) project.push("snagging", "client_handover");

  return { firstPaidRound: scope.design ? "design" : "main", crm, project };
}

/** A site plan supports measured design/build work; it is not a prerequisite to quote ready-made furniture. */
export function quotationRequiresSitePlan(scope: ServicePathScope, round: "design" | "main" | undefined): boolean {
  if (round === "design") return false;
  return scope.design || scope.manufacturing || scope.siteWorks;
}
