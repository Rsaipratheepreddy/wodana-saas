import { isDeepStrictEqual } from "node:util";
import { CrmLeadsService } from "../../crm/leads/crm-leads.service";
import { suggestedFlow } from "../../crm/opportunities/flow-gates";
import { CreateAssignmentPolicyDto, CreateQueueDto, CreateSlaPolicyDto, UpdateAssignmentPolicyDto, UpdateQueueDto, UpdateSlaPolicyDto } from "../../crm/leads/dto/leads.dto";
import { CrmSettingsService } from "../../crm/settings/crm-settings.service";
import { CreateTaxonomyDto, UpdateTaxonomyDto } from "../../crm/settings/dto/settings.dto";
import { UpdateTeamDto } from "../../workspaces/dto/update-team.dto";
import { WorkspacesService } from "../../workspaces/workspaces.service";
import { actorOf, type Actor, type Core } from "./core";
import type { SeedData } from "./data";

type Option = { code: string; label: string; allowedRoles?: string[] };
type Taxonomy = { id: string; code: string; name: string; status: string; version: number; options: Array<{ code: string; label: string; position: number; status: string }> };

/** The tracker's team codes named in the profile ("Self Generated" is for Sales, Sales Admin and Ops) → this workspace's role codes. */
function roleCodes(teams: string[] | undefined) {
  if (!teams?.length) return undefined;
  return [...new Set(["owner", "administrator", ...teams.map((team) => `team_${team.toLowerCase()}`)])];
}

/**
 * The CRM intake profile (the lead-flow report as Palm approved it): sources and their channels, enquiry types,
 * budget ranges, client types, referral lists; the Sales queue with its takeover clock and how it shares enquiries, the first-response SLA,
 * the default assignment policy, and the Sales team linked to the queue. Compared first, written only when different.
 */
export async function ensureCrmProfile(core: Core, data: SeedData, workspaceId: string, owner: Actor) {
  const profile = data.crmProfile;
  if (!profile) { core.report.notes.push("No CRM intake profile fixture; sources, enquiry types and the Sales queue were not configured."); return; }
  const actor = actorOf(owner);
  const settings = core.get(CrmSettingsService), leads = core.get(CrmLeadsService), workspaces = core.get(WorkspacesService);

  const desired: Array<{ code: string; name: string; options: Option[] }> = [
    { code: "lead_source", name: "Lead source", options: profile.sources },
    ...Object.entries(profile.channels).map(([source, options]) => ({
      code: `lead_channel_${source}`, name: `${profile.sources.find((entry) => entry.code === source)?.label ?? source} channels`, options,
    })),
    { code: "enquiry_type", name: "Enquiry type", options: profile.enquiryTypes },
    { code: "customer_type", name: "Client type", options: profile.customerTypes ?? [] },
    { code: "referral_broker", name: "Brokers", options: profile.referralBrokers ?? [] },
    { code: "referral_partner", name: "Referral partners", options: profile.referralPartners ?? [] },
    { code: "budget_range", name: "Budget range", options: profile.budgetRanges },
  ];
  let current = (await settings.list(actor, workspaceId)) as { taxonomies: Taxonomy[] };
  for (const taxonomy of desired) {
    const existing = current.taxonomies.find((row) => row.code === taxonomy.code);
    // QA-002: a new enquiry type starts from the flow its code and label suggest (Design, Fit-out, Furniture or Basic).
    const known = new Set(existing?.options.map((row) => row.code) ?? []);
    const flowOf = (code: string, label: string) => (taxonomy.code === "enquiry_type" && code !== "not_sure" && !known.has(code) ? { flow: suggestedFlow(`${code} ${label}`) } : {});
    const options = taxonomy.options.map((option, position) => ({ code: option.code, label: option.label, position, ...(roleCodes(option.allowedRoles) ? { allowedRoles: roleCodes(option.allowedRoles) } : {}),
      ...flowOf(option.code, option.label) }));
    const same = existing?.status === "active" && existing.name === taxonomy.name
      && isDeepStrictEqual(existing.options.filter((row) => row.status === "active").map(({ code, label, position }) => ({ code, label, position })),
        options.map(({ code, label, position }) => ({ code, label, position })));
    if (existing) {
      await core.ensure("crm taxonomy", `taxonomy ${taxonomy.code}`, async () => same, async () => {
        await settings.updateTaxonomy(actor, workspaceId, existing.id, await core.validated(UpdateTaxonomyDto, { version: existing.version, name: taxonomy.name, status: "active", options }));
      });
    } else {
      await core.step("crm taxonomy", `taxonomy ${taxonomy.code}`, async () => null, async () =>
        settings.createTaxonomy(actor, workspaceId, await core.validated(CreateTaxonomyDto, { code: taxonomy.code, name: taxonomy.name, options }))).catch(swallow);
    }
  }
  current = (await settings.list(actor, workspaceId)) as { taxonomies: Taxonomy[] };

  // The Sales queue: the fallback, with the takeover clock on Palm's working hours, in the Sales business unit.
  const detail = (await workspaces.get(actor, workspaceId)) as unknown as { businessUnits: Array<{ id: string; code: string; status: string }> };
  const salesUnit = detail.businessUnits.find((unit) => unit.code === "SALES" && unit.status === "active");
  type Queue = { id: string; code: string; name: string; status: string; isFallback: boolean; takeoverAfterMinutes: number | null; takeoverSchedule: unknown; assignmentMode?: string; businessUnitId: string | null; version: number };
  const queues = (await leads.listQueues(actor, workspaceId)) as Queue[];
  const wanted = profile.operations.queue;
  // How the queue shares enquiries: the profile's mode, else balanced (the lightest load first).
  const assignmentMode = wanted.assignmentMode ?? "balanced";
  let queue = queues.find((row) => row.code === wanted.code) ?? null;
  const queueSame = (row: Queue) => row.status === "active" && row.name === wanted.name && row.isFallback === true && row.takeoverAfterMinutes === wanted.takeoverAfterMinutes
    && isDeepStrictEqual(row.takeoverSchedule ?? null, wanted.takeoverSchedule ?? null) && (!salesUnit || row.businessUnitId === salesUnit.id)
    && (row.assignmentMode ?? "balanced") === assignmentMode;
  if (queue) {
    const found = queue;
    await core.ensure("crm queue", `queue ${wanted.code}`, async () => queueSame(found), async () => {
      queue = (await leads.updateQueue(actor, workspaceId, found.id, await core.validated(UpdateQueueDto, { version: found.version, name: wanted.name, isFallback: true,
        takeoverAfterMinutes: wanted.takeoverAfterMinutes, takeoverSchedule: wanted.takeoverSchedule, assignmentMode, status: "active", ...(salesUnit ? { businessUnitId: salesUnit.id } : {}) }))) as Queue;
    });
  } else {
    queue = await core.step("crm queue", `queue ${wanted.code}`, async () => null, async () =>
      leads.createQueue(actor, workspaceId, await core.validated(CreateQueueDto, { code: wanted.code, name: wanted.name, isFallback: true, takeoverAfterMinutes: wanted.takeoverAfterMinutes,
        takeoverSchedule: wanted.takeoverSchedule, assignmentMode, ...(salesUnit ? { businessUnitId: salesUnit.id } : {}) })) as Promise<Queue>).catch(swallow);
  }

  // First-response SLA on the same working hours.
  type Sla = { id: string; name: string; eventType: string; status: string; warningAfterMinutes: number; breachAfterMinutes: number; calculationMode: string; schedule: unknown; version: number };
  const slas = (await leads.listSlaPolicies(actor, workspaceId)) as Sla[];
  const sla = profile.operations.firstResponseSla;
  const existingSla = slas.find((row) => row.eventType === "first_response" && row.status === "active");
  const slaBody = { name: sla.name, eventType: "first_response", warningAfterMinutes: sla.warningAfterMinutes, breachAfterMinutes: sla.breachAfterMinutes, calculationMode: sla.calculationMode, schedule: sla.schedule };
  if (existingSla) {
    await core.ensure("crm sla", "first response SLA", async () => existingSla.name === sla.name && existingSla.warningAfterMinutes === sla.warningAfterMinutes
      && existingSla.breachAfterMinutes === sla.breachAfterMinutes && existingSla.calculationMode === sla.calculationMode && isDeepStrictEqual(existingSla.schedule, sla.schedule),
    async () => leads.updateSlaPolicy(actor, workspaceId, existingSla.id, await core.validated(UpdateSlaPolicyDto, { version: existingSla.version, status: "active", ...slaBody })));
  } else {
    await core.step("crm sla", "first response SLA", async () => null, async () => leads.createSlaPolicy(actor, workspaceId, await core.validated(CreateSlaPolicyDto, slaBody))).catch(swallow);
  }

  if (!queue) return;
  // The default assignment policy: everything not matched by a rule goes to the Sales queue, keeping an existing relationship owner.
  type Policy = { id: string; name: string; status: string; priority: number; fallbackQueueId: string; preserveRelationshipOwner: boolean; rules: unknown[]; version: number };
  const policies = (await leads.listAssignmentPolicies(actor, workspaceId)) as Policy[];
  const policyName = "Palm Living default assignment";
  const policy = policies.find((row) => row.name === policyName && row.status === "active");
  const policyBody = { name: policyName, priority: 100, fallbackQueueId: queue.id, preserveRelationshipOwner: true, rules: [] as unknown[] };
  if (policy) {
    await core.ensure("crm assignment policy", "default assignment", async () => policy.priority === 100 && policy.fallbackQueueId === queue!.id && policy.preserveRelationshipOwner === true && !policy.rules.length,
      async () => leads.updateAssignmentPolicy(actor, workspaceId, policy.id, await core.validated(UpdateAssignmentPolicyDto, { version: policy.version, status: "active", ...policyBody })));
  } else {
    await core.step("crm assignment policy", "default assignment", async () => null, async () => leads.createAssignmentPolicy(actor, workspaceId, await core.validated(CreateAssignmentPolicyDto, policyBody))).catch(swallow);
  }

  // The Sales team answers the queue: everyone in it is an effective queue member.
  const teams = (await workspaces.listTeams(actor, workspaceId)) as Array<{ id: string; code: string; version: number; queueIds: string[] }>;
  for (const code of ["SALES", "SALES_ADMIN"]) {
    const team = teams.find((row) => row.code === code);
    if (!team) { core.report.record("crm queue team", "pending", `team ${code} is not created yet`); continue; }
    await core.ensure("crm queue team", `queue ${wanted.code} answered by ${code}`, async () => team.queueIds.includes(queue!.id),
      async () => workspaces.updateTeam(actor, workspaceId, team.id, await core.validated(UpdateTeamDto, { version: team.version, queueIds: [...new Set([...team.queueIds, queue!.id])] })));
  }
}

function swallow(error: unknown) {
  if ((error as { reason?: string })?.reason) return null;
  throw error;
}
