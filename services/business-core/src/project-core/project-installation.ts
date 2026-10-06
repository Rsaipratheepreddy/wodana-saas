import { BadRequestException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { everythingMade } from "../factory/factory";
import { reserveForProduction } from "../fulfilment/stock-reservations";
import { assertPermitFor } from "../logistics/permits";
import { INSTALLATION_CHECKS, type StageCheck } from "./project-checks";
import { readCloseOut } from "./project-closeout";
import { tellKeepInformed } from "./project-keep-informed";
import { noticeProject, workspaceDay } from "./project-notices";

type Db = Pick<PoolClient, "query">;

/**
 * Delivery and installation (PLM-069). The project keeps two days: the delivery booked and the installation
 * scheduled. Everything else is read from the records: what reached the site (moves and deliveries received there),
 * what's still on its way or held elsewhere for the project, what the factory still has to make, and the site work
 * (installed quantities on approved site reports, and the installation signed off when site work finishes).
 */
export const DELIVERY_STATUSES = ["not_booked", "booked", "part_delivered", "delivered"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const INSTALLATION_STATUSES = ["not_started", "in_progress", "done"] as const;
export type InstallationStatus = (typeof INSTALLATION_STATUSES)[number];

/** The role that installs when the route names none: the default installation lead. */
export const INSTALLATION_ROLE = "installation_lead";

export type DeliveryFacts = {
  deliveryOn: string | null; today: string;
  /** Goods reached the project's site (a move or a delivery received there). */
  arrived: boolean;
  /** Something is still to come: on its way to the site, owed by a supplier, held elsewhere for the project, or not made yet. */
  outstanding: boolean;
};

/**
 * Delivered once nothing is still to come and either goods reached the site or the booked delivery day has passed (a
 * project whose goods aren't tracked as stock); part delivered while goods reached the site and more is still to come;
 * booked while a delivery day is set or goods are on their way; otherwise not booked.
 */
export function deliveryStatus(facts: DeliveryFacts & { inTransit: boolean }): DeliveryStatus {
  if (!facts.outstanding && (facts.arrived || (facts.deliveryOn !== null && facts.deliveryOn <= facts.today))) return "delivered";
  if (facts.arrived) return "part_delivered";
  if (facts.deliveryOn || facts.inTransit) return "booked";
  return "not_booked";
}

/** Done once the installation is signed off (site work finished); in progress once site work started or anything was installed. */
export function installationStatus(facts: { siteStartedOn: string | null; siteFinishedOn: string | null; installed: boolean }): InstallationStatus {
  if (facts.siteFinishedOn) return "done";
  if (facts.siteStartedOn || facts.installed) return "in_progress";
  return "not_started";
}

/** The roles that own the stages holding a delivery or installation check (not skipped): the firm's installation team. */
export function installationRoles(stages: Array<{ status: string; ownerRole: string | null; checks: StageCheck[] }>) {
  const roles = stages.filter((stage) => stage.status !== "skipped" && stage.ownerRole && stage.checks.some((check) => INSTALLATION_CHECKS.includes(check.kind)))
    .map((stage) => stage.ownerRole!);
  return [...new Set(roles.length ? roles : [INSTALLATION_ROLE])];
}

export type InstallationView = {
  deliveryOn: string | null; installationOn: string | null; note: string; setByName: string | null; setAt: string | null;
  delivery: DeliveryStatus; installation: InstallationStatus; siteStartedOn: string | null; siteFinishedOn: string | null;
  /** The route holds a delivery or installation check. */
  inRoute: boolean;
  /** Installation is past its day and not done. */
  late: boolean;
};

/** The project's delivery and installation, read from its records. */
export async function readInstallation(db: Db, workspaceId: string, projectId: string): Promise<InstallationView> {
  const row = (await db.query<{ deliveryOn: string | null; installationOn: string | null; note: string; setByName: string | null; setAt: string | null;
    siteStartedOn: string | null; siteFinishedOn: string | null; today: string; inRoute: boolean }>(
    `SELECT project.delivery_on::text AS "deliveryOn", project.installation_on::text AS "installationOn", project.installation_note AS note,
            setter.display_name AS "setByName", project.installation_set_at AS "setAt",
            project.site_started_on::text AS "siteStartedOn", project.site_finished_on::text AS "siteFinishedOn",
            (now() AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS today,
            EXISTS (SELECT 1 FROM project_stages stage, jsonb_array_elements(stage.checks) item
                     WHERE stage.workspace_id = project.workspace_id AND stage.project_id = project.id AND stage.status <> 'skipped'
                       AND item->>'kind' = ANY($3::text[])) AS "inRoute"
       FROM delivery_projects project JOIN workspaces workspace ON workspace.id = project.workspace_id
       LEFT JOIN users setter ON setter.id = project.installation_set_by
      WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId, [...INSTALLATION_CHECKS]])).rows[0];
  if (!row) throw new Error("Project not found.");
  const facts = await readDeliveryFacts(db, workspaceId, projectId);
  const installed = Boolean((await db.query(
    `SELECT 1 FROM site_report_lines line JOIN site_reports report ON report.workspace_id = line.workspace_id AND report.id = line.report_id
      WHERE line.workspace_id = $1 AND report.project_id = $2 AND report.status = 'approved' AND line.installed > 0 LIMIT 1`, [workspaceId, projectId])).rowCount);
  const installation = installationStatus({ siteStartedOn: row.siteStartedOn, siteFinishedOn: row.siteFinishedOn, installed });
  return {
    deliveryOn: row.deliveryOn, installationOn: row.installationOn, note: row.note, setByName: row.setByName, setAt: row.setAt,
    delivery: deliveryStatus({ ...facts, deliveryOn: row.deliveryOn, today: row.today }), installation, siteStartedOn: row.siteStartedOn, siteFinishedOn: row.siteFinishedOn,
    inRoute: row.inRoute, late: Boolean(row.installationOn && row.installationOn < row.today && installation !== "done"),
  };
}

/** What reached the project's site, and what's still to come for it. */
async function readDeliveryFacts(db: Db, workspaceId: string, projectId: string) {
  const arrived = Boolean((await db.query(
    `SELECT 1 FROM stock_movements movement JOIN stock_locations place ON place.workspace_id = movement.workspace_id AND place.id = movement.location_id
      WHERE movement.workspace_id = $1 AND place.project_id = $2 AND movement.kind IN ('receive', 'transfer_in') AND movement.quantity > 0 LIMIT 1`,
    [workspaceId, projectId])).rowCount);
  const inTransit = Boolean((await db.query(
    `SELECT 1 FROM stock_transfers transfer JOIN stock_locations place ON place.workspace_id = transfer.workspace_id AND place.id = transfer.to_location_id
      WHERE transfer.workspace_id = $1 AND place.project_id = $2 AND transfer.status = 'in_transit' LIMIT 1`, [workspaceId, projectId])).rowCount);
  const closeOut = await readCloseOut(db, workspaceId, projectId);
  const outstanding = inTransit || closeOut.moves.length > 0 || closeOut.owedOrders.length > 0 || closeOut.heldStock.length > 0
    || !(await everythingMade(db, workspaceId, projectId));
  return { arrived, inTransit, outstanding };
}

/** The stage-check facts: the installation day set, everything delivered, the installation signed off. */
export async function readInstallationFacts(db: Db, workspaceId: string, projectId: string) {
  const view = await readInstallation(db, workspaceId, projectId);
  return { scheduled: Boolean(view.installationOn), delivered: view.delivery === "delivered", installed: view.installation === "done" };
}

/** Validates the delivery and installation days: the installation day is needed, and delivery comes no later than it. */
export function installationDates(input: { deliveryOn: string | null; installationOn: string | null }) {
  if (!input.installationOn) return "Choose the installation day.";
  if (input.deliveryOn && input.deliveryOn > input.installationOn) return "Delivery can't be after the installation day.";
  return null;
}

export type InstallationDays = { deliveryOn: string | null; installationOn: string | null; note: string };

/**
 * Sets a project's delivery and installation days (PLM-069), from the project or the factory and logistics calendar.
 * The installation day is needed and delivery comes no later (clearing both is the project manager's: `canClear`;
 * from the calendar a delivery may stand alone). A new delivery or installation day on a route that checks the
 * building permit needs a collected permit covering it (PLM-136). A new installation
 * day is told to the installation team and the project manager (`team`), and to the people kept informed. Returns the
 * days before, or null when nothing changed. The caller bumps the project's version and audits.
 */
export async function writeInstallationDays(db: Db, input: {
  workspaceId: string; projectId: string; days: InstallationDays; actorUserId: string; canClear: boolean; team: string[];
  /** The calendar books a delivery on its own (furniture delivered without installation); the project dialog sets both. */
  deliveryAlone?: boolean;
}): Promise<InstallationDays | null> {
  const { workspaceId, projectId } = input;
  const { deliveryOn, installationOn } = input.days;
  const note = input.days.note.trim();
  if (note.length > 500) throw new BadRequestException("Keep the note under 500 characters.");
  if (input.deliveryAlone) {
    if (deliveryOn && installationOn && deliveryOn > installationOn) throw new BadRequestException("Delivery can't be after the installation day.");
  } else if (deliveryOn || installationOn || !input.canClear) {
    const problem = installationDates({ deliveryOn, installationOn });
    if (problem) throw new BadRequestException(problem);
  }
  const before = (await db.query<InstallationDays>(
    `SELECT delivery_on::text AS "deliveryOn", installation_on::text AS "installationOn", installation_note AS note FROM delivery_projects WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, projectId])).rows[0];
  if (!before) throw new BadRequestException("Project not found.");
  if (before.deliveryOn === deliveryOn && before.installationOn === installationOn && before.note === note) return null;
  // PLM-136: buildings can't be entered without a permit: a new delivery or installation day needs one covering it.
  if (deliveryOn && deliveryOn !== before.deliveryOn) await assertPermitFor(db, workspaceId, { projectId }, deliveryOn, "delivery");
  if (installationOn && installationOn !== before.installationOn) await assertPermitFor(db, workspaceId, { projectId }, installationOn, "installation");
  await db.query(`UPDATE delivery_projects SET delivery_on = $3, installation_on = $4, installation_note = $5, installation_set_by = $6, installation_set_at = now()
    WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId, deliveryOn, installationOn, installationOn ? note : "", input.actorUserId]);
  if (installationOn && installationOn !== before.installationOn) {
    const delivery = deliveryOn ? `Delivery on ${await workspaceDay(db, workspaceId, deliveryOn)}.` : "";
    await tellKeepInformed(db, { workspaceId, projectId, event: "installation_scheduled", key: installationOn, actorUserId: input.actorUserId, date: installationOn,
      note: [delivery, note].filter(Boolean).join(" "), also: input.team });
  }
  return before;
}

/**
 * Books (or moves) the factory slot's day on a project (PLM-068), from the project or the factory and logistics
 * calendar; clearing it is the project manager's (`canClear`). A new day is told to the project's managers (`leads`);
 * the first one holds the work orders' materials where the path says so (PLM-125). Returns the slot before, or null
 * when nothing changed. The caller bumps the project's version and audits.
 */
export async function writeFactorySlot(db: Db, input: {
  workspaceId: string; projectId: string; slot: string | null; note: string; actorUserId: string; canClear: boolean; leads: string[];
}): Promise<{ on: string | null; note: string } | null> {
  const { workspaceId, projectId, slot } = input;
  if (!slot && !input.canClear) throw new BadRequestException("Choose the slot's date.");
  const note = input.note.trim();
  if (note.length > 500) throw new BadRequestException("Keep the note under 500 characters.");
  const before = (await db.query<{ on: string | null; note: string }>(
    `SELECT factory_slot_on::text AS on, factory_slot_note AS note FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
  if (!before) throw new BadRequestException("Project not found.");
  if (before.on === slot && before.note === note) return null;
  await db.query(`UPDATE delivery_projects SET factory_slot_on = $3, factory_slot_note = $4, factory_slot_by = CASE WHEN $3::date IS NULL THEN NULL ELSE $5::uuid END,
      factory_slot_at = CASE WHEN $3::date IS NULL THEN NULL ELSE now() END WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId, slot, slot ? note : "", input.actorUserId]);
  if (slot && slot !== before.on && input.leads.length)
    await noticeProject(db, { workspaceId, projectId, key: `slot:${slot}`, actorUserId: input.actorUserId, notice: { code: "project.factory_slot_booked", date: slot, memberships: input.leads } });
  // PLM-125: booking production holds the work orders' materials where the path says so (Furniture D and E).
  if (slot && !before.on) await reserveForProduction(db, workspaceId, { projectId, actorUserId: input.actorUserId });
  return before;
}
