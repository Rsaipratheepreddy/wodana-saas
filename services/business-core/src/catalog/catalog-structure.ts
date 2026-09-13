export type CatalogField = { key:string; label:string; type:string; options?:string[]; min?:number; max?:number };
export type CatalogDefinition = { label:string; singular:string; group:string; description:string; fields:CatalogField[]; links:{relation:string;label:string;multiple:boolean;required:boolean}[] };
// Shared data contract; this relative path also resolves from dist/catalog.
export const catalogStructure:Record<string,CatalogDefinition> = require("../../../../packages/contracts/catalog-structure.json");
export const catalogKinds = Object.keys(catalogStructure);
