export type WorkspaceSearchKind = "customer" | "job" | "room" | "quotation" | "project";

export type WorkspaceSearchResult = {
  id: string;
  kind: WorkspaceSearchKind;
  title: string;
  subtitle: string;
  reference: string | null;
  route: string;
};

export type WorkspaceSearchResponse = {
  query: string;
  items: WorkspaceSearchResult[];
  searchedKinds: WorkspaceSearchKind[];
  truncated: boolean;
};
