/** The tabs of Inventory, one thing each. */
export const INVENTORY_SECTIONS = ["stock", "moves", "history"] as const;
export type InventorySection = (typeof INVENTORY_SECTIONS)[number];
