import type { CatalogSelection } from "./commercial.types";

type Snapshot = Partial<CatalogSelection["snapshot"]>;
type Material = {
  application?: string;
  productName?: string;
  productCode?: string;
  finishCode?: string;
  stockSize?: string;
  status?: string;
  catalog?: { material?: Snapshot; brand?: Snapshot; finish?: Snapshot };
};

/** Carry the actual specification selections into commercial scope, not only their text. */
export function importedScopeCatalogLinks(source: {
  catalogLinks?: CatalogSelection[];
  specification?: { materials?: Material[] };
}): CatalogSelection[] {
  const links = [...(source.catalogLinks ?? [])];
  for (const material of source.specification?.materials ?? []) {
    if (material.status === "not_applicable") continue;
    for (const role of ["material", "brand", "finish"] as const) {
      const snapshot = material.catalog?.[role];
      if (!snapshot?.id || !snapshot.version || !snapshot.catalogId || !snapshot.kind || !snapshot.name) continue;
      if (links.some((link) => link.role === role && link.recordId === snapshot.id)) continue;
      links.push({ role, recordId: snapshot.id, version: snapshot.version, snapshot: snapshot as CatalogSelection["snapshot"] });
    }
  }
  return links;
}
export function importedScopeDetails(source: {
  note?: string;
  catalogLinks?: { role: string; snapshot: Snapshot }[];
  specification?: {
    refinedRequirement?: string;
    construction?: string;
    materials?: Material[];
    dimensions?: {
      name: string;
      measured?: number;
      approximate?: number;
      unit: string;
      verification?: string;
    }[];
  };
}) {
  const spec = source.specification,
    materials = (spec?.materials ?? []).filter(
      (m) => m.status !== "not_applicable",
    ),
    catalog = (role: string) =>
      source.catalogLinks?.find((c) => c.role === role)?.snapshot;
  const material = materials.length
    ? materials
        .map((m) =>
          [
            m.application,
            [
              m.productName || m.catalog?.material?.name,
              m.catalog?.brand?.name,
              m.productCode,
              m.stockSize,
            ]
              .filter(Boolean)
              .join(" · "),
            m.status === "change_requested"
              ? "Change requested"
              : m.status === "proposed"
                ? "Proposed"
                : "",
          ]
            .filter(Boolean)
            .join(": "),
        )
        .join("\n")
    : [catalog("material")?.name, catalog("brand")?.name]
        .filter(Boolean)
        .join(" · ");
  const finish = materials.length
    ? materials
        .map((m) =>
          [m.catalog?.finish?.name, m.finishCode].filter(Boolean).join(" · "),
        )
        .filter(Boolean)
        .join("\n")
    : (catalog("finish")?.name ?? "");
  const dimensions = (spec?.dimensions ?? [])
    .filter((d) => d.measured != null || d.approximate != null)
    .map(
      (d) =>
        `${d.name}: ${d.measured ?? d.approximate} ${d.unit}${d.measured == null ? " (approx.)" : d.verification !== "verified" ? " (to verify)" : ""}`,
    )
    .join(" · ");
  return {
    material,
    finish,
    specification: [
      spec?.refinedRequirement || source.note,
      spec?.construction,
      dimensions,
    ]
      .filter(Boolean)
      .map(value => value!.replace(/\r\n/g, "\n").replace(/\n(?:[ \t]*\n){2,}/g, "\n\n").trim())
      .join("\n"),
  };
}
