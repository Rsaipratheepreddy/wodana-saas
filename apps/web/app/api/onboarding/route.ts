import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const STEPS = new Set(["workspace_profile", "organization", "team", "integrations"]);

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const currentStep = typeof body?.currentStep === "string" ? body.currentStep : "";
  const completedSteps = Array.isArray(body?.completedSteps)
    ? body.completedSteps.filter((step): step is string => typeof step === "string")
    : [];
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  if (!Number.isInteger(body?.version) || Number(body?.version) < 1) return invalidRequest("Reload setup and try again.");
  if (!STEPS.has(currentStep) || completedSteps.some((step) => !STEPS.has(step)) || new Set(completedSteps).size !== completedSteps.length) {
    return invalidRequest("The onboarding step is not valid.");
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/onboarding`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: body?.version, currentStep, completedSteps }),
  }, "Setup progress could not be saved.");
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return invalidRequest("The request origin is not allowed.");
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId)) return invalidRequest("A valid workspace is required.");
  if (!Number.isInteger(body?.version) || Number(body?.version) < 1) return invalidRequest("Reload setup and try again.");
  return workspaceJsonResponse(`/workspaces/${workspaceId}/onboarding/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: body?.version }),
  }, "Workspace setup could not be completed.");
}
