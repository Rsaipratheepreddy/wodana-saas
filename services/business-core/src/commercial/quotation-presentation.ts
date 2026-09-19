import type { QuoteLine } from "./commercial.types";

export function quotationItemName(title: string, room: string) {
  for (const separator of [" · ", " — ", " - "]) {
    const suffix = separator + room;
    if (room && title.toLowerCase().endsWith(suffix.toLowerCase()))
      return title.slice(0, -suffix.length);
  }
  return title;
}

/** Concise, unit-aware finished size for the client document. */
export function quotationDimensionsText(dimensions?: QuoteLine["dimensions"]): string {
  if (!dimensions) return "";
  const values = (["length", "height", "depth"] as const)
    .filter((key) => dimensions[key] !== undefined)
    .map((key) => `${key[0].toUpperCase()} ${dimensions[key]}`);
  return values.length ? `${values.join(" × ")} ${dimensions.unit}` : "";
}

/** Remove appended catalog identifiers from generated summaries, preserving authored notes. */
export function quotationMaterialText(
  line: Pick<QuoteLine, "material" | "finish" | "catalogLinks">,
  role: "material" | "finish",
) {
  const labels = new Map(
    (line.catalogLinks ?? [])
      .filter((link) => link.role === role && link.snapshot.code)
      .map((link) => [
        `${link.snapshot.name} · ${link.snapshot.code}`,
        link.snapshot.name,
      ]),
  );
  return line[role]
    .split("\n")
    .map((part) => labels.get(part) ?? part)
    .join("\n");
}

/** Customer-facing copy only; never includes internal costs or catalog configuration. */
export function quotationDescription(
  line: Pick<
    QuoteLine,
    | "specification"
    | "material"
    | "finish"
    | "customMaterials"
    | "catalogLinks"
    | "materialRows"
  >,
) {
  const materials =
    line.materialRows !== undefined
      ? line.materialRows.map((row) =>
          [
            row.name,
            line.catalogLinks?.some(link =>
              ["material", "finish"].includes(link.role) &&
              link.snapshot.name === row.name && link.snapshot.code === row.specification
            ) ? "" : row.specification,
            row.suppliedByClient ? "Client supplied" : "",
          ]
            .filter(Boolean)
            .join(" · "),
        )
      : [
          quotationMaterialText(line, "material"),
          quotationMaterialText(line, "finish"),
          ...(line.customMaterials ?? []).map((m) =>
            [
              m.name,
              m.brand,
              m.specification,
              m.suppliedByClient ? "Client supplied" : "",
            ]
              .filter(Boolean)
              .join(" · "),
          ),
        ];
  const parts = [...materials, line.specification]
    .flatMap((value) => (value ?? "").split(/\n+/))
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return parts
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" · ");
}

export function quotationVariantName(
  name: string,
  item: string,
  room: string,
  code = "",
) {
  const skip = new Set(
    [item, quotationItemName(item, room), ...item.split(" · "), room]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const parts = name
    .split(" · ")
    .filter((part) => !skip.has(part.trim().toLowerCase()));
  // A short variant label can itself equal its code (e.g. "Standard"). Keep it.
  return (
    (parts.length > 1
      ? parts.filter(
          (part) => part.trim().toLowerCase() !== code.trim().toLowerCase(),
        )
      : parts
    ).join(" · ") || name
  );
}

/** Use the linked product identity even when the quotation item has been renamed. */
export function quotationLineVariant(
  line: Pick<QuoteLine, "title" | "room" | "catalogLinks" | "variant">,
) {
  if (line.variant !== undefined) return line.variant;
  const variant = line.catalogLinks?.find(
    (link) => link.role === "variant",
  )?.snapshot;
  const work = line.catalogLinks?.find(
    (link) => link.role === "work",
  )?.snapshot;
  return variant
    ? quotationVariantName(
        variant.name,
        work?.name ?? line.title,
        line.room,
        variant.code,
      )
    : undefined;
}
