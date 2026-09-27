export type SiteReportStatus = "draft" | "submitted" | "approved" | "returned";
export type Safety = "none" | "observation" | "incident";
export type Outlook = "none" | "watch" | "blocked";

/** One person's day on a project's site. */
export type SiteReport = {
  id: string; reportDate: string; authorId: string; authorName: string; status: SiteReportStatus; weather: string; safety: Safety; safetyNote: string; forecast: Outlook; impact: string;
  recoveryOwnerId: string | null; recoveryOwnerName: string | null; recoveryOn: string | null; noWorkReason: string; notes: string; decidedByName: string | null; decisionNote: string; version: number;
  workforce: Array<{ trade: string; people: number }>;
  lines: Array<{ id: string; boqLineId: string; title: string; unit: string; installed: string; note: string }>;
  photos: Array<{ id: string; name: string; shared?: boolean }>;
};
/** A scope line with what approved reports installed and what submitted ones would add. */
export type SiteLine = { id: string; title: string; unit: string; quantity: string; supply: string | null; catalogItemId: string | null; areaName: string | null; installed: string; pending: string };
export type SiteState = {
  site: { startedOn: string | null; finishedOn: string | null }; reports: SiteReport[]; lines: SiteLine[]; members: Array<{ membershipId: string; name: string }>;
  today: string; me: string; canReport: boolean; canApprove: boolean; canManage: boolean;
};

export type HandoverKind = "drawing" | "warranty" | "manual" | "care_guide" | "photo" | "other";
export type HandoverMethod = "signed_document" | "in_person" | "email" | "portal";
/** What the client receives for the whole project or some areas; frozen once issued. */
export type HandoverPack = {
  id: string; revision: number; title: string; areaIds: string[]; status: "draft" | "issued" | "accepted" | "refused"; replacesId: string | null; contentHash: string | null;
  issuedAt: string | null; issuedByName: string | null; decidedOn: string | null; decidedByName: string | null; decisionMethod: HandoverMethod | null; decisionNote: string; version: number;
  documents: Array<{ id: string; kind: HandoverKind; title: string; name: string; size: number; sha256: string }>;
};
export type HandoverState = { packs: HandoverPack[]; areas: Array<{ id: string; name: string }>; covered: boolean; canManage: boolean };

export type Supply = "make" | "buy" | "ready_made" | "subcontract" | "client" | "site_work";
/** A scope line's warranty: from the handover it was accepted in, for its months. */
export type WarrantyItem = { lineId: string; title: string; areaName: string | null; supply: Supply | null; months: number; startsOn: string; endsOn: string; note: string; active: boolean };
export type ClaimStatus = "open" | "covered" | "not_covered" | "chargeable";
export type WarrantyClaim = {
  id: string; number: number; raisedOn: string; raisedByName: string; channel: "phone" | "email" | "visit" | "message" | "portal"; description: string; areaId: string | null; lineId: string | null;
  lineTitle: string | null; status: ClaimStatus; decisionNote: string; decidedByName: string | null; snagId: string | null; snagNumber: number | null; snagStatus: string | null; version: number;
};
export type WarrantyState = {
  items: WarrantyItem[]; claims: WarrantyClaim[]; lines: Array<{ id: string; title: string }>; areas: Array<{ id: string; name: string }>; today: string; canRecord: boolean; canManage: boolean;
};
export type WarrantySettings = { months: Record<Supply, number>; canManage: boolean };
