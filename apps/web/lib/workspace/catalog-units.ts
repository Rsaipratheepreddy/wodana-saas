import type { CatalogRecord } from "./catalog";
export const baseUnitNames:Record<string,string>={length:"metres",area:"square metres",volume:"cubic metres",mass:"kilograms",count:"each",time:"hours"};
export function unitMeaning(unit:CatalogRecord) {
 if(unit.dimension==="pack")return "Product-specific pack · define its quantity in the material’s Sizes & packs.";
 if(unit.dimension==="reference")return "Technical reference unit · no quantity conversion is defined.";
 return `1 ${unit.name||"unit"} = ${unit.baseFactor??"…"} ${baseUnitNames[unit.dimension]??unit.dimension}`;
}
/** Conversion is defined by dimension and factors, never by tenant-facing names. */
export function convertCatalogQuantity(quantity:number,from:CatalogRecord,to:CatalogRecord):number|null {
 if(!Number.isFinite(quantity)||from.kind!=="unit"||to.kind!=="unit"||from.dimension!==to.dimension||!baseUnitNames[from.dimension]||!Number.isFinite(from.baseFactor)||!Number.isFinite(to.baseFactor)||!(from.baseFactor!>0)||!(to.baseFactor!>0))return null;
 return quantity*from.baseFactor!/to.baseFactor!;
}
