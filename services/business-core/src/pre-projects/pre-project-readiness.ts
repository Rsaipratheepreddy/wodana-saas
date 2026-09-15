import { canonicalHash } from "../crm/shared/crm-types";

export type PreProjectReadinessState =
  | "satisfied"
  | "missing"
  | "stale"
  | "blocked"
  | "not_applicable";

export type PreProjectReadinessActionCode =
  | "ADD_INCLUDED_SCOPE"
  | "ADD_SITE_PLAN"
  | "REVIEW_REQUIREMENT"
  | "CREATE_SPECIFICATION"
  | "REFRESH_QUOTATION_SCOPE"
  | "RECORD_MEASUREMENT"
  | "VERIFY_MEASUREMENT"
  | "ADD_MEASUREMENT_EVIDENCE"
  | "LINK_DESIGN_REVISION"
  | "APPROVE_DESIGN_REVISION"
  | "RESOLVE_DESIGN_FEEDBACK"
  | "REVIEW_NEWER_DESIGN_REVISION"
  | "COMPLETE_MATERIAL_SELECTION"
  | "RESOLVE_SITE_OBSERVATION"
  | "RESUME_ENGAGEMENT";

export interface PreProjectReadinessAction {
  code: PreProjectReadinessActionCode;
  label: string;
  targetType: "engagement" | "scope_item" | "site" | "design";
  targetId: string;
}

export interface PreProjectReadinessCheck {
  code: string;
  label: string;
  state: PreProjectReadinessState;
  blocking: boolean;
  detail: string;
  scopeItemId?: string;
  action?: PreProjectReadinessAction;
}

export interface PricingScopeReference {
  scopeId: string;
  title: string;
  scopeVersion?: number;
  specificationVersion?: number;
}

export interface PreProjectMeasurementFact {
  id: string;
  version: number;
  status: string;
  hasEvidence: boolean;
}

export interface PreProjectDesignFact {
  versionId: string;
  designId: string;
  number: number;
  latestNumber: number;
  status: string;
  usage: string;
  blockingOpen: boolean;
}

export interface PreProjectItemFact {
  id: string;
  title: string;
  roomId: string | null;
  roomName: string | null;
  version: number;
  scopeStatus: string;
  reviewStatus: string;
  archivedAt: string | null;
  specificationVersion: number | null;
  specification: {
    materials?: Array<{ status?: string }>;
  } | null;
  measurement: PreProjectMeasurementFact | null;
  designs: PreProjectDesignFact[];
}

export interface PreProjectReadinessFacts {
  case: {
    id: string;
    status: string;
    phase: string;
    version: number;
  };
  sitePlanCount: number;
  openObservationCount: number;
  items: PreProjectItemFact[];
}

export interface EvaluatePreProjectReadinessOptions {
  target?: "pricing";
  scopeReferences?: PricingScopeReference[];
  requireIncludedScope?: boolean;
}

export interface PreProjectItemReadiness {
  scopeItemId: string;
  title: string;
  roomId: string | null;
  roomName: string | null;
  scopeVersion: number | null;
  specificationVersion: number | null;
  ready: boolean;
  checks: PreProjectReadinessCheck[];
}

export interface PreProjectReadinessResult {
  target: "pricing";
  ready: boolean;
  stateHash: string;
  case: PreProjectReadinessFacts["case"];
  summary: {
    includedItemCount: number;
    evaluatedItemCount: number;
    readyItemCount: number;
    blockerCount: number;
    warningCount: number;
  };
  checks: PreProjectReadinessCheck[];
  items: PreProjectItemReadiness[];
  blockers: PreProjectReadinessCheck[];
  warnings: PreProjectReadinessCheck[];
  nextActions: PreProjectReadinessAction[];
}

const check = (
  code: string,
  label: string,
  state: PreProjectReadinessState,
  blocking: boolean,
  detail: string,
  action?: PreProjectReadinessAction,
  scopeItemId?: string,
): PreProjectReadinessCheck => ({
  code,
  label,
  state,
  blocking,
  detail,
  ...(scopeItemId ? { scopeItemId } : {}),
  ...(action ? { action } : {}),
});

function action(
  code: PreProjectReadinessActionCode,
  label: string,
  targetType: PreProjectReadinessAction["targetType"],
  targetId: string,
): PreProjectReadinessAction {
  return { code, label, targetType, targetId };
}

function unresolved(value: PreProjectReadinessCheck) {
  return value.state !== "satisfied" && value.state !== "not_applicable";
}

function materialWarning(item: PreProjectItemFact) {
  return (item.specification?.materials ?? []).some((material) =>
    ["proposed", "change_requested"].includes(material.status ?? ""),
  );
}

function evaluateItem(
  item: PreProjectItemFact | undefined,
  reference: PricingScopeReference,
): PreProjectItemReadiness {
  const itemId = item?.id ?? reference.scopeId;
  const title = item?.title ?? reference.title;
  const checks: PreProjectReadinessCheck[] = [];

  if (!item) {
    checks.push(
      check(
        "scope_exists",
        "Scope item exists",
        "missing",
        true,
        `${title} is no longer available in this Preparation. Refresh the quotation scope.`,
        action(
          "REFRESH_QUOTATION_SCOPE",
          "Refresh quotation scope",
          "scope_item",
          itemId,
        ),
        itemId,
      ),
    );
    return {
      scopeItemId: itemId,
      title,
      roomId: null,
      roomName: null,
      scopeVersion: null,
      specificationVersion: null,
      ready: false,
      checks,
    };
  }

  const activeIncluded = !item.archivedAt && item.scopeStatus === "included";
  checks.push(
    check(
      "scope_included",
      "Scope item is included",
      activeIncluded ? "satisfied" : "blocked",
      true,
      activeIncluded
        ? `${title} is included in the current scope.`
        : `${title} is archived or no longer included. Refresh the quotation scope.`,
      activeIncluded
        ? undefined
        : action(
            "REFRESH_QUOTATION_SCOPE",
            "Refresh quotation scope",
            "scope_item",
            item.id,
          ),
      item.id,
    ),
  );

  if (!activeIncluded) {
    return {
      scopeItemId: item.id,
      title: item.title,
      roomId: item.roomId,
      roomName: item.roomName,
      scopeVersion: item.version,
      specificationVersion: item.specificationVersion,
      ready: false,
      checks,
    };
  }

  const scopeCurrent =
    reference.scopeVersion !== undefined &&
    reference.scopeVersion === item.version;
  checks.push(
    check(
      "scope_version_current",
      "Scope version is current",
      scopeCurrent ? "satisfied" : "stale",
      true,
      scopeCurrent
        ? `${title} uses the current scope revision.`
        : `${title} changed after it was imported. Refresh the quotation scope.`,
      scopeCurrent
        ? undefined
        : action(
            "REFRESH_QUOTATION_SCOPE",
            "Refresh quotation scope",
            "scope_item",
            item.id,
          ),
      item.id,
    ),
  );

  const hasSpecification = item.specificationVersion !== null;
  checks.push(
    check(
      "specification_exists",
      "Item specification exists",
      hasSpecification ? "satisfied" : "missing",
      true,
      hasSpecification
        ? `${title} has a versioned item specification.`
        : `Complete the item specification for ${title} before quotation review.`,
      hasSpecification
        ? undefined
        : action(
            "CREATE_SPECIFICATION",
            "Complete item specification",
            "scope_item",
            item.id,
          ),
      item.id,
    ),
  );

  const specificationCurrent =
    hasSpecification &&
    reference.specificationVersion !== undefined &&
    reference.specificationVersion === item.specificationVersion;
  checks.push(
    check(
      "specification_version_current",
      "Specification version is current",
      specificationCurrent
        ? "satisfied"
        : hasSpecification
          ? "stale"
          : "missing",
      true,
      specificationCurrent
        ? `${title} uses the current specification revision.`
        : hasSpecification
          ? `${title}'s specification changed after quotation import. Refresh the quotation scope.`
          : `Complete the item specification for ${title} before quotation review.`,
      specificationCurrent
        ? undefined
        : action(
            hasSpecification
              ? "REFRESH_QUOTATION_SCOPE"
              : "CREATE_SPECIFICATION",
            hasSpecification
              ? "Refresh quotation scope"
              : "Complete item specification",
            "scope_item",
            item.id,
          ),
      item.id,
    ),
  );

  const measurement = item.measurement;
  const measurementVerified = measurement?.status === "verified";
  checks.push(
    check(
      "measurement_verified",
      "Site measurement is verified",
      measurementVerified
        ? "satisfied"
        : measurement?.status === "recheck"
          ? "stale"
          : "missing",
      true,
      measurementVerified
        ? `${title} has independently verified site measurements.`
        : measurement
          ? `Verify the site measurements for ${title} before quotation review.`
          : `Record and verify the site measurements for ${title} before quotation review.`,
      measurementVerified
        ? undefined
        : action(
            measurement ? "VERIFY_MEASUREMENT" : "RECORD_MEASUREMENT",
            measurement ? "Verify measurement" : "Record measurement",
            "site",
            measurement?.id ?? item.id,
          ),
      item.id,
    ),
  );

  const measurementEvidence = Boolean(measurement?.hasEvidence);
  checks.push(
    check(
      "measurement_evidence",
      "Measurement has evidence",
      !measurement
        ? "not_applicable"
        : measurementEvidence
          ? "satisfied"
          : "missing",
      Boolean(measurement),
      !measurement
        ? `Record a measurement for ${title} before adding its evidence.`
        : measurementEvidence
        ? `${title}'s measurement is supported by a file.`
        : `Add measurement evidence for ${title} before quotation review.`,
      !measurement || measurementEvidence
        ? undefined
        : action(
            "ADD_MEASUREMENT_EVIDENCE",
            "Add measurement evidence",
            "site",
            measurement?.id ?? item.id,
          ),
      item.id,
    ),
  );

  const designs = item.designs.filter(
    (design) => design.number > 0 && design.versionId,
  );
  const designsLinked = designs.length > 0;
  checks.push(
    check(
      "design_linked",
      "Design revision is linked",
      designsLinked ? "satisfied" : "missing",
      true,
      designsLinked
        ? `${title} links exact design revisions.`
        : `Link the applicable design revision for ${title} before quotation review.`,
      designsLinked
        ? undefined
        : action(
            "LINK_DESIGN_REVISION",
            "Link design revision",
            "design",
            item.id,
          ),
      item.id,
    ),
  );

  const designsApproved =
    designsLinked && designs.every((design) => design.status === "approved");
  checks.push(
    check(
      "designs_approved",
      "Linked designs are client-approved",
      !designsLinked
        ? "not_applicable"
        : designsApproved
          ? "satisfied"
          : "blocked",
      designsLinked,
      !designsLinked
        ? `Link a design revision for ${title} before completing approval.`
        : designsApproved
        ? `${title}'s linked design revisions are client-approved.`
        : `Approve every linked design revision for ${title} before quotation review.`,
      !designsLinked || designsApproved
        ? undefined
        : action(
            "APPROVE_DESIGN_REVISION",
            "Complete design approval",
            "design",
            designs[0]?.designId ?? item.id,
          ),
      item.id,
    ),
  );

  const hasBlockingFeedback = designs.some((design) => design.blockingOpen);
  checks.push(
    check(
      "design_feedback_closed",
      "Blocking design feedback is closed",
      !designsLinked
        ? "not_applicable"
        : hasBlockingFeedback
          ? "blocked"
          : "satisfied",
      designsLinked,
      !designsLinked
        ? `Link a design revision for ${title} before reviewing feedback.`
        : hasBlockingFeedback
        ? `Resolve open blocking design feedback for ${title} before quotation review.`
        : `${title} has no open blocking design feedback.`,
      designsLinked && hasBlockingFeedback
        ? action(
            "RESOLVE_DESIGN_FEEDBACK",
            "Resolve design feedback",
            "design",
            designs.find((design) => design.blockingOpen)?.designId ?? item.id,
          )
        : undefined,
      item.id,
    ),
  );

  if (item.reviewStatus !== "reviewed") {
    checks.push(
      check(
        "requirement_review",
        "Requirement review",
        "missing",
        false,
        `${title} is still ${item.reviewStatus === "clarification" ? "waiting for clarification" : "captured but not reviewed"}.`,
        action(
          "REVIEW_REQUIREMENT",
          "Review requirement",
          "scope_item",
          item.id,
        ),
        item.id,
      ),
    );
  }

  if (designs.some((design) => design.latestNumber > design.number)) {
    checks.push(
      check(
        "newer_design_revision",
        "Newer design revision",
        "stale",
        false,
        `${title} has a newer design revision than the one linked to its specification. Review whether the quotation should use it.`,
        action(
          "REVIEW_NEWER_DESIGN_REVISION",
          "Review newer design revision",
          "design",
          designs.find((design) => design.latestNumber > design.number)
            ?.designId ?? item.id,
        ),
        item.id,
      ),
    );
  }

  if (materialWarning(item)) {
    checks.push(
      check(
        "material_selection_pending",
        "Material selection",
        "missing",
        false,
        `${title} has proposed or change-requested material selections.`,
        action(
          "COMPLETE_MATERIAL_SELECTION",
          "Complete material selection",
          "scope_item",
          item.id,
        ),
        item.id,
      ),
    );
  }

  return {
    scopeItemId: item.id,
    title: item.title,
    roomId: item.roomId,
    roomName: item.roomName,
    scopeVersion: item.version,
    specificationVersion: item.specificationVersion,
    ready: !checks.some((value) => value.blocking && unresolved(value)),
    checks,
  };
}

export function evaluatePreProjectReadiness(
  facts: PreProjectReadinessFacts,
  options: EvaluatePreProjectReadinessOptions = {},
): PreProjectReadinessResult {
  const target = options.target ?? "pricing";
  const requireIncludedScope = options.requireIncludedScope ?? true;
  const checks: PreProjectReadinessCheck[] = [];
  const active = facts.case.status === "active";
  checks.push(
    check(
      "engagement_active",
      "Engagement is active",
      active ? "satisfied" : "blocked",
      true,
      active
        ? "Preparation is active."
        : "Resume or reopen this Preparation before sending a quotation for review.",
      active
        ? undefined
        : action(
            "RESUME_ENGAGEMENT",
            "Resume Preparation",
            "engagement",
            facts.case.id,
          ),
    ),
  );

  const included = facts.items.filter(
    (item) => !item.archivedAt && item.scopeStatus === "included",
  );
  if (requireIncludedScope) {
    checks.push(
      check(
        "included_scope",
        "Included scope exists",
        included.length ? "satisfied" : "missing",
        true,
        included.length
          ? `${included.length} included scope ${included.length === 1 ? "item is" : "items are"} available.`
          : "Add at least one included scope item before preparing a quotation.",
        included.length
          ? undefined
          : action(
              "ADD_INCLUDED_SCOPE",
              "Add included scope",
              "engagement",
              facts.case.id,
            ),
      ),
    );
  }

  const hasSitePlan = facts.sitePlanCount > 0;
  checks.push(
    check(
      "site_plan",
      "Current site plan exists",
      hasSitePlan ? "satisfied" : "missing",
      true,
      hasSitePlan
        ? "A current site plan or reference file is available."
        : "Add the current site plan before submitting the quotation for review.",
      hasSitePlan
        ? undefined
        : action(
            "ADD_SITE_PLAN",
            "Add current site plan",
            "site",
            facts.case.id,
          ),
    ),
  );

  if (facts.openObservationCount > 0) {
    checks.push(
      check(
        "open_site_observations",
        "Open site observations",
        "blocked",
        false,
        `${facts.openObservationCount} site ${facts.openObservationCount === 1 ? "observation remains" : "observations remain"} open.`,
        action(
          "RESOLVE_SITE_OBSERVATION",
          "Review site observations",
          "site",
          facts.case.id,
        ),
      ),
    );
  }

  const references = options.scopeReferences ?? included.map((item) => ({
    scopeId: item.id,
    title: item.title,
    scopeVersion: item.version,
    specificationVersion: item.specificationVersion ?? undefined,
  }));
  const duplicateIds = new Set<string>();
  const seen = new Set<string>();
  for (const reference of references) {
    if (seen.has(reference.scopeId)) duplicateIds.add(reference.scopeId);
    seen.add(reference.scopeId);
  }
  for (const id of [...duplicateIds].sort()) {
    checks.push(
      check(
        "duplicate_scope_reference",
        "Duplicate scope reference",
        "blocked",
        true,
        "The quotation contains the same Preparation scope item more than once. Remove the duplicate before review.",
        action(
          "REFRESH_QUOTATION_SCOPE",
          "Refresh quotation scope",
          "scope_item",
          id,
        ),
        id,
      ),
    );
  }

  const byId = new Map(facts.items.map((item) => [item.id, item]));
  const items = references
    .filter(
      (reference, index, values) =>
        values.findIndex((value) => value.scopeId === reference.scopeId) ===
        index,
    )
    .map((reference) => evaluateItem(byId.get(reference.scopeId), reference))
    .sort((left, right) =>
      `${left.roomName ?? ""}\u0000${left.title}\u0000${left.scopeItemId}`.localeCompare(
        `${right.roomName ?? ""}\u0000${right.title}\u0000${right.scopeItemId}`,
      ),
    );

  const allChecks = [...checks, ...items.flatMap((item) => item.checks)];
  const blockers = allChecks.filter(
    (value) => value.blocking && unresolved(value),
  );
  const warnings = allChecks.filter(
    (value) => !value.blocking && unresolved(value),
  );
  const actionKeys = new Set<string>();
  const nextActions = [...blockers, ...warnings]
    .flatMap((value) => (value.action ? [value.action] : []))
    .filter((value) => {
      const key = `${value.code}:${value.targetType}:${value.targetId}`;
      if (actionKeys.has(key)) return false;
      actionKeys.add(key);
      return true;
    });
  const stateHash = canonicalHash({
    target,
    case: facts.case,
    sitePlanCount: facts.sitePlanCount,
    openObservationCount: facts.openObservationCount,
    references,
    items: facts.items.map((item) => ({
      id: item.id,
      version: item.version,
      scopeStatus: item.scopeStatus,
      reviewStatus: item.reviewStatus,
      archivedAt: item.archivedAt,
      specificationVersion: item.specificationVersion,
      specification: item.specification,
      measurement: item.measurement,
      designs: item.designs,
    })),
  });

  return {
    target,
    ready: blockers.length === 0,
    stateHash,
    case: facts.case,
    summary: {
      includedItemCount: included.length,
      evaluatedItemCount: items.length,
      readyItemCount: items.filter((item) => item.ready).length,
      blockerCount: blockers.length,
      warningCount: warnings.length,
    },
    checks,
    items,
    blockers,
    warnings,
    nextActions,
  };
}
