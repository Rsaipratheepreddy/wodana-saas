import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { isFrequency } from "./client-calls.domain";
import { clientCallsView, setClientCallFrequency } from "./client-calls.store";

/** PLM-046: a job's recurring client update call, read and changed on the case. */
@Injectable()
export class ClientCallsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  get(actor: RequestActor, workspaceId: string, caseId: string) {
    return this.access.withPermission(actor, workspaceId, "pre_projects.view", async (client) => {
      await this.exists(client, workspaceId, caseId);
      return clientCallsView(client, workspaceId, caseId);
    });
  }

  /** Weekly, every two weeks, monthly, or off (the client declined). Version-checked; audited. */
  set(actor: RequestActor, workspaceId: string, caseId: string, input: { frequency?: unknown; version?: unknown }) {
    if (!isFrequency(input.frequency)) throw new UnprocessableEntityException("Choose how often");
    const frequency = input.frequency;
    const version = Number(input.version ?? 0);
    return this.access.withPermissions(actor, workspaceId, ["pre_projects.view", "pre_projects.edit"], async (client, user) => {
      await this.exists(client, workspaceId, caseId);
      await client.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, caseId]);
      const result = await setClientCallFrequency(client, workspaceId, caseId, frequency, version, user.userId);
      if (result.conflict) throw new ConflictException("Someone changed the client calls. Reload and try again.");
      return clientCallsView(client, workspaceId, caseId);
    });
  }

  private async exists(client: { query: (text: string, values: unknown[]) => Promise<{ rowCount: number | null }> }, workspaceId: string, caseId: string) {
    if (!(await client.query(`SELECT 1 FROM pre_project_cases WHERE workspace_id = $1 AND id = $2`, [workspaceId, caseId])).rowCount) throw new NotFoundException("Case not found");
  }
}
