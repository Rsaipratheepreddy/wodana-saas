export type CatalogRecordRole = "item" | "variant" | "assembly" | "assembly_component" | "catalog_record";

type RoleSource = { kind: string; configuration?: Record<string, unknown> };

/** Stable public vocabulary over the existing typed master-record storage. */
export function catalogRecordRole(record: RoleSource): CatalogRecordRole {
  if (record.kind === "work") return "item";
  if (record.kind === "variant") return "variant";
  if (record.kind === "construction")
    return record.configuration?.recordRole === "template" ? "assembly" : "assembly_component";
  return "catalog_record";
}
