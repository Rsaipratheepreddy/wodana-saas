/** P03.1 versioned Job tree projection. Source domains retain all business facts. */
export type OneTreeNodeKind = "site" | "room" | "zone" | "item";
export type OneTreeNodeStatus = "active" | "archived";
export type OneTreeSourceType = "case" | "room" | "brief_entry" | "manual";

export type OneTreeNode = {
  id: string;
  kind: OneTreeNodeKind;
  parentId: string | null;
  caseId: string;
  source: { type: OneTreeSourceType; id: string; version: number };
  status: OneTreeNodeStatus;
  identityVersion: number;
  revision: number;
  label: string;
  snapshot: Record<string, unknown>;
  replacesNodeId: string | null;
  createdAt: string;
  archivedAt: string | null;
};

export type OneTreeProjection = {
  schemaVersion: 1;
  jobId: string;
  generatedAt: string;
  nodes: OneTreeNode[];
  counts: Record<OneTreeNodeKind, number>;
};
