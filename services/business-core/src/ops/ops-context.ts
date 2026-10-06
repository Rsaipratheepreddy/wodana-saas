import { ValidationPipe, type INestApplicationContext, type Type } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { DatabaseService } from "../database/database.service";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";

export class OpsError extends Error {}

/** Who the CLI acts as, in which workspace, and the app's services. */
export type OpsContext = {
  workspace: { id: string; slug: string; name: string };
  userId: string;
  actor: RequestActor;
  apply: boolean;
  get<T>(type: Type<T>): T;
  /** A read in the workspace's own tenant transaction, as the member (membership checked). */
  read<T>(work: (client: PoolClient) => Promise<T>): Promise<T>;
  /** A body through the API's validation pipe for its DTO, exactly as the controller would. */
  validated<T>(dto: Type<T>, body: unknown): Promise<T>;
};

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

/**
 * The member the CLI acts as: an active user who is an active member of the workspace. The workspace is found
 * through the member (a workspace is visible to its own members only), so a non-member learns nothing about it.
 */
export async function openContext(app: INestApplicationContext, slug: string, email: string, apply: boolean): Promise<OpsContext> {
  const database = app.get(DatabaseService, { strict: false });
  const refused = new OpsError(`${email} is not an active member of a workspace "${slug}". The CLI acts only as an active member.`);
  const user = (await database.query<{ id: string; email: string; displayName: string }>(
    `SELECT id, primary_email::text AS email, display_name AS "displayName" FROM users WHERE lower(primary_email::text) = lower($1) AND status = 'active'`, [email])).rows[0];
  if (!user) throw refused;
  const workspace = (await database.actorTransaction(user.id, (client) => client.query<{ id: string; slug: string; name: string }>(
    `SELECT workspace.id, workspace.slug, workspace.name FROM workspaces workspace
      WHERE workspace.slug = $1 AND workspace.status IN ('active', 'suspended')
        AND EXISTS (SELECT 1 FROM workspace_memberships membership WHERE membership.workspace_id = workspace.id AND membership.user_id = $2 AND membership.status = 'active')`,
    [slug, user.id]))).rows[0];
  if (!workspace) throw refused;
  const actor: RequestActor = { subject: `operator-cli:${user.id}`, email: user.email, displayName: user.displayName, provider: "operator_cli", operator: { userId: user.id } };
  const access = app.get(WorkspaceAccessService, { strict: false });
  return {
    workspace, userId: user.id, actor, apply,
    get: (type) => app.get(type, { strict: false }),
    read: (work) => access.asMember(actor, workspace.id, (client) => work(client)),
    validated: (dto, body) => pipe.transform(body, { type: "body", metatype: dto }),
  };
}

export type Status = "unchanged" | "changed" | "would change" | "manual" | "not found" | "failed" | "info";
export type ReportLine = { section: string; status: Status; label: string; detail?: string };

/** What a run did, as counts and short messages (never record contents). */
export class Report {
  readonly lines: ReportLine[] = [];
  readonly facts: Record<string, unknown> = {};
  constructor(private readonly out: (line: string) => void, private readonly json: boolean) {}

  add(section: string, status: Status, label: string, detail?: string) {
    const line: ReportLine = { section, status, label, ...(detail ? { detail } : {}) };
    this.lines.push(line);
    if (!this.json) this.out(`  [${section}] ${status.padEnd(12)} ${label}${detail ? `: ${detail}` : ""}`);
  }

  note(text: string) { if (!this.json) this.out(text); }

  get failed() { return this.lines.some((line) => line.status === "failed"); }

  finish(header: Record<string, unknown>) {
    const counts = this.lines.reduce<Record<string, number>>((total, line) => ({ ...total, [line.status]: (total[line.status] ?? 0) + 1 }), {});
    if (this.json) this.out(JSON.stringify({ ...header, ...this.facts, counts, lines: this.lines }, null, 2));
    else this.out(`\n${Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(", ") || "nothing to do"}.`);
    return counts;
  }
}
