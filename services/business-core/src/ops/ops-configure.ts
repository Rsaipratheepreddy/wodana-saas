import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { ApprovalPoliciesService } from "../approvals/approval-policies.service";
import { CatalogV2Service } from "../catalog-core/catalog-v2.service";
import { categoryKey } from "../catalog-core/category-names";
import { OWNER_ROLE } from "../approvals/approval-policy";
import { workspaceHours } from "../crm/conversations/inbox/auto-replies";
import { CrmEnquiryTypesService } from "../crm/flows/crm-enquiry-types.service";
import { UpdateEnquiryTypeDto } from "../crm/flows/dto/enquiry-type.dto";
import { CrmLeadsService } from "../crm/leads/crm-leads.service";
import { CreateSlaPolicyDto, UpdateSlaPolicyDto } from "../crm/leads/dto/leads.dto";
import { normalizeSlaSchedule, SLA_DAY_KEYS } from "../crm/leads/sla-schedule";
import { CrmSettingsService } from "../crm/settings/crm-settings.service";
import { DesignPackagesService } from "../design/design-packages.service";
import { FactoryService } from "../factory/factory.service";
import { FinanceRequestsService } from "../finance-requests/finance-requests.service";
import { FulfilmentService } from "../fulfilment/fulfilment.service";
import { LogisticsService } from "../logistics/logistics.service";
import { DRAWING_CHECKS, type StageCheck, type TemplateStage } from "../project-core/project-checks";
import { ProjectCoreService } from "../project-core/project-core.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { UpdateRoleDto } from "../workspaces/dto/update-role.dto";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { OpsContext, Report } from "./ops-context";
import { WEEK_DAYS, type CheckSpec, type DesignStepKey, type DesignTeamKey, type Profile, type ProfileSection, type RouteChange } from "./ops-profile";

/**
 * `configure`: a workspace configuration profile applied through the settings commands each screen uses (with their
 * permission checks, version checks, validation and audit), never SQL. Each section reads the current settings,
 * reports what is already as the profile says, and changes the rest (only with --apply). A second run changes nothing.
 * A part with no settings command is reported as manual.
 */

type Change = { label: string; detail?: string };
type Section = (ctx: OpsContext, profile: Profile, step: Step) => Promise<void>;
type Step = {
  same(label: string, detail?: string): void;
  missing(label: string, detail?: string): void;
  manual(label: string, detail: string): void;
  info(label: string, detail?: string): void;
  /** Changes made together by one command: reported as would change (dry run), or run once and reported as changed. */
  change(changes: Change[], run: () => Promise<unknown>): Promise<void>;
};

const lower = (text: string | null | undefined) => (text ?? "").trim().toLowerCase();
const shown = (value: unknown) => (value === null || value === undefined || value === "" ? "(none)" : Array.isArray(value) ? `[${value.join(", ")}]` : String(value));
const stable = (value: unknown): string => JSON.stringify(value, (_key, entry) => (entry && typeof entry === "object" && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : entry));
const diff = (label: string, before: unknown, after: unknown): Change => ({ label, detail: `${shown(before)} → ${shown(after)}` });

// ---------- enquiry types ----------

const enquiryTypes: Section = async (ctx, profile, step) => {
  const settings = await ctx.get(CrmSettingsService).list(ctx.actor, ctx.workspace.id) as { taxonomies: Array<{ code: string; options: Array<{ id: string; code: string; status: string; version: number }> }> };
  const options = settings.taxonomies.find((taxonomy) => taxonomy.code === "enquiry_type")?.options ?? [];
  for (const code of profile.enquiryTypes!.archive) {
    const option = options.find((entry) => lower(entry.code) === lower(code));
    if (!option) { step.missing(`enquiry type ${code}`, "no enquiry type with this code"); continue; }
    if (option.status === "archived") { step.same(`enquiry type ${code}`, "archived"); continue; }
    await step.change([{ label: `enquiry type ${code}`, detail: "active → archived" }], async () =>
      ctx.get(CrmEnquiryTypesService).update(ctx.actor, ctx.workspace.id, option.id, await ctx.validated(UpdateEnquiryTypeDto, { version: option.version, status: "archived" })));
  }
};

// ---------- vehicles ----------

type Vehicle = { id: string; name: string; plate: string | null; kind: string | null; capacityNote: string | null; active: boolean; version: number };
type LogisticsSettings = { vehicles: Vehicle[]; permitWarningDays: number; dealDeliveryPermit: boolean; permitExpiryReminderDays: number; settingsVersion: number };

const vehicles: Section = async (ctx, profile, step) => {
  const logistics = ctx.get(LogisticsService);
  const current = (await logistics.vehicles(ctx.actor, ctx.workspace.id) as LogisticsSettings).vehicles;
  for (const wanted of profile.vehicles!) {
    const found = current.find((vehicle) => lower(vehicle.name) === lower(wanted.name));
    if (!found) {
      await step.change([{ label: `vehicle ${wanted.name}`, detail: "added" }], () => logistics.saveVehicle(ctx.actor, ctx.workspace.id,
        { id: randomUUID(), version: 0, name: wanted.name, plate: wanted.plate ?? "", kind: wanted.type ?? "", active: true }));
      continue;
    }
    const changes: Change[] = [];
    if (wanted.plate !== undefined && (found.plate ?? "") !== wanted.plate) changes.push({ label: `vehicle ${wanted.name}`, detail: "plate changed" });
    if (wanted.type !== undefined && (found.kind ?? "") !== wanted.type) changes.push(diff(`vehicle ${wanted.name} type`, found.kind, wanted.type));
    if (!found.active) changes.push({ label: `vehicle ${wanted.name}`, detail: "back in use" });
    if (!changes.length) { step.same(`vehicle ${wanted.name}`); continue; }
    await step.change(changes, () => logistics.saveVehicle(ctx.actor, ctx.workspace.id, {
      id: found.id, version: found.version, name: found.name, plate: wanted.plate ?? found.plate ?? "", kind: wanted.type ?? found.kind ?? "",
      capacityNote: found.capacityNote ?? "", active: true }));
  }
};

// ---------- factory and permits ----------

const routesHavePermit = (stages: TemplateStage[][]) => stages.some((route) => route.some((stage) => stage.checks.some((check) => check.kind === "permit_collected")));

type InspectionView = {
  settings: { inspectionsEnabled: boolean; inspectionStages: Array<{ kind: string; label: string }>; inspectionWorkPackages: string[]; inspectorRole: string; directorRole: string | null;
    directorPackages: string[]; inspectionDays: number; version: number };
  inspectionChoices: { roles: Array<{ key: string; label: string }>; workPackages: Array<{ id: string; name: string }>; designPackages: Array<{ code: string; name: string }> };
};

/**
 * PLM-150: design inspections. Trades are matched by name to the firm's work packages, roles to its project roles and
 * packages to its design packages; one it doesn't have is reported, not invented.
 */
async function inspections(ctx: OpsContext, wanted: NonNullable<NonNullable<Profile["factory"]>["inspections"]>, step: Step) {
  const service = ctx.get(FactoryService);
  const { settings, inspectionChoices: choices } = await service.settings(ctx.actor, ctx.workspace.id) as InspectionView;
  const patch: Record<string, unknown> = {};
  const changes: Change[] = [];
  const compare = (label: string, key: string, before: unknown, value: unknown, shownAs = shown) => {
    if (value === undefined) return;
    if (stable(before) === stable(value)) step.same(label, shownAs(before));
    else { patch[key] = value; changes.push(diff(label, shownAs(before), shownAs(value))); }
  };
  compare("design inspections", "inspectionsEnabled", settings.inspectionsEnabled, wanted.enabled);
  if (wanted.stages) compare("inspection stages", "inspectionStages", settings.inspectionStages.map(({ kind, label }) => ({ kind, label })), wanted.stages,
    (value) => (value as Array<{ kind: string; label: string }>).map((stage) => stage.label || stage.kind).join(" / "));
  if (wanted.trades) {
    const ids = wanted.trades.flatMap((name) => {
      const found = choices.workPackages.find((entry) => lower(entry.name) === lower(name));
      if (!found) step.missing(`inspected trade ${name}`, "no active work package with this name; choose it in Settings › Factory once it exists");
      return found ? [found.id] : [];
    });
    const name = (value: unknown) => (value as string[]).map((id) => choices.workPackages.find((entry) => entry.id === id)?.name ?? id).sort().join(", ") || "every made item";
    compare("inspected trades", "inspectionWorkPackages", [...settings.inspectionWorkPackages].sort(), [...new Set(ids)].sort(), name);
  }
  const role = (label: string, key: "inspectorRole" | "directorRole", value: string | null | undefined, before: string | null) => {
    if (value === undefined) return;
    if (value !== null && !choices.roles.some((entry) => entry.key === value)) { step.missing(`${label} ${value}`, "no project role with this key; add it in Settings › Projects › Roles"); return; }
    compare(label, key, before, value);
  };
  role("inspecting role", "inspectorRole", wanted.inspectorRole, settings.inspectorRole);
  role("inspecting role on director packages", "directorRole", wanted.directorRole, settings.directorRole);
  if (wanted.directorPackages) {
    const codes = wanted.directorPackages.filter((code) => {
      const found = choices.designPackages.some((entry) => entry.code === code);
      if (!found) step.missing(`design package ${code}`, "no design package with this code");
      return found;
    });
    compare("design packages the director inspects", "directorPackages", [...settings.directorPackages].sort(), [...new Set(codes)].sort(), (value) => (value as string[]).join(", ") || "none");
  }
  compare("working days to inspect", "inspectionDays", settings.inspectionDays, wanted.workingDays);
  if (changes.length) await step.change(changes, async () => {
    const fresh = await service.settings(ctx.actor, ctx.workspace.id) as { settings: { version: number } };
    return service.saveSettings(ctx.actor, ctx.workspace.id, { version: fresh.settings.version, ...patch });
  });
}

const factory: Section = async (ctx, profile, step) => {
  const wanted = profile.factory!;
  const service = ctx.get(FactoryService);
  if (wanted.productionSteps !== undefined || wanted.clientPaymentReminderDays !== undefined) {
    const { settings } = await service.settings(ctx.actor, ctx.workspace.id) as { settings: { productionSteps: Array<{ kind: string; label: string }>; balanceReminderDays: number; version: number } };
    const patch: Record<string, unknown> = {};
    const changes: Change[] = [];
    const words = (steps: Array<{ kind: string; label: string }>) => steps.map((entry) => entry.label || entry.kind).join(" / ");
    if (wanted.productionSteps) {
      if (stable(settings.productionSteps.map(({ kind, label }) => ({ kind, label }))) === stable(wanted.productionSteps)) step.same("production steps", words(settings.productionSteps));
      else { patch.productionSteps = wanted.productionSteps; changes.push(diff("production steps", words(settings.productionSteps), words(wanted.productionSteps))); }
    }
    if (wanted.clientPaymentReminderDays !== undefined) {
      if (settings.balanceReminderDays === wanted.clientPaymentReminderDays) step.same("client payment reminder days", String(settings.balanceReminderDays));
      else { patch.balanceReminderDays = wanted.clientPaymentReminderDays; changes.push(diff("client payment reminder days", settings.balanceReminderDays, wanted.clientPaymentReminderDays)); }
    }
    if (changes.length) await step.change(changes, async () => {
      const fresh = await service.settings(ctx.actor, ctx.workspace.id) as { settings: { version: number } };
      return service.saveSettings(ctx.actor, ctx.workspace.id, { version: fresh.settings.version, ...patch });
    });
  }
  if (wanted.inspections) await inspections(ctx, wanted.inspections, step);
  const permits = wanted.permits;
  if (!permits) return;
  const logistics = ctx.get(LogisticsService);
  const current = await logistics.vehicles(ctx.actor, ctx.workspace.id) as LogisticsSettings;
  const patch: Record<string, unknown> = {};
  const changes: Change[] = [];
  const compare = (label: string, key: "permitWarningDays" | "dealDeliveryPermit" | "permitExpiryReminderDays", value: number | boolean | undefined) => {
    if (value === undefined) return;
    if (current[key] === value) step.same(label, String(value));
    else { patch[key] = value; changes.push(diff(label, current[key], value)); }
  };
  compare("permit missing-alert working days", "permitWarningDays", permits.missingAlertWorkingDays);
  compare("furniture deliveries need a permit", "dealDeliveryPermit", permits.furnitureDeliveriesNeedOne);
  compare("permit expiry reminder days", "permitExpiryReminderDays", permits.expiryReminderDays);
  if (changes.length) await step.change(changes, async () => {
    const fresh = await logistics.vehicles(ctx.actor, ctx.workspace.id) as LogisticsSettings;
    return logistics.saveSettings(ctx.actor, ctx.workspace.id, { version: fresh.settingsVersion, ...patch });
  });
  if (permits.requiredForDeliveriesAndInstallations !== undefined) {
    // Not a switch: a project needs a permit when its route has the permit_collected check (pick-up never does).
    const { templates } = await ctx.get(ProjectCoreService).settings(ctx.actor, ctx.workspace.id) as { templates: Array<{ stages: TemplateStage[] }> };
    const has = routesHavePermit(templates.map((template) => template.stages));
    const planned = (profile.routes ?? []).some((route) => [...route.addStages.flatMap((stage) => stage.checks), ...route.addChecks.flatMap((stage) => stage.checks)]
      .some((check) => check.kind === "permit_collected"));
    if (!permits.requiredForDeliveriesAndInstallations) step.manual("permit required for deliveries and installations", "Settings › Projects › Routes: remove the Permit collection check");
    else if (has) step.same("permit required for deliveries and installations", "the route's Permit collection check (permit_collected) applies it; pick-up never needs one");
    else if (planned) step.info("permit required for deliveries and installations", "applied by the routes section's Permit collection check");
    else step.manual("permit required for deliveries and installations", "Settings › Projects › Routes: add a stage with the \"Building permit collected\" check");
  }
};

// ---------- quotations ----------

const quotations: Section = async (ctx, profile, step) => {
  const wanted = profile.quotations!;
  const service = ctx.get(QuotationBuilderService);
  const current = await service.settings(ctx.actor, ctx.workspace.id) as {
    settings: { validityDays: number; qsReview: boolean; qsReviewScope: string; qsReviewItemTypes: string[]; version: number };
    workPackages: Array<{ id: string; name: string; archived: boolean; qsReview: boolean }> };
  const patch: Record<string, unknown> = {};
  const changes: Change[] = [];
  const compare = (label: string, key: "validityDays" | "qsReview" | "qsReviewScope" | "qsReviewItemTypes", value: unknown) => {
    if (value === undefined) return;
    const before = current.settings[key];
    const next = Array.isArray(value) ? [...new Set(value)].sort() : value;
    if (stable(before) === stable(next)) step.same(label, shown(before));
    else { patch[key] = next; changes.push(diff(label, before, next)); }
  };
  compare("validity days", "validityDays", wanted.validityDays);
  compare("QS prices quotations", "qsReview", wanted.qsReview);
  compare("quotations the QS prices", "qsReviewScope", wanted.qsPrices);
  compare("catalogue kinds for QS review", "qsReviewItemTypes", wanted.qsItemTypes);
  if (changes.length) await step.change(changes, async () => {
    const fresh = await service.settings(ctx.actor, ctx.workspace.id) as { settings: { version: number } };
    return service.saveSettings(ctx.actor, ctx.workspace.id, { version: fresh.settings.version, ...patch });
  });
  for (const name of wanted.qsWorkPackages ?? []) {
    const found = current.workPackages.find((entry) => !entry.archived && lower(entry.name) === lower(name));
    if (!found) { step.missing(`work package ${name}`, "no active work package with this name; flag it in Settings › Quotations once it exists"); continue; }
    if (found.qsReview) { step.same(`work package ${name}`, "flagged for QS review"); continue; }
    await step.change([{ label: `work package ${name}`, detail: "flagged for QS review" }], () => service.updateWorkPackage(ctx.actor, ctx.workspace.id, found.id, { qsReview: true }));
  }
};

// ---------- first response ----------

type SlaPolicy = { id: string; eventType: string; status: string; warningAfterMinutes: number; breachAfterMinutes: number; calculationMode: string; schedule: unknown; version: number };

const firstResponse: Section = async (ctx, profile, step) => {
  const wanted = profile.firstResponse!;
  const hours = await ctx.read((client) => workspaceHours(client, ctx.workspace.id));
  const workspaceDays = hours.workingDays.map((day) => WEEK_DAYS[day]);
  const calendar = wanted.workingCalendar ?? { days: workspaceDays, start: hours.start, end: hours.end };
  const timeZone = wanted.workingCalendar?.timeZone ?? hours.timeZone;
  const sameAsWorkspace = stable([...calendar.days].sort()) === stable([...workspaceDays].sort()) && calendar.start === hours.start && calendar.end === hours.end && timeZone === hours.timeZone;
  step.info("first-response working hours", wanted.workingCalendar
    ? `${calendar.days.join(", ")} ${calendar.start}–${calendar.end}${sameAsWorkspace ? " (the same as the workspace calendar)" : " (the policy's own hours, not the workspace calendar)"}`
    : `from the workspace calendar: ${calendar.days.join(", ")} ${calendar.start}–${calendar.end}`);
  const window = [{ start: calendar.start, end: calendar.end }];
  const schedule = normalizeSlaSchedule({ version: 1, mode: "business", timezone: timeZone, holidays: hours.holidays, dateOverrides: {},
    weeklyHours: Object.fromEntries(calendar.days.map((day) => [SLA_DAY_KEYS[(WEEK_DAYS as readonly string[]).indexOf(day)], window])) }, "business");
  const warning = wanted.warningMinutes ?? Math.floor((wanted.minutes * 3) / 4);
  const leads = ctx.get(CrmLeadsService);
  const policies = await leads.listSlaPolicies(ctx.actor, ctx.workspace.id) as SlaPolicy[];
  const active = policies.find((policy) => policy.eventType === "first_response" && policy.status === "active");
  if (!active) {
    await step.change([{ label: "first-response policy", detail: `added: ${wanted.minutes} working minutes (warning at ${warning})` }], async () =>
      leads.createSlaPolicy(ctx.actor, ctx.workspace.id, await ctx.validated(CreateSlaPolicyDto, {
        name: "First response", eventType: "first_response", warningAfterMinutes: warning, breachAfterMinutes: wanted.minutes, calculationMode: "business", schedule })));
    return;
  }
  const changes: Change[] = [];
  if (active.breachAfterMinutes !== wanted.minutes) changes.push(diff("first-response minutes", active.breachAfterMinutes, wanted.minutes));
  if (active.warningAfterMinutes !== warning) changes.push(diff("first-response warning minutes", active.warningAfterMinutes, warning));
  let stored: unknown = null;
  try { stored = normalizeSlaSchedule(active.schedule, active.calculationMode); } catch { stored = null; }
  if (active.calculationMode !== "business" || stable(stored) !== stable(schedule)) changes.push({ label: "first-response working hours", detail: "counted in the hours above" });
  if (!changes.length) { step.same("first-response policy", `${wanted.minutes} working minutes`); return; }
  await step.change(changes, async () => {
    const fresh = (await leads.listSlaPolicies(ctx.actor, ctx.workspace.id) as SlaPolicy[]).find((policy) => policy.id === active.id)!;
    return leads.updateSlaPolicy(ctx.actor, ctx.workspace.id, active.id, await ctx.validated(UpdateSlaPolicyDto, {
      version: fresh.version, warningAfterMinutes: warning, breachAfterMinutes: wanted.minutes, calculationMode: "business", schedule }));
  });
};

// ---------- finance requests ----------

type PaymentMethod = { id: string; label: string; refundGuidance: string; needsBankDetails: boolean; refundDays: number | null; version: number };
type FinanceSettings = { settings: { financeInbox: string | null; stageInvoiceRequests: boolean; version: number }; methods: PaymentMethod[]; canManage: boolean };

const financeRequests: Section = async (ctx, profile, step) => {
  const wanted = profile.financeRequests!;
  const service = ctx.get(FinanceRequestsService);
  const current = await service.settings(ctx.actor, ctx.workspace.id) as FinanceSettings;
  const changes: Change[] = [];
  const inbox = wanted.inbox === undefined ? current.settings.financeInbox : wanted.inbox;
  const stage = wanted.autoStageInvoiceRequests === undefined ? current.settings.stageInvoiceRequests : wanted.autoStageInvoiceRequests;
  if (wanted.inbox !== undefined) {
    if (lower(current.settings.financeInbox) === lower(inbox)) step.same("finance inbox", shown(inbox));
    else changes.push(diff("finance inbox", current.settings.financeInbox, inbox));
  }
  if (wanted.autoStageInvoiceRequests !== undefined) {
    if (current.settings.stageInvoiceRequests === stage) step.same("automatic stage invoice requests", String(stage));
    else changes.push(diff("automatic stage invoice requests", current.settings.stageInvoiceRequests, stage));
  }
  // Saving these settings writes both: what the profile leaves out is sent as it is now.
  if (changes.length) await step.change(changes, async () => {
    const fresh = await service.settings(ctx.actor, ctx.workspace.id) as FinanceSettings;
    return service.saveSettings(ctx.actor, ctx.workspace.id, { action: "save_settings", version: fresh.settings.version,
      financeInbox: wanted.inbox === undefined ? fresh.settings.financeInbox : inbox, stageInvoiceRequests: wanted.autoStageInvoiceRequests === undefined ? fresh.settings.stageInvoiceRequests : stage });
  });
  for (const method of wanted.paymentMethods ?? []) {
    const found = current.methods.find((entry) => lower(entry.label) === lower(method.name));
    const next = {
      refundGuidance: method.guidance ?? found?.refundGuidance ?? "",
      needsBankDetails: method.needsBankDetails ?? found?.needsBankDetails ?? false,
      refundDays: method.refundDays === undefined ? found?.refundDays ?? null : method.refundDays,
    };
    if (!found) {
      await step.change([{ label: `payment method ${method.name}`, detail: `added (refund days ${shown(next.refundDays)})` }], () => service.saveSettings(ctx.actor, ctx.workspace.id,
        { action: "save_method", id: randomUUID(), label: method.name, ...next }));
      continue;
    }
    const methodChanges: Change[] = [];
    if (found.refundDays !== next.refundDays) methodChanges.push(diff(`payment method ${method.name} refund days`, found.refundDays, next.refundDays));
    if (found.refundGuidance !== next.refundGuidance) methodChanges.push({ label: `payment method ${method.name} guidance`, detail: "changed" });
    if (found.needsBankDetails !== next.needsBankDetails) methodChanges.push(diff(`payment method ${method.name} needs bank details`, found.needsBankDetails, next.needsBankDetails));
    if (!methodChanges.length) { step.same(`payment method ${method.name}`); continue; }
    await step.change(methodChanges, async () => {
      const fresh = (await service.settings(ctx.actor, ctx.workspace.id) as FinanceSettings).methods.find((entry) => entry.id === found.id)!;
      return service.saveSettings(ctx.actor, ctx.workspace.id, { action: "save_method", id: found.id, version: fresh.version, label: fresh.label, ...next });
    });
  }
};

// ---------- approvals ----------

type PolicyStep = { approverKind: "permission" | "role" | "person"; permissionCode: string | null; roleCode: string | null; userId: string | null; label: string | null };
type Policy = { id: string; kind: string; name: string; status: string; isDefault: boolean; version: number; currency: string | null; minAmount: string | null; ownerAboveAmount: string | null;
  escalateAfterHours: number | null; waiverAllowed: boolean; resetTolerancePercent: string | null; steps: PolicyStep[] };
const sendStep = (entry: PolicyStep) => ({ approverKind: entry.approverKind,
  ...(entry.approverKind === "permission" ? { permissionCode: entry.permissionCode } : entry.approverKind === "role" ? { roleCode: entry.roleCode } : { userId: entry.userId }),
  ...(entry.label ? { label: entry.label } : {}) });
const policyBody = (policy: Policy, changes: Partial<Policy>) => {
  const next = { ...policy, ...changes };
  return { version: policy.version, name: next.name, currency: next.currency, minAmount: next.minAmount, ownerAboveAmount: next.ownerAboveAmount, escalateAfterHours: next.escalateAfterHours,
    waiverAllowed: next.waiverAllowed, resetTolerancePercent: next.resetTolerancePercent ?? "0", steps: next.steps.map(sendStep) };
};
const sameAmount = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Number(a) === Number(b));

const approvals: Section = async (ctx, profile, step) => {
  const wanted = profile.approvals!.payableRequest;
  if (!wanted) return;
  const service = ctx.get(ApprovalPoliciesService);
  const listed = await service.list(ctx.actor, ctx.workspace.id) as { policies: Policy[]; roles: Array<{ code: string; name: string }> };
  const role = (written: string) => {
    const byCode = listed.roles.find((entry) => lower(entry.code) === lower(written));
    if (byCode) return byCode;
    const byName = listed.roles.filter((entry) => lower(entry.name) === lower(written));
    return byName.length === 1 ? byName[0] : null;
  };
  const first = role(wanted.firstApproverRole);
  if (!first) { step.missing(`payable request first approver ${wanted.firstApproverRole}`, "no role with this code or name"); return; }
  const firstStep: PolicyStep = { approverKind: "role", roleCode: first.code, permissionCode: null, userId: null, label: null };
  const fresh = async (id: string) => ((await service.list(ctx.actor, ctx.workspace.id)) as { policies: Policy[] }).policies.find((policy) => policy.id === id)!;
  const payable = listed.policies.filter((policy) => policy.kind === "payable_request" && policy.status === "active");
  const base = payable.find((policy) => policy.isDefault);
  if (!base) { step.missing("payable request policy", "Settings › Approvals has no default payable request policy"); return; }
  const isFirst = (entry: PolicyStep | undefined) => entry?.approverKind === "role" && entry.roleCode === first.code;
  const second = wanted.secondApproverRole ? role(wanted.secondApproverRole) : null;
  if (wanted.secondApproverRole && !second) step.missing(`payable request second approver ${wanted.secondApproverRole}`, "no role with this code or name");
  const ownerSecond = second?.code === OWNER_ROLE;
  const currency = wanted.thresholdAmount ? await ctx.read(async (client) => (await client.query<{ currency: string | null }>(
    `SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [ctx.workspace.id])).rows[0]?.currency ?? null) : null;

  // The default policy: Finance (or the role named) approves first; an Owner second step above an amount is the policy's own option.
  const baseChanges: Change[] = [];
  const update: Partial<Policy> = {};
  if (!isFirst(base.steps[0])) {
    baseChanges.push({ label: "payable request first approver", detail: `${base.steps[0]?.roleCode ?? base.steps[0]?.permissionCode ?? "(none)"} → ${first.code}` });
    update.steps = [firstStep, ...base.steps.slice(1).filter((entry) => !isFirst(entry))];
  } else step.same("payable request first approver", first.code);
  if (ownerSecond && wanted.thresholdAmount) {
    if (sameAmount(base.ownerAboveAmount, wanted.thresholdAmount) && base.currency === (base.currency ?? currency)) step.same("payable request owner approval above", wanted.thresholdAmount);
    else { baseChanges.push(diff("payable request owner approval above", base.ownerAboveAmount, wanted.thresholdAmount)); update.ownerAboveAmount = wanted.thresholdAmount; update.currency = base.currency ?? currency; }
  }
  if (baseChanges.length) await step.change(baseChanges, async () => {
    const now = await fresh(base.id);
    return service.update(ctx.actor, ctx.workspace.id, base.id, policyBody(now, { ...update, steps: update.steps ?? now.steps }));
  });
  if (!second || ownerSecond || !wanted.thresholdAmount) {
    if (!wanted.secondApproverRole) step.info("payable request second approver", "none (the profile leaves it out)");
    return;
  }
  // Any other second approver: a payable request policy from the threshold up, with both approvers (the most specific policy wins).
  if (!currency) { step.missing("payable request second approver", "the workspace has no default currency for the threshold"); return; }
  const secondStep: PolicyStep = { approverKind: "role", roleCode: second.code, permissionCode: null, userId: null, label: null };
  const above = payable.find((policy) => !policy.isDefault && policy.currency === currency && sameAmount(policy.minAmount, wanted.thresholdAmount!));
  const label = `payable request second approver above ${wanted.thresholdAmount} ${currency}`;
  if (!above) {
    await step.change([{ label, detail: `added: ${first.code}, then ${second.code}` }], () => service.create(ctx.actor, ctx.workspace.id, {
      kind: "payable_request", name: `Payable request above ${wanted.thresholdAmount}`, currency, minAmount: wanted.thresholdAmount, ownerAboveAmount: null,
      escalateAfterHours: null, waiverAllowed: false, resetTolerancePercent: "0", steps: [firstStep, secondStep].map(sendStep) }));
  } else if (above.steps.length === 2 && isFirst(above.steps[0]) && above.steps[1].approverKind === "role" && above.steps[1].roleCode === second.code) step.same(label);
  else await step.change([{ label, detail: `approvers → ${first.code}, then ${second.code}` }], async () =>
    service.update(ctx.actor, ctx.workspace.id, above.id, policyBody(await fresh(above.id), { steps: [firstStep, secondStep] })));
};

// ---------- project routes ----------

type Template = { id: string; name: string; isDefault: boolean; version: number; stages: TemplateStage[] };
const sameCheck = (check: StageCheck, spec: CheckSpec) => check.kind === spec.kind
  && (spec.kind !== "confirm" || lower(check.label) === lower(spec.label)) && (spec.kind !== "role_assigned" || check.role === spec.role);
const checkLabel = (spec: CheckSpec) => spec.kind === "confirm" ? `confirm "${spec.label}"` : spec.kind === "role_assigned" ? `role_assigned ${spec.role}` : spec.kind;

/**
 * Where a new check goes in a stage: a drawing-line check (PLM-149) before the first check that comes after it in the
 * line, or after the last one before it; any other check at the end.
 */
function insertAt(checks: StageCheck[], kind: StageCheck["kind"]) {
  const rank = DRAWING_CHECKS.indexOf(kind);
  if (rank < 0) return checks.length;
  const later = checks.findIndex((check) => DRAWING_CHECKS.indexOf(check.kind) > rank);
  if (later >= 0) return later;
  const earlier = checks.map((check) => DRAWING_CHECKS.indexOf(check.kind)).reduce((last, value, index) => (value >= 0 && value < rank ? index : last), -1);
  return earlier >= 0 ? earlier + 1 : checks.length;
}

/** The route with the profile's checks taken off and its stages and checks added; and what that changes. */
export function planRoute(template: Template, change: RouteChange, roles: string[]) {
  const stages: TemplateStage[] = template.stages.map((stage) => ({ ...stage, checks: [...stage.checks] }));
  const changes: Change[] = [], same: Change[] = [], missing: Change[] = [];
  const find = (name: string) => stages.find((stage) => lower(stage.name) === lower(name) || stage.key === lower(name));
  for (const target of change.removeChecks ?? []) {
    const stage = find(target.stage);
    if (!stage) { missing.push({ label: `${template.name} › ${target.stage}`, detail: "no stage with this name" }); continue; }
    for (const spec of target.checks) {
      const label = `${template.name} › ${stage.name}: ${checkLabel(spec)}`;
      const before = stage.checks.length;
      stage.checks = stage.checks.filter((check) => !sameCheck(check, spec));
      if (stage.checks.length === before) same.push({ label, detail: "not there" });
      else changes.push({ label, detail: "check removed" });
    }
  }
  const addChecks = (stage: TemplateStage, specs: CheckSpec[]) => {
    for (const spec of specs) {
      const label = `${template.name} › ${stage.name}: ${checkLabel(spec)}`;
      if (stage.checks.some((check) => sameCheck(check, spec))) { same.push({ label }); continue; }
      stage.checks.splice(insertAt(stage.checks, spec.kind), 0, { kind: spec.kind, ...(spec.label ? { label: spec.label } : {}), ...(spec.role ? { role: spec.role } : {}) } as StageCheck);
      changes.push({ label, detail: "check added" });
    }
  };
  for (const added of change.addStages) {
    const existing = find(added.name) ?? (added.key ? stages.find((stage) => stage.key === added.key) : undefined);
    if (existing) { same.push({ label: `${template.name} › ${existing.name}`, detail: "stage there" }); addChecks(existing, added.checks); continue; }
    const anchorName = added.before ?? added.after!;
    const anchor = find(anchorName);
    if (!anchor) { missing.push({ label: `${template.name} › ${added.name}`, detail: `no stage "${anchorName}" to put it ${added.before ? "before" : "after"}` }); continue; }
    if (added.ownerRole && !roles.includes(added.ownerRole)) { missing.push({ label: `${template.name} › ${added.name}`, detail: `no project role "${added.ownerRole}"` }); continue; }
    const stage: TemplateStage = { key: added.key ?? "", name: added.name, ownerRole: added.ownerRole ?? null, checks: [] };
    stages.splice(stages.indexOf(anchor) + (added.before ? 0 : 1), 0, stage);
    changes.push({ label: `${template.name} › ${added.name}`, detail: `stage added ${added.before ? "before" : "after"} ${anchor.name}` });
    addChecks(stage, added.checks);
  }
  for (const target of change.addChecks) {
    const stage = find(target.stage);
    if (!stage) { missing.push({ label: `${template.name} › ${target.stage}`, detail: "no stage with this name" }); continue; }
    addChecks(stage, target.checks);
  }
  return { stages, changes, same, missing };
}

const routes: Section = async (ctx, profile, step) => {
  const service = ctx.get(ProjectCoreService);
  const read = async () => await service.settings(ctx.actor, ctx.workspace.id) as { settings: { roles: Array<{ key: string }> }; templates: Template[] };
  const current = await read();
  const roles = current.settings.roles.map((role) => role.key);
  for (const change of profile.routes!) {
    const pick = (templates: Template[]) => change.isDefault && !change.route ? templates.find((template) => template.isDefault)
      : templates.find((template) => lower(template.name) === lower(change.route));
    const template = pick(current.templates);
    if (!template) { step.missing(`route ${change.route ?? "(default)"}`, "no active route with this name"); continue; }
    const plan = planRoute(template, change, roles);
    for (const entry of plan.same) step.same(entry.label, entry.detail);
    for (const entry of plan.missing) step.missing(entry.label, entry.detail ?? "");
    if (!plan.changes.length) continue;
    await step.change(plan.changes, async () => {
      // Saved whole, as Settings saves a route: on its current version, with the same additions.
      const now = pick((await read()).templates)!;
      const again = planRoute(now, change, roles);
      return service.saveTemplate(ctx.actor, ctx.workspace.id, { id: now.id, version: now.version, name: now.name, isDefault: now.isDefault, stages: again.stages });
    });
  }
};

// ---------- role permissions ----------

type Role = { id: string; code: string; name: string; isSystem: boolean; version: number; permissions: string[] };

const rolePermissions: Section = async (ctx, profile, step) => {
  const service = ctx.get(WorkspacesService);
  const roles = await service.listRoles(ctx.actor, ctx.workspace.id) as Role[];
  for (const grant of profile.rolePermissions!) {
    for (const written of grant.roles) {
      const role = roles.find((entry) => lower(entry.code) === lower(written)) ?? roles.find((entry) => lower(entry.name) === lower(written));
      if (!role) { step.missing(`role ${written}`, "no role with this code or name"); continue; }
      const missing = grant.permissions.filter((code) => !role.permissions.includes(code));
      if (!missing.length) { step.same(`role ${role.code}`, `holds ${grant.permissions.join(", ")}`); continue; }
      if (role.isSystem) { step.manual(`role ${role.code}`, `a system role; it gets ${missing.join(", ")} with the product (migrations), not from Settings`); continue; }
      await step.change([{ label: `role ${role.code}`, detail: `granted ${missing.join(", ")}` }], async () => {
        const now = (await service.listRoles(ctx.actor, ctx.workspace.id) as Role[]).find((entry) => entry.id === role.id)!;
        const codes = [...new Set([...now.permissions, ...grant.permissions])];
        return service.updateRole(ctx.actor, ctx.workspace.id, role.id, await ctx.validated(UpdateRoleDto, { version: now.version, permissionCodes: codes }));
      });
    }
  }
};

// ---------- design ----------

type DesignPackage = { id: string; code: string; name: string; pricingMethod: "per_space" | "per_area" | "fixed"; rate: string; currency: string; areaUnit: "sqft" | "sqm" | null;
  includedRevisions: number; includesSpacePlanning: boolean; includesRenders: boolean; requiredRoleCode: string | null; inclusions: string | null; position: number; status: string; version: number;
  reviewRoleCode?: string | null; rateFrom?: boolean; unitDefinition?: string | null };
type DesignSteps = Record<DesignStepKey, number> & { conceptOptionsMax: number | null };
type DesignTeam = Record<DesignTeamKey, string | null>;
type DesignFlow = { designInternalDays: number; designClientDays: number; materialSelectionDays: number; estimateDays: number; visualiserRoleCode: string;
  showroomBookingTypeId: string | null; siteVisitQuestions: Array<{ key: string; question: string; scope?: string | null }>; renderInternalDays: number | null; renderClientDays: number | null;
  steps: DesignSteps; team: DesignTeam };
type DesignSettings = { version: number; packages: DesignPackage[]; flow: DesignFlow };

const design: Section = async (ctx, profile, step) => {
  const wanted = profile.design!;
  const service = ctx.get(DesignPackagesService);
  // The team roles first: the design team's parts name them (PLM-151).
  if (wanted.projectRoles?.length) {
    const projects = ctx.get(ProjectCoreService);
    const { settings } = await projects.settings(ctx.actor, ctx.workspace.id) as { settings: { version: number; roles: Array<{ key: string; label: string }> } };
    const roleChanges: Change[] = [];
    const roles = settings.roles.map((role) => ({ ...role }));
    for (const desired of wanted.projectRoles) {
      const found = roles.find((role) => role.key === desired.key);
      if (!found) { roles.push({ ...desired }); roleChanges.push({ label: `project role ${desired.key}`, detail: `added as ${desired.label}` }); }
      else if (found.label !== desired.label) { roleChanges.push(diff(`project role ${desired.key}`, found.label, desired.label)); found.label = desired.label; }
      else step.same(`project role ${desired.key}`, desired.label);
    }
    if (roleChanges.length) await step.change(roleChanges, async () => {
      const fresh = (await projects.settings(ctx.actor, ctx.workspace.id) as { settings: { version: number; roles: Array<{ key: string; label: string }> } }).settings;
      const next = fresh.roles.map((role) => ({ ...role, label: wanted.projectRoles!.find((entry) => entry.key === role.key)?.label ?? role.label }));
      for (const desired of wanted.projectRoles!) if (!next.some((role) => role.key === desired.key)) next.push({ ...desired });
      return projects.saveSettings(ctx.actor, ctx.workspace.id, { version: fresh.version, roles: next });
    });
  }
  const current = await service.get(ctx.actor, ctx.workspace.id) as DesignSettings;
  const changes: Change[] = [];
  const flowPatch: Partial<DesignFlow> = {};
  for (const [key, label] of [["renderInternalDays", "render stage internal days"], ["renderClientDays", "render stage client days"]] as const) {
    if (wanted[key] === undefined) continue;
    if ((current.flow[key] ?? null) === wanted[key]) step.same(label, shown(wanted[key]));
    else { flowPatch[key] = wanted[key]; changes.push(diff(label, current.flow[key], wanted[key])); }
  }
  // PLM-140–144: the days of the design steps; PLM-151: the design team's roles.
  if (wanted.steps) {
    const steps = { ...current.flow.steps };
    for (const [key, value] of Object.entries(wanted.steps) as Array<[keyof DesignSteps, number | null]>) {
      if (value === undefined) continue;
      if ((steps[key] ?? null) === value) step.same(`design step ${key}`, shown(value));
      else { changes.push(diff(`design step ${key}`, steps[key], value)); (steps as Record<string, number | null>)[key] = value; }
    }
    flowPatch.steps = steps;
  }
  if (wanted.team) {
    const team = { ...current.flow.team };
    for (const [key, value] of Object.entries(wanted.team) as Array<[DesignTeamKey, string | null]>) {
      if (value === undefined) continue;
      if ((team[key] ?? null) === value) step.same(`design team ${key}`, shown(value));
      else { changes.push(diff(`design team ${key}`, team[key], value)); team[key] = value; }
    }
    flowPatch.team = team;
  }
  // The design flow settings are saved whole: everything else goes back as it is.
  if (changes.length) await step.change(changes, async () => {
    const fresh = await service.get(ctx.actor, ctx.workspace.id) as DesignSettings;
    const flow = fresh.flow;
    return service.saveFlowSettings(ctx.actor, ctx.workspace.id, { version: fresh.version, designInternalDays: flow.designInternalDays, designClientDays: flow.designClientDays,
      materialSelectionDays: flow.materialSelectionDays, estimateDays: flow.estimateDays, visualiserRoleCode: flow.visualiserRoleCode, showroomBookingTypeId: flow.showroomBookingTypeId,
      siteVisitQuestions: flow.siteVisitQuestions, renderInternalDays: flow.renderInternalDays ?? null, renderClientDays: flow.renderClientDays ?? null, ...flowPatch } as never);
  });
  if (wanted.revisionsIncluded === undefined) return;
  const packages = current.packages.filter((entry) => entry.status === "active" && (!wanted.packages || wanted.packages.some((code) => lower(code) === lower(entry.code))));
  for (const code of wanted.packages ?? []) if (!current.packages.some((entry) => lower(entry.code) === lower(code))) step.missing(`design package ${code}`, "no package with this code");
  if (!packages.length && !wanted.packages) step.info("revisions included", "the workspace has no active design packages yet");
  for (const entry of packages) {
    if (entry.includedRevisions === wanted.revisionsIncluded) { step.same(`design package ${entry.code} revisions included`, String(entry.includedRevisions)); continue; }
    await step.change([diff(`design package ${entry.code} revisions included`, entry.includedRevisions, wanted.revisionsIncluded)], async () => {
      const now = (await service.get(ctx.actor, ctx.workspace.id) as DesignSettings).packages.find((candidate) => candidate.id === entry.id)!;
      // A package is saved whole.
      return service.savePackage(ctx.actor, ctx.workspace.id, { id: now.id, version: now.version, code: now.code, name: now.name, pricingMethod: now.pricingMethod, rate: now.rate,
        currency: now.currency, areaUnit: now.areaUnit, includedRevisions: wanted.revisionsIncluded, includesSpacePlanning: now.includesSpacePlanning, includesRenders: now.includesRenders,
        requiredRoleCode: now.requiredRoleCode, inclusions: now.inclusions, position: now.position, reviewRoleCode: now.reviewRoleCode ?? null, rateFrom: Boolean(now.rateFrom),
        unitDefinition: now.unitDefinition ?? null });
    });
  }
};

// ---------- order paths ----------

type Rule = { furniturePath: string | null; boqRequired: boolean | null; reserveOn: string; deductOn: string; leadMinDays: number | null; leadMaxDays: number | null; leadFrom: string;
  leadFromCatalogue: boolean; takeFromLocationId: string | null; version: number };
type Flow = { id: string; name: string; enquiryTypes: string[]; rules: Rule[] };
type Rules = { flows: Flow[]; places: Array<{ id: string; name: string }> };
const EMPTY_RULE: Omit<Rule, "furniturePath" | "version"> = { boqRequired: null, reserveOn: "none", deductOn: "none", leadMinDays: null, leadMaxDays: null, leadFrom: "won",
  leadFromCatalogue: false, takeFromLocationId: null };
const ruleBody = ({ version: _version, ...rule }: Rule) => rule;

/** One enquiry type's rules with the profile's fields set (only those given); and what that changes. */
function planFlow(flow: Flow, changes: NonNullable<Profile["orderPaths"]>, places: Rules["places"]) {
  const rules: Rule[] = flow.rules.map((rule) => ({ ...rule }));
  const changed: Change[] = [], same: Change[] = [], missing: Change[] = [];
  for (const wanted of changes) {
    const label = `${flow.name} › ${wanted.path ?? "whole type"}`;
    let rule = rules.find((entry) => entry.furniturePath === wanted.path);
    const fresh = !rule;
    rule ??= { furniturePath: wanted.path, version: 0, ...EMPTY_RULE };
    const before = { ...rule };
    if (wanted.boqRequired !== undefined) rule.boqRequired = wanted.boqRequired;
    if (wanted.reserveOn !== undefined) rule.reserveOn = wanted.reserveOn;
    if (wanted.deductOn !== undefined) rule.deductOn = wanted.deductOn;
    if (wanted.leadFrom !== undefined) rule.leadFrom = wanted.leadFrom;
    if (wanted.leadDays !== undefined) { rule.leadMinDays = wanted.leadDays?.min ?? null; rule.leadMaxDays = wanted.leadDays?.max ?? null; }
    if (wanted.takeFrom !== undefined) {
      const place = wanted.takeFrom === null ? null : places.find((entry) => lower(entry.name) === lower(wanted.takeFrom));
      if (wanted.takeFrom !== null && !place) { missing.push({ label, detail: `no place "${wanted.takeFrom}" to take stock from` }); Object.assign(rule, before); continue; }
      rule.takeFromLocationId = place?.id ?? null;
    }
    const fields = (["boqRequired", "reserveOn", "deductOn", "leadFrom", "leadMinDays", "leadMaxDays", "takeFromLocationId"] as const).filter((key) => before[key] !== rule![key]);
    if (!fields.length && !fresh) { same.push({ label }); continue; }
    if (fresh) rules.push(rule);
    changed.push({ label, detail: fields.length ? fields.map((key) => key === "takeFromLocationId" ? "take-from place" : `${key} ${shown(before[key])} → ${shown(rule![key])}`).join(", ") : "rule added" });
  }
  return { rules, changed, same, missing };
}

const orderPaths: Section = async (ctx, profile, step) => {
  const service = ctx.get(FulfilmentService);
  const read = async () => await service.rules(ctx.actor, ctx.workspace.id) as Rules;
  const current = await read();
  // An enquiry type by its code, its label, or its flow's name.
  const settings = await ctx.get(CrmSettingsService).list(ctx.actor, ctx.workspace.id) as { taxonomies: Array<{ code: string; options: Array<{ code: string; label: string }> }> };
  const labels = new Map((settings.taxonomies.find((taxonomy) => taxonomy.code === "enquiry_type")?.options ?? []).map((option) => [lower(option.code), lower(option.label)]));
  const flowOf = (flows: Flow[], written: string) => {
    const label = labels.get(lower(written)) ?? lower(written);
    return flows.find((flow) => lower(flow.name) === lower(written) || flow.enquiryTypes.some((type) => lower(type) === label));
  };
  const byFlow = new Map<string, NonNullable<Profile["orderPaths"]>>();
  for (const wanted of profile.orderPaths!) {
    const flow = flowOf(current.flows, wanted.enquiryType);
    if (!flow) { step.missing(`order path ${wanted.enquiryType}`, "no enquiry type flow with this name or code"); continue; }
    byFlow.set(flow.id, [...(byFlow.get(flow.id) ?? []), wanted]);
  }
  for (const [flowId, wanted] of byFlow) {
    const flow = current.flows.find((entry) => entry.id === flowId)!;
    const plan = planFlow(flow, wanted, current.places);
    for (const entry of plan.same) step.same(entry.label);
    for (const entry of plan.missing) step.missing(entry.label, entry.detail ?? "");
    if (!plan.changed.length) continue;
    // An enquiry type's rules are saved whole, on the versions just read.
    await step.change(plan.changed, async () => {
      const now = await read();
      const fresh = now.flows.find((entry) => entry.id === flowId)!;
      const again = planFlow(fresh, wanted, now.places);
      return service.saveRules(ctx.actor, ctx.workspace.id, flowId, { rules: again.rules.map(ruleBody), versions: fresh.rules.map((rule) => `${rule.furniturePath ?? ""}:${rule.version}`) });
    });
  }
};

// ---------- project settings ----------

type ProjectSettingsView = { settings: { version: number; roles: Array<{ key: string; label: string }>; drawingsClientRole: string | null; technicalMeasureDays: number | null } };

/** PLM-149: who talks to the client about drawings, and when the technical measure is due, through Settings › Projects. */
const projects: Section = async (ctx, profile, step) => {
  const wanted = profile.projects!;
  const service = ctx.get(ProjectCoreService);
  const current = (await service.settings(ctx.actor, ctx.workspace.id) as ProjectSettingsView).settings;
  const patch: Record<string, unknown> = {};
  const changes: Change[] = [];
  if (wanted.drawingsClientRole !== undefined) {
    const label = "drawings go to the client through";
    if (wanted.drawingsClientRole !== null && !current.roles.some((role) => role.key === wanted.drawingsClientRole))
      step.missing(label, `no project role "${wanted.drawingsClientRole}"`);
    else if (current.drawingsClientRole === wanted.drawingsClientRole) step.same(label, shown(wanted.drawingsClientRole));
    else { patch.drawingsClientRole = wanted.drawingsClientRole; changes.push(diff(label, current.drawingsClientRole, wanted.drawingsClientRole)); }
  }
  if (wanted.technicalMeasureDays !== undefined) {
    const label = "technical measure due in working days";
    if (current.technicalMeasureDays === wanted.technicalMeasureDays) step.same(label, shown(wanted.technicalMeasureDays));
    else { patch.technicalMeasureDays = wanted.technicalMeasureDays; changes.push(diff(label, current.technicalMeasureDays, wanted.technicalMeasureDays)); }
  }
  if (changes.length) await step.change(changes, async () => {
    const fresh = (await service.settings(ctx.actor, ctx.workspace.id) as ProjectSettingsView).settings;
    return service.saveSettings(ctx.actor, ctx.workspace.id, { version: fresh.version, ...patch });
  });
};

// ---------- client updates ----------

const clientUpdates: Section = async (_ctx, profile, step) => {
  const wanted = profile.clientUpdates!;
  // Every case starts its client updates weekly, by call, from design approval; each case can change it. There is no workspace default to set.
  if (wanted.mode === "call" && wanted.frequency === "weekly") step.same("client updates", "weekly by call (the product's default from design approval)");
  else step.manual("client updates", `no workspace default; ${wanted.frequency} by ${wanted.mode} is set per case (Pre-project › Client updates)`);
};

// ---------- catalogue categories ----------

type Category = { id: string; name: string; parentId: string | null; version: number; itemCount: number };
type Working = Category & { direct: number; gone: boolean };

/**
 * One catalogue's category clean-up through the catalogue's own category commands. A dry run plays each step on a
 * copy of the tree, so later steps see what earlier ones would do (a renamed category is found by its new name).
 */
const catalogCategories: Section = async (ctx, profile, step) => {
  const service = ctx.get(CatalogV2Service);
  const catalogs = await service.listCatalogs(ctx.actor, ctx.workspace.id) as Array<{ id: string; name: string }>;
  for (const wanted of profile.catalogCategories!) {
    const catalog = catalogs.find((entry) => lower(entry.name) === lower(wanted.catalog));
    if (!catalog) { step.missing(`catalogue ${wanted.catalog}`, "no active catalogue with this name"); continue; }
    const read = async () => (await service.structure(ctx.actor, ctx.workspace.id, catalog.id) as { categories: Category[] }).categories;
    const version = async (id: string) => (await read()).find((entry) => entry.id === id)?.version ?? 0;
    const initial = await read();
    // Items directly in each category (the structure counts each with everything below it).
    const tree: Working[] = initial.map((entry) => ({ ...entry, gone: false,
      direct: entry.itemCount - initial.filter((child) => child.parentId === entry.id).reduce((sum, child) => sum + child.itemCount, 0) }));
    const live = () => tree.filter((entry) => !entry.gone);
    const children = (id: string) => live().filter((entry) => entry.parentId === id);
    const total = (entry: Working): number => entry.direct + children(entry.id).reduce((sum, child) => sum + total(child), 0);
    const below = (id: string): string[] => children(id).flatMap((child) => [child.id, ...below(child.id)]);
    // A category by its exact name, else ignoring case, else however it's written; two equally close are ambiguous.
    const find = (name: string): Working | "ambiguous" | null => {
      for (const same of [(entry: Working) => entry.name === name.trim(), (entry: Working) => lower(entry.name) === lower(name), (entry: Working) => categoryKey(entry.name) === categoryKey(name)]) {
        const found = live().filter(same);
        if (found.length > 1) return "ambiguous";
        if (found.length === 1) return found[0];
      }
      return null;
    };
    const label = (text: string) => `${catalog.name} › ${text}`;
    const resolve = (name: string, what: string) => {
      const found = find(name);
      if (found === "ambiguous") { step.missing(label(`${what} ${name}`), "several categories have this name"); return null; }
      return found;
    };

    for (const pair of wanted.merge) {
      const into = resolve(pair.into, "merge into");
      if (into === null) { if (find(pair.into) === null) step.missing(label(`merge ${pair.from}`), `no category ${pair.into} to merge into`); continue; }
      const from = resolve(pair.from, "merge");
      if (from === null && find(pair.from) === "ambiguous") continue;
      if (!from || from.id === into.id) { step.same(label(`merge ${pair.from}`), `one category: ${into.name}`); continue; }
      if (below(from.id).includes(into.id)) { step.missing(label(`merge ${pair.from}`), `${into.name} is inside ${from.name}; move it out first`); continue; }
      await step.change([{ label: label(`merge ${from.name}`), detail: `${from.name} (${total(from)} items) → ${into.name}` }], async () =>
        service.mergeCategory(ctx.actor, ctx.workspace.id, catalog.id, from.id, { version: await version(from.id), intoId: into.id }));
      into.direct += from.direct;
      for (const child of children(from.id)) child.parentId = into.id;
      from.gone = true;
    }

    const remove = async (entry: Working, detail: string) => {
      await step.change([{ label: label(`delete ${entry.name}`), detail }], async () => service.deleteCategory(ctx.actor, ctx.workspace.id, catalog.id, entry.id, await version(entry.id)));
      entry.gone = true;
    };
    for (const name of wanted.deleteEmpty) {
      const entry = resolve(name, "delete");
      if (entry === null) { if (find(name) === null) step.same(label(`delete ${name}`), "no such category"); continue; }
      if (total(entry) || children(entry.id).length) { step.info(label(`delete ${entry.name}`), `kept: it has ${total(entry)} items and ${children(entry.id).length} sub-categories`); continue; }
      await remove(entry, "empty");
    }
    if (wanted.deleteEmptyDuplicates) {
      let removed = 0;
      for (const entry of live()) {
        if (total(entry) || children(entry.id).length) continue;
        const populated = live().find((other) => other.id !== entry.id && categoryKey(other.name) === categoryKey(entry.name) && total(other) > 0);
        if (!populated) continue;
        await remove(entry, `empty; ${populated.name} has the items`);
        removed++;
      }
      if (!removed) step.same(label("empty duplicate categories"), "none");
    }

    for (const pair of wanted.rename) {
      const entry = resolve(pair.from, "rename");
      if (entry === null) { if (find(pair.from) === null) step.missing(label(`rename ${pair.from}`), "no such category"); continue; }
      if (entry.name === pair.to) { step.same(label(`rename ${pair.from}`), pair.to); continue; }
      const clash = live().find((other) => other.id !== entry.id && other.parentId === entry.parentId && categoryKey(other.name) === categoryKey(pair.to));
      if (clash) { step.info(label(`rename ${entry.name}`), `kept: ${clash.name} is already beside it; merge the two instead`); continue; }
      await step.change([diff(label(`rename ${entry.name}`), entry.name, pair.to)], async () =>
        service.updateCategory(ctx.actor, ctx.workspace.id, catalog.id, entry.id, { version: await version(entry.id), name: pair.to }));
      entry.name = pair.to;
    }

    for (const pair of wanted.parent) {
      const entry = resolve(pair.category, "parent of");
      if (entry === null) { if (find(pair.category) === null) step.missing(label(`parent of ${pair.category}`), "no such category"); continue; }
      const above = pair.parent === null ? null : resolve(pair.parent, "parent");
      if (pair.parent !== null && above === null) { if (find(pair.parent) === null) step.missing(label(`parent of ${entry.name}`), `no category ${pair.parent}`); continue; }
      const parentId = above?.id ?? null;
      const now = tree.find((other) => other.id === entry.parentId)?.name ?? "(top level)";
      if (entry.parentId === parentId) { step.same(label(`parent of ${entry.name}`), now); continue; }
      if (parentId && (parentId === entry.id || below(entry.id).includes(parentId))) { step.missing(label(`parent of ${entry.name}`), `${above!.name} is inside ${entry.name}`); continue; }
      await step.change([diff(label(`parent of ${entry.name}`), now, above?.name ?? "(top level)")], async () =>
        service.updateCategory(ctx.actor, ctx.workspace.id, catalog.id, entry.id, { version: await version(entry.id), parentId }));
      entry.parentId = parentId;
    }
  }
};

/** The sections in the order they run (routes before factory, so the permit check sees the route). */
export const SECTIONS: Array<[ProfileSection, Section]> = [
  // Design before factory: the design team's project roles (e.g. the Creative Director) exist before the inspections name them.
  ["enquiryTypes", enquiryTypes], ["vehicles", vehicles], ["routes", routes], ["quotations", quotations], ["firstResponse", firstResponse],
  ["financeRequests", financeRequests], ["approvals", approvals], ["rolePermissions", rolePermissions], ["design", design], ["factory", factory], ["orderPaths", orderPaths], ["clientUpdates", clientUpdates],
  ["catalogCategories", catalogCategories], ["projects", projects],
];

export async function runConfigure(ctx: OpsContext, profile: Profile, report: Report) {
  for (const [name, section] of SECTIONS) {
    if (profile[name] === undefined) continue;
    const step: Step = {
      same: (label, detail) => report.add(name, "unchanged", label, detail),
      missing: (label, detail) => report.add(name, "not found", label, detail),
      manual: (label, detail) => report.add(name, "manual", label, `manual in Settings: ${detail}`),
      info: (label, detail) => report.add(name, "info", label, detail),
      async change(changes, run) {
        if (!ctx.apply) { for (const entry of changes) report.add(name, "would change", entry.label, entry.detail); return; }
        await run();
        for (const entry of changes) report.add(name, "changed", entry.label, entry.detail);
      },
    };
    try {
      await section(ctx, profile, step);
    } catch (error) {
      const message = error instanceof HttpException ? `${error.getStatus()} ${error.message}` : (error as Error).message;
      report.add(name, "failed", "section stopped", message.slice(0, 300));
    }
  }
}
