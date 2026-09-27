import { ConfigService } from "@nestjs/config";
import { isDeepStrictEqual } from "node:util";
import { CreateBusinessUnitDto } from "../../workspaces/dto/create-business-unit.dto";
import { CreateRoleDto } from "../../workspaces/dto/create-role.dto";
import { CreateTeamDto } from "../../workspaces/dto/create-team.dto";
import { InviteMemberDto } from "../../workspaces/dto/invite-member.dto";
import { ProvisionTenantDto } from "../../workspaces/dto/provision-tenant.dto";
import { TenantSetupSelectionsDto, TenantContractContactDto } from "../../workspaces/dto/tenant-provisioning-draft.dto";
import { UpdateRoleDto } from "../../workspaces/dto/update-role.dto";
import { UpdateTeamDto } from "../../workspaces/dto/update-team.dto";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { actorOf, describe, Pending, type Actor, type Core } from "./core";
import type { SeedData } from "./data";

export type Tenant = { workspaceId: string; slug: string; externalTenantId: string };

/** The activation link the invitation email carries: the web origin, the tenant's login slug and the one-time token. */
function activationLink(core: Core, slug: string, token: string) {
  const origin = core.get(ConfigService).get<string>("WEB_ORIGIN", "http://localhost:3000").split(",")[0].trim();
  const url = new URL("/login", origin);
  url.searchParams.set("tenant", slug);
  url.searchParams.set("invitation", token);
  return url.toString();
}

/**
 * The tenant itself, through the same provisioning the operator console uses (region pack, firm kit, plan,
 * default pipeline, role templates, workflow): once, keyed on the tenant's external id. Its owner is invited,
 * never given a password here; the activation link is printed on the run that creates it (or rotated on request).
 */
export async function ensureTenant(core: Core, data: SeedData, slug: string, rotateLinks: boolean): Promise<Tenant | null> {
  const workspaces = core.get(WorkspacesService);
  const fixture = data.showcase.tenant;
  // The login address is what the host resolves to (plm.wodana.ai → "plm"); it is readable before any tenant context.
  const existing = (await core.db.query<{ id: string; slug: string }>(`SELECT workspace_id AS id, login_slug AS slug FROM tenant_login_branding WHERE login_slug = $1`, [slug])).rows[0];
  if (existing) {
    core.report.record("tenant", "reused");
    const owner = await core.actor(existing.id, data.showcase.owner.email);
    if (owner && !owner.active) await ownerLink(core, data, existing.slug, rotateLinks);
    return { workspaceId: existing.id, slug: existing.slug, externalTenantId: fixture.externalTenantId };
  }
  if (!core.commit) {
    core.report.record("tenant", "pending", `workspace "${slug}" would be provisioned (${fixture.firmKit.code}, region ${fixture.region.code})`);
    return null;
  }
  const region = (await core.db.query<{ configuration: Record<string, unknown> }>(
    `SELECT configuration FROM tenant_setup_profiles WHERE kind = 'region' AND code = $1 AND version = $2 AND selectable`,
    [fixture.region.code, fixture.region.version])).rows[0]?.configuration;
  if (!region) throw new Error(`Region pack ${fixture.region.code} v${fixture.region.version} is not published in this database.`);
  const input = await core.validated(ProvisionTenantDto, {
    externalTenantId: fixture.externalTenantId, name: fixture.name, slug,
    defaultCurrency: region.currency, defaultLocale: region.locale, defaultTimezone: region.timezone, unitSystem: region.unitSystem, weekStartsOn: region.weekStartsOn,
    firstLegalEntity: fixture.legalEntity, owner: data.showcase.owner,
  });
  const account = await core.validated(TenantContractContactDto, { ...fixture.account, contactEmail: data.showcase.owner.email });
  const defaults = await core.validated(TenantSetupSelectionsDto, { region: fixture.region, firmKit: fixture.firmKit, plan: fixture.plan, seatLimit: fixture.seatLimit });
  const provisioned = await workspaces.provisionTenant({ ...input, account, defaults }, `seed:palm-showcase:tenant:${slug}`) as unknown as { workspace: { id: string }; ownerInvitation: { invitationToken?: string | null } };
  core.report.record("tenant", "created");
  const token = provisioned.ownerInvitation.invitationToken;
  if (token) core.report.link({ role: "owner", name: data.showcase.owner.displayName, email: data.showcase.owner.email, link: activationLink(core, slug, token) });
  return { workspaceId: provisioned.workspace.id, slug, externalTenantId: fixture.externalTenantId };
}

/** The owner's pending invitation: its link is printed again only when asked to rotate it (the old one stops working). */
async function ownerLink(core: Core, data: SeedData, slug: string, rotate: boolean) {
  if (!rotate || !core.commit) {
    core.report.notes.push(`Owner ${data.showcase.owner.email} has not accepted their invitation yet (link printed when it was created; --rotate-links prints a new one).`);
    return;
  }
  const renewed = await core.get(WorkspacesService).resendProvisionedOwnerInvitation(data.showcase.tenant.externalTenantId, undefined, undefined,
    `seed:owner-link:${Date.now()}`) as { invitationToken?: string | null };
  if (renewed.invitationToken)
    core.report.link({ role: "owner", name: data.showcase.owner.displayName, email: data.showcase.owner.email, link: activationLink(core, slug, renewed.invitationToken) });
}

/**
 * Business units, one role per team (its permissions from the tracker's Roles & Access tab), the teams, and the
 * role-wise people as invitations only: no password is set here; each invitation's link is printed once.
 */
export async function ensureTeamsAndPeople(core: Core, data: SeedData, tenant: Tenant, owner: Actor, rotateLinks: boolean) {
  const workspaces = core.get(WorkspacesService);
  const actor = actorOf(owner);
  const workspaceId = tenant.workspaceId;
  const detail = await workspaces.get(actor, workspaceId) as unknown as { legalEntities: Array<{ id: string }>; businessUnits: Array<{ id: string; code: string; status: string }> };
  const legalEntityId = detail.legalEntities[0]?.id;
  if (!legalEntityId) throw new Error("The workspace has no legal entity.");

  const unitByTeam = new Map<string, string>();
  for (const unit of data.showcase.businessUnits) {
    const made = await core.step("business unit", `business unit ${unit.code}`,
      async () => detail.businessUnits.find((row) => row.code === unit.code && row.status === "active") ?? null,
      async () => workspaces.createBusinessUnit(actor, workspaceId, await core.validated(CreateBusinessUnitDto,
        { legalEntityId, code: unit.code, name: unit.name, type: unit.type, timezone: data.showcase.tenant.legalEntity.timezone })) as Promise<{ id: string }>).catch(swallowPending);
    if (made) for (const team of unit.teams) unitByTeam.set(team, made.id);
  }

  const roles = await workspaces.listRoles(actor, workspaceId) as Array<{ id: string; code: string; name: string; description: string; isSystem: boolean; version: number; permissions: string[] }>;
  const everyPermission = roles.find((role) => role.code === "administrator")?.permissions ?? [];
  const roleByTeam = new Map<string, string>();
  for (const team of data.teams.teams) {
    const code = `team_${team.code.toLowerCase()}`;
    const permissionCodes = [...new Set(team.permissions.includes("*") ? everyPermission : team.permissions.filter((permission) => everyPermission.includes(permission)))].sort();
    const description = `${team.name} team (Palm tracker, Roles & Access; scope: ${team.scope}).`.slice(0, 500);
    const existing = roles.find((role) => role.code === code);
    const role = existing
      ? ((await core.ensure("role", `role ${code}`,
        async () => existing.name === team.name && isDeepStrictEqual([...existing.permissions].sort(), permissionCodes),
        async () => workspaces.updateRole(actor, workspaceId, existing.id, await core.validated(UpdateRoleDto, { version: existing.version, name: team.name, description, permissionCodes })))), existing)
      : await core.step("role", `role ${code}`, async () => null,
        async () => workspaces.createRole(actor, workspaceId, await core.validated(CreateRoleDto, { code, name: team.name, description, permissionCodes })) as Promise<{ id: string }>).catch(swallowPending);
    if (role) roleByTeam.set(team.code, role.id);
  }

  const teams = await workspaces.listTeams(actor, workspaceId) as Array<{ id: string; code: string; version: number; roleIds: string[]; businessUnitId: string; members: Array<{ membershipId: string; isLead: boolean }> }>;
  const teamByCode = new Map<string, { id: string; version: number; members: string[]; roleIds: string[] }>();
  for (const team of data.teams.teams) {
    const businessUnitId = unitByTeam.get(team.code);
    const roleId = roleByTeam.get(team.code);
    const found = teams.find((row) => row.code === team.code);
    const made = found ?? await core.step("team", `team ${team.code}`, async () => null, async () => {
      if (!businessUnitId || !roleId) throw new Pending("its business unit or role is not created yet");
      return workspaces.createTeam(actor, workspaceId, await core.validated(CreateTeamDto,
        { businessUnitId, code: team.code, name: team.name, description: `Access is granted per team: everyone in ${team.name} inherits its role.`.slice(0, 500), roleIds: [roleId], memberIds: [] })) as Promise<{ id: string; version: number; roleIds: string[]; members: Array<{ membershipId: string }> }>;
    }).catch(swallowPending);
    if (made) teamByCode.set(team.code, { id: made.id, version: made.version, members: made.members.map((member) => member.membershipId), roleIds: made.roleIds });
  }

  // People: an invitation each, with the kit role(s) and their team; existing members and pending invitations are reused.
  const members = await workspaces.listMembers(actor, workspaceId) as Array<{ id: string; email: string; version: number; teams: Array<{ id: string }> }>;
  const invitations = await workspaces.listInvitations(actor, workspaceId) as Array<{ id: string; email: string; status: string }>;
  const membershipByEmail = new Map(members.map((member) => [member.email.toLowerCase(), member]));
  for (const person of data.showcase.people) {
    const email = person.email.toLowerCase();
    const team = teamByCode.get(person.team);
    const member = membershipByEmail.get(email);
    if (member) {
      core.report.record("person", "reused");
      if (team && !team.members.includes(member.id)) {
        await core.ensure("team member", `${person.displayName} in ${person.team}`, async () => false, async () => {
          const updated = await workspaces.updateTeam(actor, workspaceId, team.id, await core.validated(UpdateTeamDto, { version: team.version, memberIds: [...team.members, member.id] })) as { version: number };
          team.version = updated.version; team.members.push(member.id);
        });
      }
      continue;
    }
    const pending = invitations.find((row) => row.email.toLowerCase() === email && row.status === "pending");
    if (pending) {
      core.report.record("person", "reused");
      if (rotateLinks && core.commit) {
        const renewed = await workspaces.resendInvitation(actor, workspaceId, pending.id) as unknown as { invitationToken: string };
        core.report.link({ role: person.team, name: person.displayName, email: person.email, link: activationLink(core, tenant.slug, renewed.invitationToken) });
      } else core.report.notes.push(`${person.email} has not accepted their invitation yet (--rotate-links prints a new link).`);
      continue;
    }
    await core.step("person", `invitation for ${person.email}`, async () => null, async () => {
      if (!team) throw new Pending("their team is not created yet");
      // Kit roles that this workspace doesn't have are left out: the team's role carries the access.
      const known = new Set(roles.map((role) => role.code));
      const roleCodes = person.roleCodes.filter((code) => known.has(code));
      for (const code of person.roleCodes.filter((code) => !known.has(code))) core.report.notes.push(`${person.email}: role "${code}" does not exist in this workspace; their team role applies.`);
      const created = await workspaces.inviteMember(actor, workspaceId, await core.validated(InviteMemberDto,
        { email: person.email, displayName: person.displayName, roleCodes, teamIds: [team.id] }))
        .catch((error: unknown) => { if (/seat limit/i.test(describe(error))) throw new Pending("the workspace's seat limit is reached; raise the seats in Wodana Control"); throw error; }) as unknown as { invitationToken: string; emailDelivery: { status: string } };
      core.report.link({ role: person.team, name: person.displayName, email: person.email, link: activationLink(core, tenant.slug, created.invitationToken) });
      if (created.emailDelivery.status === "sent") core.report.notices.push(`workspace invitation email was sent to ${person.email}`);
      return created;
    }).catch(swallowPending);
  }
}

function swallowPending(error: unknown) {
  if (error instanceof Pending) return null;
  throw error;
}
