import type { QuoteLine } from "./commercial.types";

/** Execution receives the same material specification that the client accepted. */
export function quotationMaterialText(line: Pick<QuoteLine, "material" | "finish" | "customMaterials" | "materialRows">) {
  if (line.materialRows) return line.materialRows.map(row => [row.name, row.specification, row.suppliedByClient ? 'Client supplied' : ''].filter(Boolean).join(' · ')).join('\n\n');
  return [line.material, line.finish, ...(line.customMaterials ?? []).map(m => [m.name, m.brand, m.code, m.specification, m.suppliedByClient ? "Client supplied" : "Custom material"].filter(Boolean).join(" · "))].filter(Boolean).join("\n\n");
}
