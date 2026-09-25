export type DefinitionIssue = { code: string; detail: string; scopeItemId?: string };
export type DefinitionItem = { requirement?: string; id: string; title: string; roomName: string | null; scopeStatus: string; quantity: number | null; unit: string; specification: null | { refinedRequirement: string } };
export type DefinitionBaseline = {
  id: string;
  number: number;
  status: "awaiting_confirmation" | "confirmed" | "changes_requested" | "superseded";
  current: boolean;
  message: string;
  publishedAt: string;
  publishedBy: string;
  decision: null | { decision: "confirmed" | "changes_requested"; decisionBy: string; channel: string; note: string; decidedAt: string };
  snapshot: { definition: { brief: { goals?: string; location?: string; timeline?: string }; rooms: { id: string; name: string }[]; items: DefinitionItem[] } };
};
export type DefinitionState = {
  caseStatus: string;
  draft: { sourceHash: string; readyToPublish: boolean; issues: DefinitionIssue[]; changes?:null|{briefChanged:boolean;rooms:{added:string[];removed:string[];changed:string[]};items:{added:string[];removed:string[];changed:string[]};total:number} };
  current: DefinitionBaseline | null;
  history: DefinitionBaseline[];
  confirmed: boolean;
  nextAction: string | null;
  canPublish: boolean;
  canRecordClientDecision: boolean;
};
export type ReadinessState = {
  ready: boolean;
  summary: { includedItemCount: number; readyItemCount: number; blockerCount: number; warningCount: number };
  blockers: { code: string; label: string; detail: string; scopeItemId?: string; action?: { code: string; label: string; targetType: string; targetId: string } }[];
};
export type DefinitionPageData = { workspaceId: string; caseId: string; definition: DefinitionState; readiness: ReadinessState } | { error: string };
