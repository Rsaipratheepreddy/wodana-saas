import { createContext } from "react";

/**
 * The firm's own quote columns that the client sees, for the proposal's items table. The quote editor
 * provides them; the proposal pages read them (nothing is saved in the page design).
 */
export type ProposalColumn = { id: string; name: string };
export const ProposalColumnsContext = createContext<ProposalColumn[]>([]);
