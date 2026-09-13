import type { QuoteLine, QuotationMaterialRow } from "./types";
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
    throw new Error("Choose a PNG, JPEG or WebP image under 8 MB.");
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas"),
      scale = Math.min(1, 600 / image.width, 600 / image.height);
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare this photo.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.6, 0.4, 0.2]) {
      const data = canvas.toDataURL("image/webp", quality);
      if (data.length <= 60000) return data;
    }
    throw new Error("Choose a smaller or simpler photo.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
