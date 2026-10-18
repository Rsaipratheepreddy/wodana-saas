import { ForbiddenException } from "@nestjs/common";
import type { FoundItem, ItemPrice } from "../../catalog-core/catalog-v2.service";
import type { Supplier } from "../../purchasing/suppliers";
import { ToolInputError, type AiTool, type AiToolContext } from "../ai-tool";
import { clip, ref } from "../tool-kit";
import type { ToolServices } from "../tool-services";

/** Who may see what an item costs the firm (the catalogue's own cost-visibility rule). */
export const COST_PERMISSIONS = ["commercial.costs.view", "supplier_offers.view"];
/** Anyone who keeps, counts, receives or buys stock may read it (the inventory module's own rule). */
export const STOCK_VIEW_PERMISSIONS = ["stock.view", "stock.manage", "stock.adjust", "stock.receive", "purchasing.view"];

const searchParameters = (what: string) => ({
  type: "object" as const,
  properties: {
    text: { type: "string" as const, description: what, maxLength: 120 },
    limit: { type: "integer" as const, description: "Up to 10 (default 6)" },
  },
  required: ["text"],
});

function searchText(input: Record<string, unknown>) {
  const text = String(input.text ?? "").trim();
  if (text.length < 2) throw new ToolInputError("Search with at least 2 characters");
  return { search: text, limit: Math.min(Math.max(Number(input.limit ?? 6) || 6, 1), 10) };
}

/** A module's refusal for a member without access, said plainly. */
async function withAccess<T>(what: string, work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof ForbiddenException) throw new ForbiddenException(`No access: this person can't view ${what}.`);
    throw error;
  }
}

const URL_TEXT = /^https?:\/\/\S+$/i;
const WEBSITE_LABEL = /web|site|url|link|shop|online/i;
const EMAIL_TEXT = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_TEXT = /\+?\d[\d\s().-]{6,}\d/;
/** Extra columns that hold contact or bank details: like a client's number or email, they stay out of the model's context. */
const PRIVATE_LABEL = /phone|mobile|tel\b|telephone|whats\s*app|e-?mail|fax|bank|iban|swift|account/i;

/** "W 220 × D 95 × H 80 cm", from the sizes the item has. */
function sizeText(size: FoundItem["size"]) {
  if (!size) return null;
  const parts = ([["W", size.width], ["D", size.depth], ["H", size.height]] as const).filter(([, value]) => value).map(([label, value]) => `${label} ${Number(value)}`);
  return parts.length ? `${parts.join(" × ")} ${size.unit}` : null;
}

/** The selling price as the model may state it, or why there is none to state. */
function priceFacts(price: ItemPrice) {
  if (price.status === "active") {
    if (price.amount === null) return { sellingPrice: null, priceNote: price.note ?? "Price on request" };
    return {
      sellingPrice: { amount: price.amount, currency: price.currency, per: price.per, ...(price.minimumCharge ? { minimumCharge: price.minimumCharge } : {}), ...(price.tiers?.length ? { byQuantity: price.tiers } : {}) },
      ...(price.note ? { priceNote: price.note } : {}),
    };
  }
  return {
    sellingPrice: null,
    priceNote: price.status === "none" ? "Price on request: no price is set"
      : price.status === "not_live" ? "Price on request: its price is approved but its price book isn't in use yet"
        : `Price on request: its price is still a ${price.status === "draft" ? "draft" : "reviewed draft"}, not approved yet`,
  };
}

function catalogFacts(item: FoundItem, context: AiToolContext, showCost: boolean) {
  const website = item.attributes.find((attribute) => URL_TEXT.test(attribute.value.trim()) && WEBSITE_LABEL.test(attribute.label))?.value.trim() ?? null;
  const attributes = item.attributes.filter((attribute) => attribute.value.trim() && attribute.value.trim() !== website && !PRIVATE_LABEL.test(attribute.label))
    .slice(0, 12).map((attribute) => ({ [clip(attribute.label, 60) ?? "Attribute"]: clip(attribute.value, 200) }));
  return {
    source: context.cite(ref("catalog_item", item.id, item.name)),
    name: item.name, code: item.code, category: item.categoryName, kind: item.itemType, catalogue: item.catalogName, unit: item.unitCode,
    ...priceFacts(item.price),
    ...(showCost && item.cost ? { cost: item.cost } : {}),
    size: sizeText(item.size), technicalDrawing: item.technicalDrawingUrl, websiteLink: website, productionDays: item.productionDays,
    description: clip(item.description, 300), attributes,
  };
}

const TERMS: Record<Supplier["paymentTerms"], string> = { upfront: "Paid upfront", on_delivery: "Paid on delivery", split: "Split: advance, then balance", credit: "On credit", statement: "Monthly statement" };
const APPROVAL: Record<Supplier["approval"], string> = { pending: "Not reviewed yet", approved: "Approved", not_approved: "Not approved", on_hold: "On hold" };

function supplierFacts(supplier: Supplier & { companies: string[] }, context: AiToolContext) {
  const terms = [TERMS[supplier.paymentTerms] ?? supplier.paymentTerms, supplier.advancePercent ? `${supplier.advancePercent}% advance` : null,
    supplier.creditDays ? `${supplier.creditDays} days` : null, clip(supplier.termsNote, 160)].filter(Boolean).join(", ");
  const attributes = supplier.attributes.filter((attribute) => attribute.value.trim() && !PRIVATE_LABEL.test(attribute.name) && !EMAIL_TEXT.test(attribute.value) && !PHONE_TEXT.test(attribute.value))
    .slice(0, 10).map((attribute) => ({ [clip(attribute.name, 60) ?? "Detail"]: clip(attribute.value, 200) }));
  return {
    source: context.cite(ref("supplier", supplier.id, supplier.name)),
    name: supplier.name, code: supplier.code, supplies: supplier.categories, approval: APPROVAL[supplier.approval] ?? supplier.approval,
    ...(supplier.preferredFor.length ? { preferredFor: supplier.preferredFor } : {}),
    paymentTerms: terms, contactPerson: supplier.contactName,
    // Whether the supplier has a number or email to reach; the values themselves stay out of the model's context (as for clients).
    hasPhone: Boolean(supplier.phone), hasEmail: Boolean(supplier.email), area: supplier.locality,
    companies: supplier.companies, status: supplier.status, notes: clip(supplier.notes, 300), attributes,
  };
}

/**
 * Woddy's product, stock and supplier reads. Each goes through its module's own service, as the person, so the
 * module's permissions and the workspace's RLS apply; nothing is computed from outside it.
 */
export function productTools(services: ToolServices): AiTool[] {
  const searchCatalog: AiTool = {
    name: "search_catalog",
    description: "Find catalogue products and materials by name, code, category or attribute words (e.g. \"Harriet sofa\", \"oak dining table\"). Returns each item's category, kind, selling price (only an approved, live price), size, technical drawing link, key attributes and website link. Use it for every product or price question.",
    kind: "read",
    confirmation: "none",
    calls: "CatalogV2Service.findItems",
    permissions: ["catalog.view"],
    parameters: searchParameters("Product name, code, category or attribute words"),
    async run(context, input) {
      const found = await withAccess("the catalogue", () => services.catalog.findItems(context.actor, context.workspaceId, searchText(input)));
      // Cost only when the catalogue allowed it and the person holds a cost permission.
      const showCost = found.canViewCosts && COST_PERMISSIONS.some((code) => context.permissions.has(code));
      return { data: { items: found.items.map((item) => catalogFacts(item, context, showCost)), count: found.items.length } };
    },
  };

  const checkStock: AiTool = {
    name: "check_stock",
    description: "Stock of an item by name or code: on hand, held for deals, free to use, its unit, where it is, and whether it is at or below its reorder level. Use it for every \"is it in stock\" or \"how many do we have\" question.",
    kind: "read",
    confirmation: "none",
    calls: "InventoryService.lookup",
    permissions: [],
    anyPermissions: STOCK_VIEW_PERMISSIONS,
    parameters: searchParameters("Item name or code"),
    async run(context, input) {
      const found = await withAccess("stock", () => services.inventory.lookup(context.actor, context.workspaceId, searchText(input)));
      return { data: { count: found.items.length, items: found.items.map((item) => ({
        source: context.cite(ref("stock_item", item.id, item.name)), name: item.name, code: item.code || null, unit: item.unit || null,
        onHand: item.onHand, held: item.held, free: item.free, ...(item.forProjects !== "0" ? { ownedByProjects: item.forProjects } : {}),
        places: item.places,
        lowStock: item.low, ...(item.low === null ? { reorderNote: "No reorder level set" } : { reorderPoints: item.reorderPoints }),
      })) } };
    },
  };

  const searchSuppliers: AiTool = {
    name: "search_suppliers",
    description: "Find suppliers by name, what they supply (e.g. \"marble\", \"upholstery\") or words from their notes. Returns what each supplies, approval, payment terms, contact person, whether a phone and email are on file, and the firm's companies that buy from them.",
    kind: "read",
    confirmation: "none",
    calls: "SuppliersService.find",
    permissions: ["vendors.view"],
    parameters: searchParameters("Supplier name, what they supply, or words from their notes"),
    async run(context, input) {
      const found = await withAccess("suppliers", () => services.suppliers.find(context.actor, context.workspaceId, searchText(input)));
      return { data: { suppliers: found.suppliers.map((supplier) => supplierFacts(supplier, context)), count: found.suppliers.length } };
    },
  };

  return [searchCatalog, checkStock, searchSuppliers];
}
