/** The tabs of Finance, one thing each. */
export const FINANCE_SECTIONS = ["bills", "payments", "runs", "suppliers", "petty-cash", "client-invoices", "accounting"] as const;
export type FinanceSection = (typeof FINANCE_SECTIONS)[number];
