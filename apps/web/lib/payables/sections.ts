/** The tabs of Finance, one thing each. */
export const FINANCE_SECTIONS = ["bills", "payments", "suppliers"] as const;
export type FinanceSection = (typeof FINANCE_SECTIONS)[number];
