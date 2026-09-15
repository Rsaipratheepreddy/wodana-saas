import { canonicalHash } from "../crm/shared/crm-types";

export type DefinitionDecision = "confirmed" | "changes_requested";
export type DefinitionBaselineStatus =
  | "awaiting_confirmation"
  | "confirmed"
  | "changes_requested"
  | "superseded";

export type DefinitionIssueCode =
  | "ADD_INCLUDED_SCOPE"
  | "DECIDE_SCOPE"
  | "REVIEW_REQUIREMENT"
  | "CREATE_SPECIFICATION"
  | "COMPLETE_REFINED_REQUIREMENT"
  | "RESOLVE_MATERIAL_CHANGE";

export interface DefinitionIssue {
  code: DefinitionIssueCode;
  detail: string;
  scopeItemId?: string;
}

export interface DefinitionSourceItem {
  id: string;
  version: number;
  title: string;
  roomId: string | null;
  roomName: string | null;
  category: string;
  priority: string;
  scopeStatus: string;
  reviewStatus: string;
  source: string;
  quantity: number | null;
  unit: string;
  requirement: string;
  document: Record<string, unknown> | null;
  avoid: string;
  referenceUrl: string;
  catalog: Array<Record<string, unknown>>;
  evidenceFiles: Array<Record<string, unknown>>;
  specification: null | {
    version: number;
    refinedRequirement: string;
    construction: string;
    inclusions: string;
    exclusions: string;
    assumptions: string;
    materials: Array<Record<string, unknown>>;
    dimensions: Array<Record<string, unknown>>;
    designs: Array<Record<string, unknown>>;
  };
}

export interface DefinitionSourceSnapshot {
  schemaVersion: 1;
  caseId: string;
  brief: Record<string, unknown> & { version: number };
  rooms: Array<{ id: string; version: number; name: string }>;
  items: DefinitionSourceItem[];
}

const string = (value: unknown) =>
  typeof value === "string" ? value : "";
const nullableString = (value: unknown) =>
  typeof value === "string" && value ? value : null;
const nullableNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const records = (value: unknown) =>
  Array.isArray(value) ? value.map(record) : [];

function catalogReference(value: unknown) {
  const input = record(value);
  if (!input.id) return undefined;
  return {
    id: string(input.id),
    version: nullableNumber(input.version),
    name: string(input.name),
    code: string(input.code),
    catalogId: nullableString(input.catalogId),
  };
}

export function clientSafeSpecification(
  version: number,
  value: unknown,
  designs: Array<Record<string, unknown>>,
): NonNullable<DefinitionSourceItem["specification"]> {
  const input = record(value);
  return {
    version,
    refinedRequirement: string(input.refinedRequirement),
    construction: string(input.construction),
    inclusions: string(input.inclusions),
    exclusions: string(input.exclusions),
    assumptions: string(input.assumptions),
    materials: records(input.materials).map((material) => {
      const catalog = record(material.catalog);
      return {
        id: string(material.id),
        application: string(material.application),
        materialId: nullableString(material.materialId),
        brandId: nullableString(material.brandId),
        finishId: nullableString(material.finishId),
        productName: string(material.productName),
        productCode: string(material.productCode),
        finishCode: string(material.finishCode),
        stockSize: string(material.stockSize),
        status: string(material.status),
        selectedBy: string(material.selectedBy),
        selectedAt: nullableString(material.selectedAt),
        evidence: string(material.evidence),
        catalog: {
          material: catalogReference(catalog.material),
          brand: catalogReference(catalog.brand),
          finish: catalogReference(catalog.finish),
        },
      };
    }),
    dimensions: records(input.dimensions).map((dimension) => {
      const survey = record(dimension.siteSurvey);
      return {
        id: string(dimension.id),
        name: string(dimension.name),
        unit: string(dimension.unit),
        basis: string(dimension.basis),
        approximate: nullableNumber(dimension.approximate),
        measured: nullableNumber(dimension.measured),
        source: string(dimension.source),
        evidence: string(dimension.evidence),
        verification: string(dimension.verification),
        siteSurvey: survey.id
          ? {
              id: string(survey.id),
              version: nullableNumber(survey.version),
              status: string(survey.status),
            }
          : undefined,
      };
    }),
    designs: designs.map((design) => ({
      versionId: string(design.versionId),
      designId: string(design.designId),
      number: nullableNumber(design.number),
      title: string(design.title),
      documentType: string(design.documentType),
      status: string(design.status),
      usage: string(design.usage),
      sheet: string(design.sheet),
      fileName: string(design.fileName),
      mimeType: string(design.mimeType),
      sha256: string(design.sha256),
    })),
  };
}

export function definitionIssues(
  snapshot: DefinitionSourceSnapshot,
): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const included = snapshot.items.filter(
    (item) => item.scopeStatus === "included",
  );
  if (!included.length)
    issues.push({
      code: "ADD_INCLUDED_SCOPE",
      detail: "Add at least one included scope item before publishing the definition.",
    });
  for (const item of snapshot.items) {
    if (item.scopeStatus === "undecided")
      issues.push({
        code: "DECIDE_SCOPE",
        detail: `Decide whether ${item.title} is included or excluded.`,
        scopeItemId: item.id,
      });
    if (item.scopeStatus !== "undecided" && item.reviewStatus !== "reviewed")
      issues.push({
        code: "REVIEW_REQUIREMENT",
        detail: `Review ${item.title} before publishing the definition.`,
        scopeItemId: item.id,
      });
    if (item.scopeStatus !== "included") continue;
    if (!item.specification) {
      issues.push({
        code: "CREATE_SPECIFICATION",
        detail: `Complete the item specification for ${item.title}.`,
        scopeItemId: item.id,
      });
      continue;
    }
    if (!item.specification.refinedRequirement.trim())
      issues.push({
        code: "COMPLETE_REFINED_REQUIREMENT",
        detail: `Add the agreed requirement wording for ${item.title}.`,
        scopeItemId: item.id,
      });
    if (
      item.specification.materials.some(
        (material) => material.status === "change_requested",
      )
    )
      issues.push({
        code: "RESOLVE_MATERIAL_CHANGE",
        detail: `Resolve the requested material change for ${item.title}.`,
        scopeItemId: item.id,
      });
  }
  return issues;
}

export const definitionSourceHash = (snapshot: DefinitionSourceSnapshot) =>
  canonicalHash(snapshot);

export const definitionSnapshotHash = (
  snapshot: DefinitionSourceSnapshot,
  publication: { message: string },
) => canonicalHash({ definition: snapshot, publication });
