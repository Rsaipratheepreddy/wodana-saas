import { HttpException } from "@nestjs/common";
import { UpdateMemberDto } from "../workspaces/dto/update-member.dto";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { MembersArgs } from "./ops-args";
import type { OpsContext, Report } from "./ops-context";

type Member = { id: string; status: string; version: number; userId: string; email: string; displayName: string; roles: string[] };

/**
 * `members --deactivate`: members switched off (suspended, as People does it) through the member command, as the
 * member the CLI acts as: they can no longer sign in to the workspace, and everything they did stays. Never the acting
 * member, never the last active owner. A member already inactive is unchanged.
 */
export async function runMembers(ctx: OpsContext, args: MembersArgs, report: Report) {
  const workspaces = ctx.get(WorkspacesService);
  const members = await workspaces.listMembers(ctx.actor, ctx.workspace.id) as unknown as Member[];
  const byEmail = new Map(members.map((member) => [member.email.toLowerCase(), member]));
  const isOwner = (member: Member) => member.status === "active" && member.roles.includes("owner");
  const leaving = new Set(args.deactivate.map((email) => byEmail.get(email)).filter((member): member is Member => Boolean(member && member.userId !== ctx.userId)));
  let ownersLeft = members.filter((member) => isOwner(member) && !leaving.has(member)).length;
  for (const email of args.deactivate) {
    const member = byEmail.get(email);
    if (!member) { report.add("members", "not found", email, "not a member of this workspace"); continue; }
    if (member.userId === ctx.userId) { report.add("members", "failed", email, "the member the CLI acts as is never deactivated"); continue; }
    if (member.status === "suspended") { report.add("members", "unchanged", email, `${member.displayName}: inactive`); continue; }
    if (isOwner(member) && ownersLeft === 0) {
      // Kept active: the workspace keeps an active owner.
      ownersLeft += 1;
      report.add("members", "failed", email, "the last active owner is never deactivated");
      continue;
    }
    const detail = `${member.displayName}: ${member.status} → inactive`;
    if (!ctx.apply) { report.add("members", "would change", email, detail); continue; }
    try {
      await workspaces.updateMember(ctx.actor, ctx.workspace.id, member.id, await ctx.validated(UpdateMemberDto, { version: member.version, status: "suspended" }));
      report.add("members", "changed", email, detail);
    } catch (error) {
      const message = error instanceof HttpException ? `${error.getStatus()} ${error.message}` : (error as Error).message;
      report.add("members", "failed", email, message.slice(0, 300));
    }
  }
}
