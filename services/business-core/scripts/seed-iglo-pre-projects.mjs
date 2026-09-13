// Add cases for existing demo opportunities only; never create or change CRM records.
const base = process.env.PRE_PROJECT_API_URL ?? "http://127.0.0.1:8131/api/v1";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname) || process.env.NODE_ENV === "production") throw new Error("This seed is local-development only.");
const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@igloarchitects.com", password: process.env.DEMO_PASSWORD ?? "IgloDemo#2026", tenantSlug: "iglo-architects" }) });
if (!login.ok) throw new Error(`Demo login failed (${login.status})`);
const { accessToken } = await login.json();
async function request(path, body) {
  const response = await fetch(`${base}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(`${path} failed (${response.status})`);
  return response.json();
}
const profile = await request("/me");
const workspace = profile.memberships.find((membership) => membership.workspaceSlug === "iglo-architects");
if (!workspace) throw new Error("Demo workspace is not available to this user.");
const path = `/workspaces/${workspace.workspaceId}/pre-projects`;
const candidates = await request(`${path}/candidates`);
for (const opportunity of candidates.items.slice(0, 2)) {
  const first = await request(path, { opportunityId: opportunity.id });
  const repeat = await request(path, { opportunityId: opportunity.id });
  if (first.id !== repeat.id) throw new Error("Repeated start must open the same case.");
  console.log(`${opportunity.caseId ? "Existing" : "Seeded"} case: ${first.title} (${first.id})`);
}
const result = await request(path);
console.log(`${result.total} saved pre-projects. CRM statuses, approvals and execution records unchanged.`);
