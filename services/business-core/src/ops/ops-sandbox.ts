import { readFile } from "node:fs/promises";
import { HttpException, ValidationPipe, type INestApplicationContext, type Type } from "@nestjs/common";
import type { RequestActor } from "../auth/actor";
import { ActivateInvitationDto } from "../auth/dto/local-auth.dto";
import { LocalAuthService } from "../auth/local-auth.service";
import { ClientPortalAdminService } from "../client-portal/client-portal-admin.service";
import { CreateTaxonomyDto, UpdateTaxonomyDto } from "../crm/settings/dto/settings.dto";
import { CrmSettingsService } from "../crm/settings/crm-settings.service";
import { DatabaseService } from "../database/database.service";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { SuppliersService } from "../purchasing/suppliers.service";
import { stableId } from "../seed/palm-showcase/ids";
import { CustomerAccountsService } from "../workspaces/customer-accounts.service";
import { CreateBusinessUnitDto } from "../workspaces/dto/create-business-unit.dto";
import { CreateRoleDto } from "../workspaces/dto/create-role.dto";
import { CreateTeamDto } from "../workspaces/dto/create-team.dto";
import { InviteMemberDto } from "../workspaces/dto/invite-member.dto";
import { ApproveOrganizationRequestDto, CreateOrganizationRequestDto } from "../workspaces/dto/organization-request.dto";
import { ProvisionTenantDto } from "../workspaces/dto/provision-tenant.dto";
import { SaveTaxSettingsDto } from "../workspaces/dto/tax-numbering.dto";
import { UpdateAccountSecurityPolicyDto } from "../workspaces/dto/tenant-operations.dto";
import { TenantContractContactDto, TenantSetupSelectionsDto } from "../workspaces/dto/tenant-provisioning-draft.dto";
import { CompleteOnboardingDto, UpdateOnboardingDto, WorkspaceOnboardingStep } from "../workspaces/dto/update-onboarding.dto";
import { UpdateMemberDto } from "../workspaces/dto/update-member.dto";
import { UpdateRoleDto } from "../workspaces/dto/update-role.dto";
import { UpdateTeamDto } from "../workspaces/dto/update-team.dto";
import { UpdateWorkspaceDto } from "../workspaces/dto/update-workspace.dto";
import { parseRoleTemplateCodes } from "../workspaces/role-templates";
import { TaxNumberingService } from "../workspaces/tax-numbering.service";
import { TenantOperationsService } from "../workspaces/tenant-operations.service";
import { SYSTEM_ROLE_CODES, WorkspacesService } from "../workspaces/workspaces.service";
import type { SandboxArgs } from "./ops-args";
import { runConfigure } from "./ops-configure";
import { openContext, OpsError, type Report } from "./ops-context";
import { ProfileError, validateProfile, type Profile } from "./ops-profile";
import {
  parseCrmFile, parseTeamsFile, planMembers, SANDBOX_DEFAULT_KIT, SANDBOX_PERSONAS, SANDBOX_PLAN, SANDBOX_SUPPLIERS, sandboxEmail, sandboxExternalTenantId, SandboxFileError,
  sandboxLegalEntityCode, sandboxOrganizationKey, sandboxProfile, sandboxSeatLimit, scrubForSandbox, type MemberPlan, type TaxonomySpec, type TeamSpec,
} from "./ops-sandbox-plan";

/**
 * `sandbox`: a test workspace on the server, for end-to-end testing with one member per role. The workspace is made
 * by the provisioning Wodana Control uses (WorkspacesService.provisionTenant with a region pack, a firm kit and a plan),
 * its people by invitation and acceptance, and everything else by the app's own commands as its test owner, so the
 * same validation, tenant isolation, version checks and audit apply. Only a workspace this command made (its external
 * tenant id is sandbox-<slug>) is ever touched; any other organization's slug is refused. No email leaves while it
 * runs. Dry run unless --apply; a second run changes nothing.
 *
 * With --organization-of <sandbox>, the workspace is another organization in that sandbox's customer account: its test
 * owner requests it and it is approved as Wodana approves an account's additional organization (CustomerAccountsService),
 * with the region pack given and the sandbox's own firm kit and plan. The sandbox's test members join it with the same
 * roles and teams, so one sign-in reaches both through the organization switcher. Refused unless the sandbox and every
 * organization in its account were made by this command.
 */

type SetupProfile = { code: string; version: number; configuration: Record<string, unknown> };
type Setup = { region: SetupProfile; kit: SetupProfile; plan: SetupProfile };
type Pinned = { kit: { code: string; version: number }; plan: { code: string; version: number } };
type Person = { userId: string; email: string; displayName: string; actor: RequestActor };
type MemberRow = { id: string; status: string; version: number; userId: string; email: string; displayName: string; roles: string[]; teams: Array<{ id: string }> };
type RoleRow = { id: string; code: string; name: string; isSystem: boolean; version: number; permissions: string[] };
type TeamRow = { id: string; code: string; version: number; roleIds: string[]; members: Array<{ membershipId: string }> };
type Taxonomy = { id: string; code: string; name: string; status: string; version: number; options: Array<{ code: string; label: string; position: number; status: string }> };
type Outcome = { email: string; displayName: string; roles: string[]; teams: string[]; userId: string | null };
/** The sandbox an organization is added to: its first organization and its customer account. */
type Base = { slug: string; workspaceId: string; accountId: string; organizationLimit: number; pinned: Pinned | null };
type AccountOrganization = { workspaceId: string; loginSlug: string | null; madeHere: boolean };

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validated = <T>(dto: Type<T>, body: unknown): Promise<T> => pipe.transform(body, { type: "body", metatype: dto });
const describe = (error: unknown) => (error instanceof HttpException ? `${error.getStatus()} ${error.message}` : (error as Error).message).slice(0, 300);
const operatorActor = (person: { userId: string; email: string; displayName: string }): RequestActor => ({
  subject: `operator-cli:${person.userId}`, email: person.email, displayName: person.displayName, provider: "operator_cli", operator: { userId: person.userId },
});
const notOurs = (slug: string) => new OpsError(`${slug} belongs to an organization this command didn't make. A sandbox never changes another organization; choose another slug.`);

export async function runSandbox(app: INestApplicationContext, args: SandboxArgs, report: Report): Promise<void> {
  const get = <T>(type: Type<T>) => app.get(type, { strict: false });
  const db = get(DatabaseService);
  const password = await readPassword(args.passwordEnv);
  const profile = args.profile ? await readProfile(args.profile, report) : null;
  const teams = args.teams ? await readTeams(args.teams) : null;
  const leadOptions = args.crm ? await readCrm(args.crm, report) : null;
  // The sandbox whose people (and, with --organization-of, whose account) this run is for.
  const people = args.organizationOf ?? args.slug;
  const base = args.organizationOf ? await resolveBase(app, db, args.organizationOf) : null;
  const setup = await resolveSetup(db, args, base?.pinned ?? null);
  const externalTenantId = sandboxExternalTenantId(people);
  const ownerPersona = SANDBOX_PERSONAS[0];
  const ownerEmail = sandboxEmail(ownerPersona.key, people);
  const regionConfig = setup.region.configuration as { currency: string; locale: string; timezone: string; unitSystem: string; weekStartsOn: number; countryCode: string };
  const seatLimit = sandboxSeatLimit(Number((setup.plan.configuration as { seatLimit?: number }).seatLimit ?? 1));
  const provisioned = `${setup.region.code} region pack (${regionConfig.currency}, ${regionConfig.locale}, ${regionConfig.timezone}), firm kit ${setup.kit.code}, plan ${setup.plan.code}, ${seatLimit} seats`;
  report.facts.workspace = { slug: args.slug, name: args.name, externalTenantId: base ? null : externalTenantId, organizationOf: base?.slug ?? null,
    region: `${setup.region.code} v${setup.region.version}`, currency: regionConfig.currency, locale: regionConfig.locale, timezone: regionConfig.timezone,
    firmKit: `${setup.kit.code} v${setup.kit.version}`, plan: `${setup.plan.code} v${setup.plan.version}` };
  // Who the test members already are, so the run can say whom it made (with --organization-of: nobody).
  const knownPeople = await peopleByEmail(db, SANDBOX_PERSONAS.map((persona) => sandboxEmail(persona.key, people)));

  // Every email the run would send (invitations, notices, the showcase's) is held back and counted.
  const mailer = get(TransactionalEmailService) as unknown as { send: (message: unknown) => Promise<unknown> };
  const send = mailer.send;
  let held = 0;
  mailer.send = async () => { held += 1; return { status: "not_configured", provider: null, messageId: null, suppressedReason: "sandbox_setup" }; };
  try {
    let workspaceId: string;
    let ownerToken: string | null = null;
    if (base) {
      // ---------- the organization, in the sandbox's account ----------
      const made = await ensureOrganization(base);
      if (!made) { planRemainder(args, setup, { teams, leadOptions, profile }, report, password, knownPeople); return; }
      workspaceId = made;
    } else {
      // ---------- the workspace ----------
      const known = (await db.query<{ workspaceId: string }>(`SELECT workspace_id AS "workspaceId" FROM tenant_provisioning_requests WHERE external_tenant_id = $1`, [externalTenantId])).rows[0];
      const slugTaken = await slugIsTaken(db, args.slug);
      if (!known && slugTaken) throw notOurs(args.slug);
      if (!known && args.apply && !password) throw new OpsError("The test members need a password: put it in an environment variable and name it with --password-env.");
      if (!known && !args.apply) {
        report.add("workspace", "would change", args.slug, `provisioned: ${provisioned}`);
        report.add("members", "would change", ownerEmail, "owner: accepts the owner invitation");
        planRemainder(args, setup, { teams, leadOptions, profile }, report, password);
        return;
      }

      if (known) {
        workspaceId = known.workspaceId;
        const tenant = await get(WorkspacesService).getProvisionedTenant(externalTenantId) as unknown as
          { workspace: { name: string; slug: string; status: string; defaultCurrency: string }; ownerInvitation: { email: string } };
        // Made by this command: its id and its test owner both say so (an organization merely given such an id is refused).
        if (tenant.workspace.slug !== args.slug || tenant.ownerInvitation.email.toLowerCase() !== ownerEmail) throw notOurs(args.slug);
        if (tenant.workspace.status !== "active") throw new OpsError(`The sandbox ${args.slug} is ${tenant.workspace.status}; reactivate it in Wodana Control first.`);
        report.add("workspace", "unchanged", args.slug, `${tenant.workspace.name} · ${tenant.workspace.defaultCurrency}`);
        const pinned = (await db.tenantTransaction(workspaceId, workspaceId, (client) => client.query<{ region: string; kit: string }>(
          `SELECT region_code AS region, firm_kit_code AS kit FROM workspace_setup_versions WHERE workspace_id = $1`, [workspaceId]))).rows[0];
        if (pinned && (pinned.region !== setup.region.code || pinned.kit !== setup.kit.code))
          report.add("workspace", "info", "setup", `made with region ${pinned.region} and kit ${pinned.kit}; an existing sandbox keeps them`);
      } else {
        const input = await validated(ProvisionTenantDto, {
          externalTenantId, name: args.name, slug: args.slug, ...regionalDefaults(args, regionConfig), owner: { email: ownerEmail, displayName: ownerPersona.displayName },
        });
        const account = await validated(TenantContractContactDto, { displayName: args.name, contactName: ownerPersona.displayName, contactEmail: ownerEmail });
        const defaults = await validated(TenantSetupSelectionsDto, setupSelections(setup, seatLimit));
        const result = await get(WorkspacesService).provisionTenant({ ...input, account, defaults }, `sandbox:${args.slug}`) as unknown as
          { workspace: { id: string }; ownerInvitation: { invitationToken?: string | null } };
        workspaceId = result.workspace.id;
        ownerToken = result.ownerInvitation.invitationToken ?? null;
        report.add("workspace", "changed", args.slug, `provisioned: ${provisioned}`);
      }
    }
    (report.facts.workspace as Record<string, unknown>).id = workspaceId;

    // A member without a password can't sign in: refuse before changing anything when one would be left without.
    // An added organization's people are the sandbox's own: their passwords are its business, never this run's.
    const auth = get(LocalAuthService);
    if (!password && !base) {
      const without: string[] = [];
      for (const persona of SANDBOX_PERSONAS) {
        const person = knownPeople.get(sandboxEmail(persona.key, people));
        if (!person || !await auth.hasLocalPassword(workspaceId, person.userId)) without.push(persona.key);
      }
      if (without.length && args.apply) throw new OpsError(`${without.length} test members have no password yet (${without.join(", ")}): name the environment variable that holds it with --password-env.`);
      for (const key of without) report.add("members", "manual", sandboxEmail(key, people), "no password yet: --apply needs --password-env");
    }

    // ---------- the owner ----------
    const owner = await ensureOwner();
    if (!owner) { planRemainder(args, setup, { teams, leadOptions, profile }, report, password); return; }

    // ---------- name, sign-in security, onboarding, tax ----------
    await guarded(report, "workspace", "name", () => ensureName(owner.actor));
    await guarded(report, "security", "authenticator", async () => {
      // The policy is the account's, so it covers each of its organizations; it is changed only when the sandbox made them all.
      const operations = get(TenantOperationsService);
      const policy = await operations.securityPolicy(externalTenantId);
      const organizations = await accountOrganizations(db, policy.accountId, people);
      if (organizations.some((organization) => !organization.madeHere)) {
        report.add("security", "manual", "authenticator", "this account owns organizations this command didn't make; change it in Wodana Control");
        return;
      }
      const where = organizations.length > 1 ? ` in ${organizations.length} organizations` : "";
      const now = { admins: policy.securityPolicy.requireMfaForAdmins !== false, everyone: policy.securityPolicy.requireMfaForAllUsers === true };
      if (!now.admins && !now.everyone) { report.add("security", "unchanged", "authenticator", `not needed to sign in${where}`); return; }
      if (!args.apply) { report.add("security", "would change", "authenticator", `needed → not needed to sign in${where}`); return; }
      await operations.updateSecurityPolicy(externalTenantId, await validated(UpdateAccountSecurityPolicyDto, {
        expectedVersion: policy.version, requireMfaForAdmins: false, requireMfaForAllUsers: false, reason: "Sandbox: test members sign in without an authenticator.",
      }), null);
      report.add("security", "changed", "authenticator", `needed → not needed to sign in${where}`);
    });
    await guarded(report, "workspace", "onboarding", () => ensureOnboarding(owner.actor));
    await guarded(report, "workspace", "client portal", () => ensurePortal(owner.actor));
    await guarded(report, "tax", "tax profile", () => ensureTax(owner.actor));

    // ---------- teams and members ----------
    const roles = await get(WorkspacesService).listRoles(owner.actor, workspaceId) as unknown as RoleRow[];
    const teamIds = new Map<string, string>();
    const teamRoles = new Map<string, string>();
    if (teams) await guarded(report, "teams", "teams", () => ensureTeams(owner.actor, roles, teams, teamIds, teamRoles));
    if (leadOptions) await guarded(report, "crm", "lead options", () => ensureLeadOptions(owner.actor, leadOptions, teamRoles));
    const plans = planMembers(people, new Set(roles.map((role) => role.code)), teams ?? []);
    const outcomes: Outcome[] = [];
    for (const plan of plans) {
      const outcome: Outcome = { email: plan.email, displayName: plan.displayName, roles: plan.roleCodes, teams: plan.teamCodes, userId: null };
      outcomes.push(outcome);
      if (plan.email === ownerEmail) { outcome.userId = owner.userId; continue; }
      for (const role of plan.missingRoles) report.add("members", "info", plan.email, `the workspace has no role ${role}`);
      await guarded(report, "members", plan.email, async () => { outcome.userId = await ensureMember(plan, owner, teamIds); });
    }

    // ---------- the showcase, then the profile ----------
    // The showcase goes first, on the kit's own rules, so every stage of its story completes (a firm's stricter rules,
    // such as the QS pricing each quote, would stop it part-way); the profile then sets the firm's rules for testing.
    if (args.seed) await guarded(report, "seed", "showcase", () => seed(outcomes, owner));
    if (profile) {
      const ctx = await openContext(app, args.slug, ownerEmail, args.apply);
      await runConfigure(ctx, profile, report);
    }
    if (held) report.add("email", "info", "held back", `${held} emails were not sent`);
    printMembers(report, outcomes, args.passwordEnv, knownPeople, base?.slug ?? null);

    // ---------- steps ----------

    /**
     * The organization in the sandbox's account: found by the request this command made for its slug, else (with
     * --apply) requested by the sandbox's test owner and approved with the region pack and the sandbox's kit and plan.
     * Its workspace id; null on a dry run before it exists.
     */
    async function ensureOrganization(sandbox: Base): Promise<string | null> {
      const organizations = await accountOrganizations(db, sandbox.accountId, sandbox.slug);
      if (organizations.some((organization) => !organization.madeHere))
        throw new OpsError(`The account of sandbox ${sandbox.slug} has organizations this command didn't make. A sandbox never changes another organization.`);
      const key = sandboxOrganizationKey(args.slug);
      const requests = (await db.query<{ id: string; status: string; version: number; workspaceId: string | null; requestedBy: string }>(
        `SELECT request.id, request.status, request.version, request.approved_workspace_id AS "workspaceId", lower(person.primary_email::text) AS "requestedBy"
           FROM organization_requests request JOIN users person ON person.id = request.requested_by
          WHERE request.account_id = $1 AND request.idempotency_key = $2`, [sandbox.accountId, key])).rows;
      const request = requests.find((row) => row.requestedBy === ownerEmail);
      if (request?.status === "approved" && request.workspaceId) {
        const found = organizations.find((organization) => organization.workspaceId === request.workspaceId);
        if (!found) throw new OpsError(`The organization made for ${args.slug} is no longer in the account of sandbox ${sandbox.slug}.`);
        if (found.loginSlug !== args.slug) throw new OpsError(`The organization made for ${args.slug} signs in at ${found.loginSlug ?? "no login name"} now; a sandbox never changes its slug.`);
        const status = (await db.tenantTransaction(request.workspaceId, request.workspaceId, (client) => client.query<{ status: string; name: string; currency: string }>(
          `SELECT status, name, default_currency AS currency FROM workspaces WHERE id = $1`, [request.workspaceId]))).rows[0];
        if (status?.status !== "active") throw new OpsError(`The organization ${args.slug} is ${status?.status ?? "missing"}; reactivate it in Wodana Control first.`);
        report.add("organization", "unchanged", args.slug, `${status.name} · ${status.currency} · in the account of sandbox ${sandbox.slug}`);
        return request.workspaceId;
      }
      if (await slugIsTaken(db, args.slug)) throw notOurs(args.slug);
      const needsLimit = organizations.length >= sandbox.organizationLimit;
      const limit = needsLimit ? `; the account's organization limit ${sandbox.organizationLimit} → ${organizations.length + 1}` : "";
      const what = `requested by ${ownerEmail} and approved in the account of sandbox ${sandbox.slug}: ${provisioned}${limit}`;
      if (!args.apply) {
        report.add("organization", "would change", args.slug, what);
        report.add("members", "would change", ownerEmail, "owner: the organization's requester");
        return null;
      }
      const owner = knownPeople.get(ownerEmail);
      if (!owner || !await activeMembership(db, sandbox.workspaceId, owner.userId))
        throw new OpsError(`${ownerEmail} is not an active member of sandbox ${sandbox.slug}; run sandbox --slug ${sandbox.slug} first.`);
      const accounts = get(CustomerAccountsService);
      const asked = await accounts.requestOrganization(owner.actor, sandbox.workspaceId, await validated(CreateOrganizationRequestDto, {
        name: args.name, slug: args.slug, ...regionalDefaults(args, regionConfig), reason: `Sandbox: a ${setup.region.code} organization for testing.`,
      }), key) as { id: string; status: string; version: number };
      const approved = await accounts.approveRequest(asked.id, await validated(ApproveOrganizationRequestDto, {
        expectedVersion: asked.version, ...(needsLimit ? { organizationLimit: organizations.length + 1 } : {}),
        decisionReason: "Sandbox: approved by the operator CLI for testing.", defaults: setupSelections(setup, seatLimit),
      })) as { approvedWorkspaceId: string | null; organization?: { workspace: { id: string } } };
      const made = approved.organization?.workspace.id ?? approved.approvedWorkspaceId;
      if (!made) throw new OpsError(`The request for ${args.slug} was not approved.`);
      report.add("organization", "changed", args.slug, what);
      return made;
    }

    async function ensureOwner(): Promise<Person | null> {
      const workspaces = get(WorkspacesService);
      let person = (await peopleByEmail(db, [ownerEmail])).get(ownerEmail);
      const active = person ? await activeMembership(db, workspaceId, person.userId) : false;
      if (person && active) report.add("members", "unchanged", ownerEmail, "owner");
      else if (base) throw new OpsError(`${ownerEmail} is no longer an active member of ${args.slug}; make them active again in Members.`);
      else if (!args.apply) { report.add("members", "would change", ownerEmail, "owner: accepts the owner invitation"); return null; }
      else {
        // The token from provisioning, else a fresh one (an earlier run stopped before the owner accepted).
        const token = ownerToken ?? ((await workspaces.resendProvisionedOwnerInvitation(externalTenantId)) as { invitationToken?: string | null }).invitationToken;
        person ??= (await peopleByEmail(db, [ownerEmail])).get(ownerEmail);
        if (!token || !person) throw new OpsError("The owner's invitation could not be accepted; rotate it in Wodana Control and run again.");
        await workspaces.acceptInvitation(person.actor, token);
        report.add("members", "changed", ownerEmail, "owner: invitation accepted");
      }
      if (password) {
        const { changed } = await auth.setMemberPassword(workspaceId, person!.userId, password);
        report.add("members", changed ? "changed" : "unchanged", `${ownerEmail} password`, changed ? "set" : "as given");
      }
      return person!;
    }

    /** The organization's name as --name gives it, through the workspace identity command (the login page's name follows); the slug never changes. */
    async function ensureName(actor: RequestActor) {
      const workspaces = get(WorkspacesService);
      const current = (await workspaces.get(actor, workspaceId) as unknown as { workspace: { name: string; version: number } }).workspace;
      const login = (await db.query<{ name: string }>(`SELECT display_name AS name FROM tenant_login_branding WHERE workspace_id = $1`, [workspaceId])).rows[0]?.name ?? null;
      if (current.name === args.name && login === args.name) { report.add("workspace", "unchanged", "name", `"${args.name}"`); return; }
      const change = `"${current.name}" → "${args.name}"`;
      if (!args.apply) { report.add("workspace", "would change", "name", change); return; }
      await workspaces.updateWorkspace(actor, workspaceId, await validated(UpdateWorkspaceDto, { version: current.version, name: args.name }));
      report.add("workspace", "changed", "name", change);
    }

    async function ensureOnboarding(actor: RequestActor) {
      const workspaces = get(WorkspacesService);
      const current = await workspaces.getOnboarding(actor, workspaceId) as { status: string; version: number; completedSteps: string[] };
      if (current.status === "completed") { report.add("workspace", "unchanged", "onboarding", "complete"); return; }
      if (!args.apply) { report.add("workspace", "would change", "onboarding", `${current.status} → complete`); return; }
      const steps = Object.values(WorkspaceOnboardingStep);
      const updated = await workspaces.updateOnboarding(actor, workspaceId, await validated(UpdateOnboardingDto, {
        version: current.version, currentStep: steps[steps.length - 1], completedSteps: [...new Set([...current.completedSteps, ...steps])],
      })) as { version: number };
      await workspaces.completeOnboarding(actor, workspaceId, await validated(CompleteOnboardingDto, { version: updated.version }));
      report.add("workspace", "changed", "onboarding", `${current.status} → complete`);
    }

    /** The client portal on, so testers can invite the showcase's clients and go through the client's side. */
    async function ensurePortal(actor: RequestActor) {
      const portal = get(ClientPortalAdminService);
      const current = await portal.settings(actor, workspaceId) as { settings: { enabled: boolean; version: number } };
      if (current.settings.enabled) { report.add("workspace", "unchanged", "client portal", "on"); return; }
      if (!args.apply) { report.add("workspace", "would change", "client portal", "off → on"); return; }
      await portal.saveSettings(actor, workspaceId, { version: current.settings.version, enabled: true });
      report.add("workspace", "changed", "client portal", "off → on");
    }

    async function ensureTax(actor: RequestActor) {
      const detail = await get(WorkspacesService).get(actor, workspaceId) as unknown as { legalEntities: Array<{ id: string }> };
      const entityId = detail.legalEntities[0]?.id;
      if (!entityId) { report.add("tax", "manual", "tax profile", "the workspace has no company"); return; }
      const taxes = get(TaxNumberingService);
      const current = await taxes.get(actor, workspaceId, entityId) as { taxModel: { model: string; label: string | null }; tax: null | { rates: Array<{ label: string; rate: string }> } };
      if (current.tax) { report.add("tax", "unchanged", "tax profile", current.tax.rates.map((rate) => `${rate.label} ${Number(rate.rate)}%`).join(", ") || "no rates"); return; }
      if (current.taxModel.model === "none") { report.add("tax", "info", "tax profile", "the region has no sales tax"); return; }
      const rates = await regionRates(db, setup, current.taxModel);
      if (!rates.length) { report.add("tax", "manual", "tax profile", "the region pack gives no standard rate; set it in Settings → Tax"); return; }
      const shown = rates.map((rate) => `${rate.label} ${rate.rate}%`).join(", ");
      if (!args.apply) { report.add("tax", "would change", "tax profile", shown); return; }
      await taxes.saveTax(actor, workspaceId, entityId, await validated(SaveTaxSettingsDto, { pricesIncludeTax: false, rates }));
      report.add("tax", "changed", "tax profile", shown);
    }

    async function ensureTeams(actor: RequestActor, roles: RoleRow[], specs: TeamSpec[], teamIds: Map<string, string>, teamRoles: Map<string, string>) {
      const workspaces = get(WorkspacesService);
      const everyPermission = roles.find((role) => role.code === "administrator")?.permissions ?? [];
      const roleIds = new Map<string, string>();
      for (const team of specs) {
        const code = `team_${team.code.toLowerCase()}`;
        teamRoles.set(team.code, code);
        const wanted = team.permissions.includes("*") ? everyPermission : team.permissions.filter((permission) => everyPermission.includes(permission));
        const unknown = team.permissions.filter((permission) => permission !== "*" && !everyPermission.includes(permission));
        if (unknown.length) report.add("teams", "info", `team ${team.code}`, `${unknown.length} permissions this workspace doesn't have: ${unknown.join(", ")}`.slice(0, 300));
        // The team's own role, else a kit role of the same name (never a second role with that name); permissions are only added.
        const existing = roles.find((role) => role.code === code) ?? roles.find((role) => !role.isSystem && role.name.trim().toLowerCase() === team.name.trim().toLowerCase());
        if (existing) {
          roleIds.set(team.code, existing.id);
          teamRoles.set(team.code, existing.code);
          const missing = wanted.filter((permission) => !existing.permissions.includes(permission));
          if (!missing.length) { report.add("teams", "unchanged", `role ${existing.code}`); continue; }
          if (!args.apply) { report.add("teams", "would change", `role ${existing.code}`, `${missing.length} permissions added`); continue; }
          await workspaces.updateRole(actor, workspaceId, existing.id, await validated(UpdateRoleDto, { version: existing.version, permissionCodes: [...existing.permissions, ...missing].sort() }));
          report.add("teams", "changed", `role ${existing.code}`, `${missing.length} permissions added`);
          continue;
        }
        if (!args.apply) { report.add("teams", "would change", `role ${code}`, `created with ${wanted.length} permissions`); continue; }
        const created = await workspaces.createRole(actor, workspaceId, await validated(CreateRoleDto, {
          code, name: team.name, description: `${team.name} team: everyone in it has this role.`.slice(0, 500), permissionCodes: [...new Set(wanted)].sort(),
        })) as unknown as { id: string };
        roleIds.set(team.code, created.id);
        report.add("teams", "changed", `role ${code}`, `created with ${wanted.length} permissions`);
      }

      const detail = await workspaces.get(actor, workspaceId) as unknown as { legalEntities: Array<{ id: string }>; businessUnits: Array<{ id: string; status: string }> };
      let unitId = detail.businessUnits.find((unit) => unit.status === "active")?.id ?? null;
      if (unitId) report.add("teams", "unchanged", "business unit");
      else if (!args.apply) report.add("teams", "would change", "business unit", `${args.name} (MAIN)`);
      else {
        const unit = await workspaces.createBusinessUnit(actor, workspaceId, await validated(CreateBusinessUnitDto, {
          legalEntityId: detail.legalEntities[0].id, code: "MAIN", name: args.name, type: "department", timezone: regionConfig.timezone,
        })) as unknown as { id: string };
        unitId = unit.id;
        report.add("teams", "changed", "business unit", `${args.name} (MAIN)`);
      }

      const current = await workspaces.listTeams(actor, workspaceId) as unknown as TeamRow[];
      for (const team of specs) {
        const roleId = roleIds.get(team.code);
        const found = current.find((row) => row.code === team.code);
        if (found) {
          teamIds.set(team.code, found.id);
          if (!roleId || found.roleIds.includes(roleId)) { report.add("teams", "unchanged", `team ${team.code}`); continue; }
          if (!args.apply) { report.add("teams", "would change", `team ${team.code}`, `gets role team_${team.code.toLowerCase()}`); continue; }
          await workspaces.updateTeam(actor, workspaceId, found.id, await validated(UpdateTeamDto, { version: found.version, roleIds: [...found.roleIds, roleId] }));
          report.add("teams", "changed", `team ${team.code}`, "role added");
          continue;
        }
        if (!args.apply) { report.add("teams", "would change", `team ${team.code}`, `${team.name}: created`); continue; }
        const created = await workspaces.createTeam(actor, workspaceId, await validated(CreateTeamDto, {
          businessUnitId: unitId!, code: team.code, name: team.name, description: `Access is granted per team: everyone in ${team.name} has its role.`.slice(0, 500),
          roleIds: [roleId!], memberIds: [],
        })) as unknown as { id: string };
        teamIds.set(team.code, created.id);
        report.add("teams", "changed", `team ${team.code}`, `${team.name}: created`);
      }
    }

    /** The lead options (Settings → Lead options) as the CRM intake profile lists them; an option limited to teams is limited to their roles. */
    async function ensureLeadOptions(actor: RequestActor, taxonomies: TaxonomySpec[], teamRoles: Map<string, string>) {
      const settings = get(CrmSettingsService);
      const roleCodes = new Set((await get(WorkspacesService).listRoles(actor, workspaceId) as unknown as RoleRow[]).map((role) => role.code));
      const current = (await settings.list(actor, workspaceId) as { taxonomies: Taxonomy[] }).taxonomies;
      for (const taxonomy of taxonomies) {
        const existing = current.find((row) => row.code === taxonomy.code);
        // An option the workspace archived stays archived (e.g. by the profile's enquiryTypes.archive).
        const archived = new Set(existing?.options.filter((row) => row.status !== "active").map((row) => row.code) ?? []);
        const options = taxonomy.options.filter((option) => !archived.has(option.code)).map((option, position) => {
          if (!option.teams) return { code: option.code, label: option.label, position };
          const allowed = option.teams.map((team) => teamRoles.get(team) ?? `team_${team.toLowerCase()}`).filter((code) => roleCodes.has(code));
          if (!allowed.length) { report.add("crm", "info", `${taxonomy.code} › ${option.code}`, "open to everyone: none of its teams is in this workspace"); return { code: option.code, label: option.label, position }; }
          return { code: option.code, label: option.label, position, allowedRoles: [...new Set(["owner", "administrator", ...allowed])] };
        });
        const active = existing?.options.filter((row) => row.status === "active").sort((a, b) => a.position - b.position).map(({ code, label }) => ({ code, label })) ?? [];
        if (existing && existing.status === "active" && existing.name === taxonomy.name
          && JSON.stringify(active) === JSON.stringify(options.map(({ code, label }) => ({ code, label })))) {
          report.add("crm", "unchanged", taxonomy.code, `${options.length} options`);
          continue;
        }
        if (!args.apply) { report.add("crm", "would change", taxonomy.code, `${options.length} options`); continue; }
        if (existing) await settings.updateTaxonomy(actor, workspaceId, existing.id, await validated(UpdateTaxonomyDto, { version: existing.version, name: taxonomy.name, status: "active", options }));
        else await settings.createTaxonomy(actor, workspaceId, await validated(CreateTaxonomyDto, { code: taxonomy.code, name: taxonomy.name, options }));
        report.add("crm", "changed", taxonomy.code, `${options.length} options`);
      }
    }

    async function ensureMember(plan: MemberPlan, ownerPerson: Person, teamIds: Map<string, string>): Promise<string | null> {
      const workspaces = get(WorkspacesService);
      const label = [...plan.roleCodes, ...plan.teamCodes.map((code) => `team ${code}`)].join(", ");
      const wantedTeamIds = plan.teamCodes.flatMap((code) => (teamIds.has(code) ? [teamIds.get(code)!] : []));
      let member = (await workspaces.listMembers(ownerPerson.actor, workspaceId) as unknown as MemberRow[]).find((row) => row.email.toLowerCase() === plan.email);
      if (!member) {
        // An added organization's people are the sandbox's own test members: nobody new is made for it.
        if (base && !knownPeople.has(plan.email)) { report.add("members", "manual", plan.email, `not a member of sandbox ${base.slug} yet: run sandbox --slug ${base.slug} first`); return null; }
        if (!args.apply) { report.add("members", "would change", plan.email, `${plan.displayName}: ${base ? "joins" : "invited and active"} as ${label}`); return null; }
        const pending = (await workspaces.listInvitations(ownerPerson.actor, workspaceId) as unknown as Array<{ id: string; email: string; status: string }>)
          .find((row) => row.email.toLowerCase() === plan.email && ["pending", "expired"].includes(row.status));
        const token = pending
          ? (await workspaces.resendInvitation(ownerPerson.actor, workspaceId, pending.id) as unknown as { invitationToken: string }).invitationToken
          : (await workspaces.inviteMember(ownerPerson.actor, workspaceId, await validated(InviteMemberDto, {
            email: plan.email, displayName: plan.displayName, roleCodes: plan.roleCodes, teamIds: wantedTeamIds,
          })) as unknown as { invitationToken: string }).invitationToken;
        const person = (await peopleByEmail(db, [plan.email])).get(plan.email);
        if (!person) throw new OpsError(`${plan.email} was invited but has no account.`);
        await workspaces.acceptInvitation(person.actor, token);
        report.add("members", "changed", plan.email, `${plan.displayName}: active as ${label}`);
        member = (await workspaces.listMembers(ownerPerson.actor, workspaceId) as unknown as MemberRow[]).find((row) => row.email.toLowerCase() === plan.email);
        if (!member) throw new OpsError(`${plan.email} accepted the invitation but is not a member.`);
      } else {
        // Already a member: back in use, and the roles and teams this plan gives are added (nothing is taken away).
        const missingRoles = plan.roleCodes.filter((code) => !member!.roles.includes(code));
        const missingTeams = wantedTeamIds.filter((id) => !member!.teams.some((team) => team.id === id));
        if (member.status === "active" && !missingRoles.length && !missingTeams.length) report.add("members", "unchanged", plan.email, `${plan.displayName}: ${label}`);
        else if (!args.apply) report.add("members", "would change", plan.email, [member.status !== "active" ? "active again" : "", missingRoles.length ? `roles + ${missingRoles.join(", ")}` : "",
          missingTeams.length ? `${missingTeams.length} teams joined` : ""].filter(Boolean).join("; "));
        else {
          if (member.status !== "active" || missingRoles.length) {
            await workspaces.updateMember(ownerPerson.actor, workspaceId, member.id, await validated(UpdateMemberDto, {
              version: member.version, ...(member.status !== "active" ? { status: "active" } : {}), ...(missingRoles.length ? { roleCodes: [...member.roles, ...missingRoles] } : {}),
            }));
          }
          for (const teamId of missingTeams) {
            const team = (await workspaces.listTeams(ownerPerson.actor, workspaceId) as unknown as TeamRow[]).find((row) => row.id === teamId)!;
            await workspaces.updateTeam(ownerPerson.actor, workspaceId, teamId, await validated(UpdateTeamDto, {
              version: team.version, memberIds: [...team.members.map((entry) => entry.membershipId), member.id],
            }));
          }
          report.add("members", "changed", plan.email, `${plan.displayName}: ${label}`);
        }
      }
      if (password) {
        const { changed } = await auth.setMemberPassword(workspaceId, member.userId, password);
        report.add("members", changed ? "changed" : "unchanged", `${plan.email} password`, changed ? "set" : "as given");
      }
      return member.userId;
    }

    async function seed(members: Outcome[], ownerPerson: Person) {
      // The showcase's story only runs for real (each stage builds on the one before); a run makes only what is missing.
      if (!args.apply) { report.add("seed", "info", "showcase", "runs with --apply and makes only what an earlier run didn't"); return; }
      const id = (key: string) => members.find((member) => member.email === sandboxEmail(key, people))?.userId ?? undefined;
      const actorOf = async (key: string) => (await peopleByEmail(db, [sandboxEmail(key, people)])).get(sandboxEmail(key, people))?.actor ?? ownerPerson.actor;
      await ensureSuppliers(await actorOf("purchasing"), ownerPerson.actor);
      const { seedShowcase } = await import("../seed/showcase");
      // The showcase's people by role; a deal is submitted by someone other than the owner who approves it.
      const result = await seedShowcase({
        app, workspaceId, actorUserId: ownerPerson.userId, deliverEmail: false, log: () => undefined,
        actors: { owner: ownerPerson.userId, manager: id("manager"), salesAdmin: id("manager"), projectManager: id("manager"), sales: id("sales"), designer: id("designer"),
          estimator: id("qs"), finance: id("finance"), buyer: id("purchasing"), factory: id("factory"), site: id("site") },
      });
      report.add("seed", result.created.length ? "changed" : "unchanged", "showcase",
        `${result.created.length} created, ${result.reused.length} already there${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}`);
      for (const skipped of result.skipped.slice(0, 15)) report.add("seed", "info", skipped.stage, skipped.reason.slice(0, 200));
    }

    /** The fictional suppliers, saved by Purchasing and approved by the owner (two people, as the rule wants). */
    async function ensureSuppliers(buyer: RequestActor, approver: RequestActor) {
      const suppliers = get(SuppliersService);
      type Supplier = { id: string; name: string; approval: string; version: number; status: string };
      let state = await suppliers.list(buyer, workspaceId) as unknown as { entities: Array<{ id: string }>; suppliers: Supplier[] };
      for (const wanted of SANDBOX_SUPPLIERS) {
        const supplierId = stableId(workspaceId, `sandbox-supplier:${wanted.key}`);
        let found = state.suppliers.find((row) => row.id === supplierId && row.status !== "archived");
        if (!found) {
          state = await suppliers.save(buyer, workspaceId, { id: supplierId, version: 0, name: wanted.name, categories: wanted.categories, paymentTerms: "upfront",
            deal: "on_request", termsNote: "", dealNote: "", notes: "Fictional supplier for testing.", entityIds: state.entities.map((entity) => entity.id) }) as unknown as typeof state;
          found = state.suppliers.find((row) => row.id === supplierId)!;
          report.add("seed", "changed", `supplier ${wanted.name}`, "added");
        }
        if (found.approval === "approved") { report.add("seed", "unchanged", `supplier ${wanted.name}`, "approved"); continue; }
        state = await suppliers.approve(approver, workspaceId, found.id, { version: found.version, approval: "approved", note: "Approved for testing." }) as unknown as typeof state;
        report.add("seed", "changed", `supplier ${wanted.name}`, "approved");
      }
    }
  } finally {
    mailer.send = send;
  }
}

/** Runs a step; a refusal is reported as failed and the run goes on with the rest. */
async function guarded(report: Report, section: string, label: string, work: () => Promise<void>) {
  try { await work(); } catch (error) { report.add(section, "failed", label, describe(error)); }
}

async function readPassword(variable: string | null): Promise<string | null> {
  if (!variable) return null;
  const value = process.env[variable];
  if (!value) throw new OpsError(`The environment variable ${variable} is not set or empty.`);
  try { await validated(ActivateInvitationDto, { invitationToken: "sandbox-password-check-token", password: value }); } catch {
    throw new OpsError(`The password in ${variable} must be 10-128 characters and include uppercase, lowercase, number, and symbol.`);
  }
  return value;
}

async function readJson(path: string, what: string): Promise<unknown> {
  let text: string;
  try { text = await readFile(path, "utf8"); } catch { throw new OpsError(`No ${what} at ${path}.`); }
  try { return JSON.parse(text); } catch { throw new OpsError(`${path} is not valid JSON.`); }
}

/** The profile without the real firm's addresses and integrations; each removal is reported. */
async function readProfile(path: string, report: Report): Promise<Profile> {
  const { profile, dropped } = sandboxProfile(await readJson(path, "profile"));
  for (const entry of dropped) report.add("profile", "info", entry.path, `${entry.reason}: not copied into a sandbox`);
  try { return validateProfile(profile); } catch (error) {
    if (error instanceof ProfileError) throw new OpsError(error.message);
    throw error;
  }
}

async function readTeams(path: string): Promise<TeamSpec[]> {
  try {
    // A team's name is the only free text that reaches the workspace; one holding an address is replaced by the code.
    return parseTeamsFile(await readJson(path, "teams file")).map((team) => {
      const { value } = scrubForSandbox(team.name);
      return { ...team, name: typeof value === "string" ? value : team.code };
    });
  } catch (error) {
    if (error instanceof SandboxFileError) throw new OpsError(error.message);
    throw error;
  }
}

/** The CRM intake profile's lead options; an option whose label holds an address or the like is left out and reported. */
async function readCrm(path: string, report: Report): Promise<TaxonomySpec[]> {
  let taxonomies: TaxonomySpec[];
  try { taxonomies = parseCrmFile(await readJson(path, "CRM intake profile")); } catch (error) {
    if (error instanceof SandboxFileError) throw new OpsError(error.message);
    throw error;
  }
  const { value, dropped } = scrubForSandbox(taxonomies);
  for (const entry of dropped) report.add("crm", "info", entry.path, `${entry.reason}: not copied into a sandbox`);
  return (value as TaxonomySpec[]).map((taxonomy) => ({ ...taxonomy, options: taxonomy.options.filter((option) => option.label) })).filter((taxonomy) => taxonomy.options.length);
}

/**
 * The published region pack, firm kit and plan the sandbox is made with (latest selectable versions). An organization
 * added to a sandbox's account takes the sandbox's own kit and plan (the versions it was made with while they are still
 * published, else their latest).
 */
async function resolveSetup(db: DatabaseService, args: SandboxArgs, pinned: Pinned | null): Promise<Setup> {
  const latest = async (kind: string, code: string | null, version: number | null = null) => (await db.query<SetupProfile>(
    `SELECT code, version, configuration FROM tenant_setup_profiles WHERE kind = $1 AND selectable AND ($2::text IS NULL OR code = $2)
      ORDER BY (code = $3) DESC, code, (version = $4::int) IS TRUE DESC, version DESC LIMIT 1`, [kind, code, SANDBOX_PLAN, version])).rows[0];
  const region = await latest("region", args.region);
  if (!region) {
    const known = (await db.query<{ code: string }>(`SELECT DISTINCT code FROM tenant_setup_profiles WHERE kind = 'region' AND selectable ORDER BY code`)).rows.map((row) => row.code);
    throw new OpsError(`No published region pack for ${args.region}. Region packs: ${known.join(", ")}.`);
  }
  const kitCode = pinned?.kit.code ?? args.kit ?? SANDBOX_DEFAULT_KIT;
  const kit = await latest("firm_kit", kitCode, pinned?.kit.version ?? null);
  if (!kit) throw new OpsError(`No published firm kit ${kitCode}.`);
  const plan = await latest("plan", pinned?.plan.code ?? null, pinned?.plan.version ?? null);
  if (!plan) throw new OpsError(pinned ? `No published plan ${pinned.plan.code}.` : "No published plan.");
  return { region, kit, plan };
}

/**
 * The sandbox --organization-of names: made by this command (its provisioning id is sandbox-<slug>, its account's
 * too, and its owner invitation went to its test owner) and active, with its customer account and pinned kit and plan.
 */
async function resolveBase(app: INestApplicationContext, db: DatabaseService, slug: string): Promise<Base> {
  const externalTenantId = sandboxExternalTenantId(slug);
  const refused = new OpsError(`${slug} is not a sandbox this command made: --organization-of names one (made with sandbox --slug ${slug}).`);
  const known = (await db.query<{ workspaceId: string }>(`SELECT workspace_id AS "workspaceId" FROM tenant_provisioning_requests WHERE external_tenant_id = $1`, [externalTenantId])).rows[0];
  if (!known) throw refused;
  const tenant = await app.get(WorkspacesService, { strict: false }).getProvisionedTenant(externalTenantId) as unknown as
    { workspace: { slug: string; status: string }; ownerInvitation: { email: string }; account: { id: string; organizationLimit: number } | null };
  if (tenant.workspace.slug !== slug || tenant.ownerInvitation.email.toLowerCase() !== sandboxEmail(SANDBOX_PERSONAS[0].key, slug) || !tenant.account) throw refused;
  const account = (await db.query<{ externalId: string | null; status: string }>(
    `SELECT external_customer_id AS "externalId", status FROM customer_accounts WHERE id = $1`, [tenant.account.id])).rows[0];
  if (account?.externalId !== externalTenantId) throw refused;
  if (tenant.workspace.status !== "active" || account.status !== "active") throw new OpsError(`The sandbox ${slug} is not active; reactivate it in Wodana Control first.`);
  const pinned = (await db.tenantTransaction(known.workspaceId, known.workspaceId, (client) => client.query<{ kit: string; kitVersion: number; plan: string; planVersion: number }>(
    `SELECT firm_kit_code AS kit, firm_kit_version AS "kitVersion", plan_code AS plan, plan_version AS "planVersion" FROM workspace_setup_versions WHERE workspace_id = $1`,
    [known.workspaceId]))).rows[0];
  return { slug, workspaceId: known.workspaceId, accountId: tenant.account.id, organizationLimit: tenant.account.organizationLimit,
    pinned: pinned ? { kit: { code: pinned.kit, version: pinned.kitVersion }, plan: { code: pinned.plan, version: pinned.planVersion } } : null };
}

/**
 * Every organization in a customer account, and whether the sandbox command made it for the sandbox <slug>: its first
 * organization (provisioning id sandbox-<slug>) or one its test owner requested through this command (the request's
 * key is sandbox-organization:<slug>) and that was approved.
 */
async function accountOrganizations(db: DatabaseService, accountId: string, slug: string): Promise<AccountOrganization[]> {
  return (await db.query<AccountOrganization>(
    `SELECT linked.workspace_id AS "workspaceId", branding.login_slug AS "loginSlug",
            (EXISTS (SELECT 1 FROM tenant_provisioning_requests provisioned WHERE provisioned.workspace_id = linked.workspace_id AND provisioned.external_tenant_id = $2)
             OR EXISTS (SELECT 1 FROM organization_requests request JOIN users person ON person.id = request.requested_by
                         WHERE request.approved_workspace_id = linked.workspace_id AND request.account_id = linked.account_id AND request.status = 'approved'
                           AND request.idempotency_key LIKE 'sandbox-organization:%' AND lower(person.primary_email::text) = $3)) AS "madeHere"
       FROM customer_account_organizations linked
       LEFT JOIN tenant_login_branding branding ON branding.workspace_id = linked.workspace_id
      WHERE linked.account_id = $1
      ORDER BY linked.is_default DESC, linked.workspace_id`,
    [accountId, sandboxExternalTenantId(slug), sandboxEmail(SANDBOX_PERSONAS[0].key, slug)])).rows;
}

/** A slug an organization, or a provisioning reservation, already holds. */
async function slugIsTaken(db: DatabaseService, slug: string): Promise<boolean> {
  return Boolean((await db.query<{ taken: boolean }>(
    `SELECT wodana_internal_slug_taken($1::varchar) OR EXISTS (SELECT 1 FROM tenant_provisioning_drafts WHERE slug = $1
       AND (status = 'provisioned' OR (status IN ('draft', 'provisioning', 'failed') AND reservation_expires_at > now()))) AS taken`, [slug])).rows[0]?.taken);
}

type RegionConfig = { currency: string; locale: string; timezone: string; unitSystem: string; weekStartsOn: number; countryCode: string };

/** An organization's regional defaults and first company, all from the region pack. */
function regionalDefaults(args: SandboxArgs, region: RegionConfig) {
  return {
    defaultCurrency: region.currency, defaultLocale: region.locale, defaultTimezone: region.timezone, unitSystem: region.unitSystem, weekStartsOn: region.weekStartsOn,
    firstLegalEntity: { code: sandboxLegalEntityCode(args.slug), displayName: args.name, registeredName: args.name, countryCode: region.countryCode,
      baseCurrency: region.currency, locale: region.locale, timezone: region.timezone },
  };
}

const setupSelections = (setup: Setup, seatLimit: number) => ({
  region: { code: setup.region.code, version: setup.region.version }, firmKit: { code: setup.kit.code, version: setup.kit.version },
  plan: { code: setup.plan.code, version: setup.plan.version }, seatLimit,
});

/** The standard rate the region pack gives: its own rates, else the standard sales rate of its ledger template. */
async function regionRates(db: DatabaseService, setup: Setup, model: { model: string; label: string | null }) {
  type Rate = { code?: string; label?: string; rate?: string | number; isDefault?: boolean };
  const config = setup.region.configuration as { taxPolicy?: { rates?: Rate[] }; tax?: { rates?: Rate[] } };
  const own = (config.taxPolicy?.rates?.length ? config.taxPolicy.rates : config.tax?.rates ?? [])
    .filter((rate) => rate && rate.label && rate.rate !== undefined);
  if (own.length) {
    const defaultIndex = Math.max(0, own.findIndex((rate) => rate.isDefault));
    return own.map((rate, index) => ({ code: String(rate.code ?? rate.label), label: String(rate.label), rate: String(rate.rate), isDefault: index === defaultIndex }));
  }
  const template = (await db.query<{ configuration: { taxCodes?: Array<{ direction: string; treatment: string; rate: string }> } }>(
    `SELECT configuration FROM tenant_setup_profiles WHERE kind = 'books' AND selectable AND configuration->'countryCodes' ? $1 ORDER BY version DESC LIMIT 1`,
    [setup.region.code])).rows[0];
  const standard = template?.configuration.taxCodes?.find((code) => code.direction === "sales" && code.treatment === "standard");
  if (!standard) return [];
  const label = model.label ?? "Tax";
  return [{ code: `standard_${model.model}`, label: `Standard ${label}`, rate: String(Number(standard.rate)), isDefault: true }];
}

/** People by address (lower case), as the operator CLI acts as them. */
async function peopleByEmail(db: DatabaseService, emails: string[]): Promise<Map<string, Person>> {
  const rows = (await db.query<{ id: string; email: string; displayName: string }>(
    `SELECT id, lower(primary_email::text) AS email, display_name AS "displayName" FROM users WHERE lower(primary_email::text) = ANY($1::text[]) AND status = 'active'`,
    [emails.map((email) => email.toLowerCase())])).rows;
  return new Map(rows.map((row) => [row.email, { userId: row.id, email: row.email, displayName: row.displayName, actor: operatorActor({ userId: row.id, email: row.email, displayName: row.displayName }) }]));
}

async function activeMembership(db: DatabaseService, workspaceId: string, userId: string) {
  const found = await db.tenantTransaction(workspaceId, userId, (client) => client.query(
    `SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, userId]));
  return Boolean(found.rowCount);
}

type Files = { teams: TeamSpec[] | null; leadOptions: TaxonomySpec[] | null; profile: Profile | null };

/**
 * A dry run before the owner is in (the workspace isn't made yet, or an earlier run stopped first): what --apply would
 * do after the owner accepts, from the kit's roles and the files given.
 */
function planRemainder(args: SandboxArgs, setup: Setup, files: Files, report: Report, password: string | null, known: Map<string, Person> | null = null) {
  const { teams, leadOptions, profile } = files;
  const people = args.organizationOf ?? args.slug;
  // An added organization is covered by the account's policy, which the sandbox already set.
  if (!args.organizationOf) report.add("security", "would change", "authenticator", "needed → not needed to sign in");
  report.add("workspace", "would change", "onboarding", "complete");
  report.add("workspace", "would change", "client portal", "on");
  report.add("tax", "would change", "tax profile", "the region pack's standard rate");
  if (teams) report.add("teams", "would change", "teams", `${teams.length} teams, each with its role`);
  if (leadOptions) report.add("crm", "would change", "lead options", leadOptions.map((taxonomy) => taxonomy.code).join(", "));
  const roles = new Set([...SYSTEM_ROLE_CODES, ...parseRoleTemplateCodes(setup.kit.configuration.roleTemplates)]);
  const plans = planMembers(people, roles, teams ?? []);
  for (const plan of plans.slice(1)) {
    report.add("members", "would change", plan.email, `${plan.displayName}: ${args.organizationOf ? "joins" : "invited and active"} as ${[...plan.roleCodes, ...plan.teamCodes.map((code) => `team ${code}`)].join(", ")}`);
  }
  if (!password && !args.organizationOf) report.add("members", "manual", "passwords", "--apply needs --password-env");
  if (profile) report.add("profile", "would change", "profile", `${Object.keys(profile).length} sections, applied as configure once the workspace exists`);
  if (args.seed) report.add("seed", "would change", "showcase", "records for every section, made by the test members");
  // An added organization's people are already there (the sandbox's own); a new sandbox's are made with --apply.
  printMembers(report, plans.map((plan) => ({ email: plan.email, displayName: plan.displayName, roles: plan.roleCodes, teams: plan.teamCodes,
    userId: known?.get(plan.email)?.userId ?? null })), args.passwordEnv, known, args.organizationOf);
}

/**
 * Each test member's address, roles and user id (never a password), the people this run made (with --organization-of:
 * none, as they are the sandbox's own) and the ids for the device-limit exemption.
 */
function printMembers(report: Report, members: Outcome[], passwordEnv: string | null, before: Map<string, Person> | null, organizationOf: string | null) {
  report.facts.members = members;
  const ids = members.flatMap((member) => (member.userId ? [member.userId] : []));
  if (ids.length) report.facts.deviceLimitExemptUserIds = ids.join(",");
  const made = before ? members.flatMap((member) => (member.userId && before.get(member.email)?.userId !== member.userId ? [member.userId] : [])) : [];
  if (before) report.facts.newUserIds = made;
  report.note(`\nTest members${passwordEnv ? ` (password from $${passwordEnv}, not shown)` : organizationOf ? ` of sandbox ${organizationOf} (their passwords unchanged)` : ""}:`);
  for (const member of members) {
    report.note(`  ${member.email.padEnd(32)} ${member.displayName.padEnd(22)} ${[...member.roles, ...member.teams.map((code) => `team ${code}`)].join(", ").padEnd(48)} ${member.userId ?? (organizationOf ? `(not in sandbox ${organizationOf})` : "(made with --apply)")}`);
  }
  if (organizationOf && before) {
    report.note(made.length ? `New people (unexpected): ${made.join(",")}` : "No new people: the device-limit exemption needs no change.");
    if (made.length) report.note(`User ids for AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS (add to the list already there): ${made.join(",")}`);
  } else if (ids.length) report.note(`User ids for AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS (add to the list already there): ${ids.join(",")}`);
}
