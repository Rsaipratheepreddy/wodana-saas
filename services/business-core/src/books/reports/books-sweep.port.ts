/**
 * The posting sweep (slice B, `src/books/posting`) runs on demand before every Ledger read, so a report shows what
 * happened up to now and not only up to the last 30-second sweep. The reports only know this port: posting provides
 * it (`{ provide: BOOKS_SWEEP, useExisting: <its sweep service> }`, exported) and the reports module imports posting.
 * Until then nothing is provided and reads go straight to the journals.
 */
export const BOOKS_SWEEP = "BOOKS_SWEEP";

export interface BooksSweepPort {
  /** Posts the workspace's pending source events now (bounded, under the sweep's own lock and transactions). */
  runSweepNow(workspaceId: string): Promise<unknown>;
}
