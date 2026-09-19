import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import { WorkspaceOnboardingStep } from "./dto/update-onboarding.dto";
import { WorkspacesService } from "./workspaces.service";

const workspaceId = "d15556a6-cbc3-48e1-8233-fb8e7de7607c";
const actor: RequestActor = { subject: "local:owner", provider: "local", email: "owner@example.test", displayName: "Owner" };

describe("workspace onboarding checkpoints", () => {
  it("preserves finished steps across reads and rejects stale or regressive updates", async () => {
    let state = {
      workspace_id: workspaceId,
      status: "not_started",
      current_step: "workspace_profile",
      completed_steps: [] as string[],
      version: 1,
      started_at: null as Date | null,
      completed_at: null as Date | null,
    };
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT id FROM workspaces")) return { rowCount: 1, rows: [{ id: workspaceId }] };
      if (sql.includes("SELECT * FROM workspace_onboarding")) return { rowCount: 1, rows: [{ ...state }] };
      if (sql.includes("UPDATE workspace_onboarding")) {
        const expected = Number(values[sql.includes("status = 'completed'") ? 1 : 3]);
        if (expected !== state.version) return { rowCount: 0, rows: [] };
        state = sql.includes("status = 'completed'")
          ? { ...state, status: "completed", current_step: "complete", version: state.version + 1,
            started_at: state.started_at ?? new Date(), completed_at: new Date() }
          : { ...state, status: "in_progress", current_step: String(values[0]),
            completed_steps: JSON.parse(String(values[1])) as string[], version: state.version + 1,
            started_at: state.started_at ?? new Date() };
        return { rowCount: 1, rows: [{ ...state }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const client = { query };
    const access = { withAnyPermission: vi.fn(async (
      _actor: RequestActor, _workspaceId: string, _permissions: string[],
      work: (databaseClient: typeof client, resolvedActor: RequestActor & { userId: string }) => Promise<unknown>,
    ) => work(client, { ...actor, userId: "owner-id" })) };
    const service = new WorkspacesService({} as never, {} as never, access as never, {} as never, {} as never);

    const first = await service.updateOnboarding(actor, workspaceId, {
      version: 1, currentStep: WorkspaceOnboardingStep.Organization,
      completedSteps: [WorkspaceOnboardingStep.WorkspaceProfile],
    });
    expect(first).toMatchObject({ status: "in_progress", currentStep: "organization", version: 2,
      completedSteps: ["workspace_profile"] });
    expect(await service.getOnboarding(actor, workspaceId)).toMatchObject({ version: 2, completedSteps: ["workspace_profile"] });
    await expect(service.updateOnboarding(actor, workspaceId, {
      version: 1, currentStep: WorkspaceOnboardingStep.Team,
      completedSteps: [WorkspaceOnboardingStep.WorkspaceProfile, WorkspaceOnboardingStep.Organization],
    })).rejects.toThrow("Onboarding changed");
    await expect(service.updateOnboarding(actor, workspaceId, {
      version: 2, currentStep: WorkspaceOnboardingStep.Organization, completedSteps: [],
    })).rejects.toThrow("cannot be removed");
    await service.updateOnboarding(actor, workspaceId, {
      version: 2, currentStep: WorkspaceOnboardingStep.Team,
      completedSteps: [WorkspaceOnboardingStep.WorkspaceProfile, WorkspaceOnboardingStep.Organization],
    });
    const complete = await service.completeOnboarding(actor, workspaceId, { version: 3 });
    expect(complete).toMatchObject({ status: "completed", currentStep: null, version: 4,
      completedSteps: ["workspace_profile", "organization"] });
  });
});
