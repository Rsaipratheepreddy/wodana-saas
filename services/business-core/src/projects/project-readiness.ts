import { DEAL_FIRST_WORKFLOW_CODE } from "./deal-first-workflow";
import type { CommercialData } from "../commercial/commercial.types";
import { commercialReleaseReady, financeGatePaymentsReady } from "../commercial/release-integrity";
import { materialListSignedOff } from "../commercial/release-integrity";
import { qsEstimateCurrent } from "../commercial/qs-estimate";
import { ConflictException } from "@nestjs/common";
/** Recheck the accepted agreement and due payments for each execution action. */
export function commercialExecutionReady(commercial?:CommercialData|null):boolean {
 return commercialReleaseReady(commercial);
}

/** Stage movement must not claim that Palm manufacturing has started before H3 is verified. */
export function assertManufacturingPaymentReady(
  workflowCode: string | undefined,
  toStageKey: unknown,
  commercial?: CommercialData | null,
) {
  if (workflowCode !== DEAL_FIRST_WORKFLOW_CODE || !["manufacturing", "factory_production"].includes(String(toStageKey))) return;
  const main = commercial?.quotes.find(quote => quote.kind === "quotation" && quote.round === "main" && quote.status === "accepted");
  if (!commercial || !commercialExecutionReady(commercial) || !financeGatePaymentsReady(commercial, "production", main?.id))
    throw new ConflictException("Verify the contracted production payment before moving to Manufacturing.");
}

/** New Palm stages cannot be advanced by clicking Next before their actual commercial evidence exists. */
export function assertServicePathStageReady(
  workflowCode: string | undefined,
  toStageKey: unknown,
  commercial?: CommercialData | null,
) {
  if (workflowCode !== DEAL_FIRST_WORKFLOW_CODE || typeof toStageKey !== "string") return;
  const firstDeal = commercial?.designRound?.dealFile ?? commercial?.dealFile;
  const firstReview = commercial?.designRound?.ownerReview ?? commercial?.ownerReview;
  if (!commercial?.servicePath || !firstDeal || !firstReview || firstReview.status !== "approved" ||
      firstReview.id !== firstDeal.ownerReviewId || firstReview.quoteId !== firstDeal.quoteId)
    throw new ConflictException("Reconcile the first paid, Owner-approved Deal File before advancing this project.");
  const main = commercial.quotes.find(quote => quote.kind === "quotation" && quote.round === "main");
  if (toStageKey === "main_qs_review" && !main)
    throw new ConflictException("Prepare the main quotation before QS review.");
  if (toStageKey === "main_client_approval" &&
      (!main || !["internal_approved", "issued", "accepted"].includes(main.status) || !qsEstimateCurrent(main)))
    throw new ConflictException("QS must estimate the current main quotation before client approval.");
  if (toStageKey === "main_agreement_payment" && main?.status !== "accepted")
    throw new ConflictException("Wait for the client's acceptance of the main quotation.");
  if (toStageKey === "material_list_signoff" &&
      (!main || main.status !== "accepted" || commercial.ownerReview?.quoteId !== main.id ||
        commercial.ownerReview.status !== "approved" || commercial.dealFile?.quoteId !== main.id ||
        !financeGatePaymentsReady(commercial, "release", main.id)))
    throw new ConflictException("Complete the main agreement, verified payment and Owner approval before the material meeting.");
  if (toStageKey === "procurement" &&
      (!main || !materialListSignedOff(commercial, main) || !commercialReleaseReady(commercial)))
    throw new ConflictException("Get client material sign-off and release the approved main scope before procurement.");
}
