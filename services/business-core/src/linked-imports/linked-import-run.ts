import type { PoolClient } from "pg";
import type { ColumnMapping, ImportTarget, PlannedRow, SourceRow } from "./linked-import-source";

/** What a link imports into, and how. */
export type LinkSettings = {
  id: string | null; target: ImportTarget; name: string;
  catalogId: string | null; locationId: string | null; itemType: string | null; setsStock: boolean;
  /** Suppliers: the company the sheet's suppliers sell to (added to each), when it's one company's list. */
  legalEntityId: string | null;
  /** How the sheet's columns map (the chosen tabs, and for suppliers each tab's company). */
  mapping?: ColumnMapping;
  /** Catalog: the sheet's prices are approved list prices (live at once when the run's member may approve prices). */
  approvedPrices?: boolean;
};

/** Which Wodana record a key became (and, for stock, at which place and the quantity last taken from the sheet). */
export type LinkRecord = { id: string; key: string; locationId: string | null; recordId: string; lastQuantity: string | null; missingSince: string | null };
export const recordKey = (key: string, locationId: string | null) => `${key.trim().toLocaleLowerCase()}@${locationId ?? ""}`;

export type ImportContext = {
  client: PoolClient; workspaceId: string; userId: string; link: LinkSettings; records: Map<string, LinkRecord>;
  /** Catalog: this run puts the sheet's prices live (the link says so and the member may approve prices). */
  approvedPrices?: boolean;
  /** The run applying the plan (none for a preview), for the audit. */
  runId?: string | null;
};

/** What applying one row left: the record its key now names, and the quantity taken from the sheet. */
export type Applied = { recordId: string; locationId: string | null; quantity: string | null };

/** A planned row, and how to apply it (rows that change something); an unchanged row keeps its record as it is. */
export type Step = PlannedRow & { recordKey: string | null; locationId: string | null; apply?: () => Promise<Applied>; keep?: Applied };

/** A target reads its records once, then plans each row; applying runs the steps in order. */
export type TargetAdapter = {
  plan(context: ImportContext, rows: SourceRow[]): Promise<Step[]>;
  /** The names of records a link knows that are no longer in the sheet. */
  names(context: ImportContext, recordIds: string[]): Promise<Map<string, string>>;
  /** After applying (stock levels, notices). */
  finish?(context: ImportContext, applied: Applied[]): Promise<void>;
};
