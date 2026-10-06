/** The tabs of Factory, one thing each. */
export const FACTORY_SECTIONS = ["to-make", "orders", "schedule", "calendar", "batches", "samples"] as const;
export type FactorySection = (typeof FACTORY_SECTIONS)[number];
