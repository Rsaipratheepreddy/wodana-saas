import { createContext } from "react";

/**
 * The firm's own quote columns that the client sees, for the proposal's items table. The quote editor
 * provides them; the proposal pages read them (nothing is saved in the page design).
 */
export type ProposalColumn = { id: string; name: string };
export const ProposalColumnsContext = createContext<ProposalColumn[]>([]);

/**
 * The quote's own facts for the proposal pages: its reference and dates as the app shows them, the
 * client's contact details, and every amount from the pricing engine (so the proposal, the quote and
 * the invoice always agree). Amounts are the engine's decimal strings.
 */
export type ProposalFacts = {
  reference: string; date: string; validUntil: string; phone: string; email: string; address: string; approvedBy: string; estimator?: string; designer?: string;
  subtotal: string; discount: string; net: string; tax: string; total: string; lineAmount: Record<string, string>;
};
export const ProposalFactsContext = createContext<ProposalFacts | null>(null);
