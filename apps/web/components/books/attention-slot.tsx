"use client";

import { LedgerAttention } from "./attention";

/** The Ledger's "Needs attention" tab: the posting issues list (slice B's LedgerAttention) for the workspace. */
export function LedgerAttentionSlot({ workspaceId }: { workspaceId: string; entityId: string | null }) {
  return <LedgerAttention workspaceId={workspaceId} />;
}
