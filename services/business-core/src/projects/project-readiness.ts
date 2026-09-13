import type { CommercialData } from "../commercial/commercial.types";
import { commercialReleaseReady } from "../commercial/release-integrity";
/** Recheck the accepted agreement and due payments for each execution action. */
export function commercialExecutionReady(commercial?:CommercialData|null):boolean {
 return commercialReleaseReady(commercial);
}
