import type { WorkspaceSearchResponse, WorkspaceSearchResult } from "@wodana/contracts";
import { invalidRequest, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const fixtureItems: WorkspaceSearchResult[] = [
  { id: "71000000-0000-4000-8000-000000000001", kind: "customer", title: "Amira Al Mansoori", subtitle: "Person · customer", reference: null, route: "/workspace/crm/customers?record=71000000-0000-4000-8000-000000000001" },
  { id: "91000000-0000-4000-8000-000000000001", kind: "job", title: "Jumeirah villa interiors", subtitle: "Job · Amira Al Mansoori", reference: "JOB-2026-001", route: "/workspace/crm/jobs/91000000-0000-4000-8000-000000000001" },
  { id: "00000000-0000-4000-8000-000000000101", kind: "room", title: "Reception", subtitle: "Jumeirah villa interiors · Amira Al Mansoori", reference: null, route: "/workspace/pre-projects/cases/00000000-0000-4000-8000-000000000001/requirements?room=00000000-0000-4000-8000-000000000101" },
  { id: "92000000-0000-4000-8000-000000000005", kind: "quotation", title: "Jumeirah villa proposal", subtitle: "issued · Amira Al Mansoori", reference: "Q-001", route: "/workspace/pre-projects/cases/00000000-0000-4000-8000-000000000001/quotations?quote=92000000-0000-4000-8000-000000000005" },
  { id: "demo", kind: "project", title: "Jumeirah villa delivery", subtitle: "Project · Amira Al Mansoori · active", reference: "PRJ-2026-001", route: "/workspace/projects/demo/overview" },
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const query = (url.searchParams.get("q") ?? "").trim();
  const rawLimit = url.searchParams.get("limit") ?? "20";
  const limit = Number(rawLimit);
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  if (query.length < 2 || query.length > 120) return invalidRequest("Enter between 2 and 120 characters.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) return invalidRequest("Use a result limit between 1 and 50.");

  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true") {
    const normalized = query.toLocaleLowerCase();
    const items = fixtureItems.filter((item) => [item.title, item.subtitle, item.reference]
      .some((value) => value?.toLocaleLowerCase().includes(normalized))).slice(0, limit);
    return Response.json({ query, items, searchedKinds: ["customer", "job", "room", "quotation", "project"], truncated: false } satisfies WorkspaceSearchResponse);
  }

  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/search?${params}`,
    { method: "GET" },
    "Workspace search could not be loaded.",
  );
}
