/** The tabs of Purchasing, one thing each. */
export const PURCHASING_SECTIONS = ["to-order", "price-requests", "orders", "deliveries", "suppliers"] as const;
export type PurchasingSection = (typeof PURCHASING_SECTIONS)[number];
