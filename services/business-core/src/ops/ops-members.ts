import { HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFile } from "node:fs/promises";
import { InviteMemberDto } from "../workspaces/dto/invite-member.dto";
import { UpdateMemberDto } from "../workspaces/dto/update-member.dto";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { MembersArgs } from "./ops-args";
import { OpsError, type OpsContext, type Report } from "./ops-context";

type Member = { id: string; status: string; version: number; userId: string; email: string; displayName: string; roles: string[] };

/**
 * `members --deactivate`: members switched off (suspended, as People does it) through the member command, as the
 * member the CLI acts as: they can no longer sign in to the workspace, and everything they did stays. Never the acting
 * member, never the last active owner. A member already inactive is unchanged.
 */
export async function runMembers(ctx: OpsContext, args: MembersArgs, report: Report) {
  if (args.invite) await invitePeople(ctx, args.invite, report);
  if (!args.deactivate.length) return;
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

type Invitee = { email: string; name: string | null; roles: string[]; teams: string[] };

/** The people file: a JSON list of { email, name?, roles?: [role codes], teams?: [team codes] }. */
export function parseInvitees(text: string): Invitee[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new OpsError("The people file is not valid JSON."); }
  if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw new OpsError("The people file is a list of 1 to 100 people.");
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const email = typeof item.email === "string" ? item.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) throw new OpsError(`Person ${index + 1}: "email" is not an email address.`);
    if (seen.has(email)) throw new OpsError(`${email} is listed twice.`);
    seen.add(email);
    const codes = (key: "roles" | "teams") => {
      const value = item[key] ?? [];
      if (!Array.isArray(value) || value.some((code) => typeof code !== "string" || !code.trim())) throw new OpsError(`${email}: "${key}" is a list of codes.`);
      return [...new Set((value as string[]).map((code) => code.trim()))];
    };
    const roles = codes("roles"), teams = codes("teams");
    if (!roles.length && !teams.length) throw new OpsError(`${email}: give at least one role or team.`);
    const name = typeof item.name === "string" && item.name.trim().length >= 2 ? item.name.trim() : null;
    return { email, name, roles, teams };
  });
}

/**
 * `members --invite`: each person invited through People's own invite (its permission check, audit and invitation
 * email), with their roles and teams. The sign-in link of each new invitation is printed once: the app keeps only its
 * hash. Anyone already a member, or with a pending invitation, is unchanged. Unknown codes stop the run before any send.
 */
async function invitePeople(ctx: OpsContext, path: string, report: Report) {
  let text: string;
  try { text = await readFile(path, "utf8"); } catch { throw new OpsError(`No people file at ${path}.`); }
  const people = parseInvitees(text);
  const workspaces = ctx.get(WorkspacesService);
  const known = await ctx.read(async (client) => ({
    roles: new Set((await client.query<{ code: string }>(`SELECT code FROM roles WHERE workspace_id = $1 OR workspace_id IS NULL`, [ctx.workspace.id])).rows.map((row) => row.code)),
    teams: new Map((await client.query<{ id: string; code: string }>(`SELECT id, code FROM workspace_teams WHERE workspace_id = $1 AND status = 'active'`, [ctx.workspace.id])).rows.map((row) => [row.code.toLowerCase(), row.id])),
    slug: (await client.query<{ slug: string }>(`SELECT login_slug AS slug FROM tenant_login_branding WHERE workspace_id = $1`, [ctx.workspace.id])).rows[0]?.slug ?? null,
  }));
  const unknown = people.flatMap((person) => [
    ...person.roles.filter((code) => !known.roles.has(code)).map((code) => `${person.email}: no role ${code}`),
    ...person.teams.filter((code) => !known.teams.has(code.toLowerCase())).map((code) => `${person.email}: no active team ${code}`),
  ]);
  if (unknown.length) throw new OpsError(`Nothing was sent. ${unknown.join("; ")}.`);

  const members = new Set((await workspaces.listMembers(ctx.actor, ctx.workspace.id) as unknown as Member[]).map((member) => member.email.toLowerCase()));
  const pending = new Set((await workspaces.listInvitations(ctx.actor, ctx.workspace.id) as unknown as Array<{ email: string; status: string }>)
    .filter((invitation) => invitation.status === "pending").map((invitation) => invitation.email.toLowerCase()));
  const origin = ctx.get(ConfigService).get<string>("WEB_ORIGIN", "http://localhost:3000").split(",")[0].trim();
  for (const person of people) {
    const access = [...person.roles, ...person.teams.map((code) => `team ${code}`)].join(", ");
    if (members.has(person.email)) { report.add("members", "unchanged", person.email, `already a member (${access} not changed)`); continue; }
    if (pending.has(person.email)) { report.add("members", "unchanged", person.email, "invitation pending: cancel it in People to send a new link"); continue; }
    const detail = `${person.name ?? person.email}: invited as ${access}`;
    if (!ctx.apply) { report.add("members", "would change", person.email, detail); continue; }
    try {
      const body = await ctx.validated(InviteMemberDto, { email: person.email, ...(person.name ? { displayName: person.name } : {}),
        roleCodes: person.roles, teamIds: person.teams.map((code) => known.teams.get(code.toLowerCase())!) });
      const created = await workspaces.inviteMember(ctx.actor, ctx.workspace.id, body) as { invitationToken: string; emailDelivery?: { status?: string } };
      const link = new URL("/login", origin);
      if (known.slug) link.searchParams.set("tenant", known.slug);
      link.searchParams.set("invitation", created.invitationToken);
      report.add("members", "changed", person.email, `${detail}; email ${created.emailDelivery?.status ?? "sent"}; link ${link.toString()}`);
    } catch (error) {
      const message = error instanceof HttpException ? `${error.getStatus()} ${error.message}` : (error as Error).message;
      report.add("members", "failed", person.email, message.slice(0, 300));
    }
  }
}
