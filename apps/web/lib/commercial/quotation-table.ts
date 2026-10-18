import type { Quote, QuoteLine, QuotationMaterialRow } from "./types";
import { tKey } from "@/lib/i18n/keys";
import type { CatalogChoice } from "@/lib/pre-project/content";
import { materialNotes } from "./materials";
export {
  materialAmount,
  materialsRate,
  pricedLine,
} from "../../../../services/business-core/src/commercial/quotation-pricing";

/** Legacy descriptions become editable rows only when edited; saved prices are untouched. */
export function quotationMaterialRows(line: QuoteLine): QuotationMaterialRow[] {
  if (line.materialRows) return line.materialRows;
  const rows: QuotationMaterialRow[] = (line.catalogLinks ?? [])
    .filter((c) => ["material", "finish"].includes(c.role))
    .map((c) => ({
      id: `${c.role}:${c.recordId}`,
      name: c.snapshot.name,
      type: c.role as "material" | "finish",
      specification: "",
      quantity: 1,
      unit: "nos",
      rate: 0,
      suppliedByClient: false,
    }));
  for (const type of ["material", "finish"] as const) {
    const note = materialNotes(line, type);
    if (note)
      rows.push({
        id: `legacy-${type}`,
        name: note.length <= 240 && !note.includes('\n') ? note : type === 'material' ? 'Material specification' : 'Finish specification',
        type,
        specification: note.length <= 240 && !note.includes('\n') ? '' : note,
        quantity: 1,
        unit: "nos",
        rate: 0,
        suppliedByClient: false,
      });
  }
  return [
    ...rows,
    ...(line.customMaterials ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      type: "material" as const,
      specification: [m.brand, m.code, m.specification]
        .filter(Boolean)
        .join(" · "),
      quantity: 1,
      unit: "nos",
      rate: 0,
      suppliedByClient: m.suppliedByClient,
    })),
  ];
}

export async function quotationPhoto(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  )
    throw new Error(tKey("Choose a PNG, JPEG or WebP image under 8 MB."));
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas"),
      scale = Math.min(1, 600 / image.width, 450 / image.height),
      width = Math.max(1, Math.round(image.width * scale)),
      height = Math.max(1, Math.round(image.height * scale));
    // A consistent 4:3 artboard makes mixed catalogue and uploaded images align
    // cleanly in the quotation without clipping the furniture itself.
    canvas.width = 600;
    canvas.height = 450;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(tKey("Could not prepare this photo."));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, Math.round((canvas.width - width) / 2), Math.round((canvas.height - height) / 2), width, height);
    for (const quality of [0.8, 0.6, 0.4, 0.2]) {
      const data = canvas.toDataURL("image/webp", quality);
      if (data.length <= 60000) return data;
    }
    throw new Error(tKey("Choose a smaller or simpler photo."));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const dimensionNames = {
  length: /^length\b/i,
  height: /^height\b/i,
  depth: /^depth\b/i,
} as const;

/** Only exact scalar dimensions are copied. Notes and compound dimensions stay as source text. */
export function catalogDimensions(
  ...records: Array<CatalogChoice | null | undefined>
): QuoteLine["dimensions"] | undefined {
  const values: Partial<Record<"length" | "height" | "depth", number>> = {};
  let selectedUnit: NonNullable<QuoteLine["dimensions"]>["unit"] | undefined;
  for (const record of records) {
    for (const attribute of record?.attributes ?? []) {
      const key = (Object.keys(dimensionNames) as Array<keyof typeof dimensionNames>)
        .find((candidate) => dimensionNames[candidate].test(attribute.name.trim()));
      if (!key || values[key] !== undefined) continue;
      const match = attribute.value.trim().match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m|in|ft)?$/i);
      const nameUnit = attribute.name.match(/\((mm|cm|m|in|ft)\)/i)?.[1]?.toLowerCase();
      const unit = (match?.[2]?.toLowerCase() ?? nameUnit) as NonNullable<QuoteLine["dimensions"]>["unit"] | undefined;
      const value = Number(match?.[1]);
      if (!match || !unit || !Number.isFinite(value) || value <= 0 || value > 1e6) continue;
      if (selectedUnit && selectedUnit !== unit) continue;
      selectedUnit = unit;
      values[key] = value;
    }
  }
  return selectedUnit && Object.keys(values).length ? { unit: selectedUnit, ...values } : undefined;
}

export async function applyCatalogMedia(
  workspaceId: string,
  line: QuoteLine,
  ...records: Array<CatalogChoice | null | undefined>
): Promise<QuoteLine> {
  const dimensions = line.dimensions ?? catalogDimensions(...records);
  if (line.photo) return { ...line, ...(dimensions ? { dimensions } : {}) };
  const asset = records.map((record) => record?.primaryAsset).find(Boolean);
  if (!asset) return { ...line, ...(dimensions ? { dimensions } : {}) };
  try {
    const query = new URLSearchParams({ workspaceId, preview: asset.hasPreview ? "1" : "0" });
    const response = await fetch(`/api/workspace/catalog/records/${asset.recordId}/assets/${asset.id}/content?${query}`);
    if (!response.ok) return { ...line, ...(dimensions ? { dimensions } : {}) };
    const blob = await response.blob();
    const photo = await quotationPhoto(new File([blob], asset.name, { type: blob.type || asset.mimeType }));
    return { ...line, photo, ...(dimensions ? { dimensions } : {}) };
  } catch {
    // Adding a catalogue item must still work when its optional media is unavailable.
    return { ...line, ...(dimensions ? { dimensions } : {}) };
  }
}

export async function applyQuoteCatalogMedia(
  workspaceId: string,
  quote: Quote,
  lineIds: ReadonlySet<string>,
): Promise<Quote> {
  const lines = await Promise.all(quote.lines.map(async (line) => {
    if (!lineIds.has(line.id)) return line;
    const variant = line.catalogLinks?.find((link) => link.role === "variant")?.snapshot;
    const work = line.catalogLinks?.find((link) => link.role === "work")?.snapshot;
    return applyCatalogMedia(workspaceId, line, variant, work);
  }));
  return { ...quote, lines };
}
