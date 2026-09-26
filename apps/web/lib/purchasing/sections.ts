/** The tabs of Purchasing, one thing each. */
export const PURCHASING_SECTIONS = ["to-order", "orders", "suppliers"] as const;
export type PurchasingSection = (typeof PURCHASING_SECTIONS)[number];
