import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ActorUser, RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { writeDealDelivery } from "../fulfilment/deal-delivery";
import { tradeName } from "../project-core/labour-rates";
import { membershipOf, readStages, readTeam } from "../project-core/project-core.store";
import { installationRoles, writeFactorySlot, writeInstallationDays } from "../project-core/project-installation";
import { noticeStageReady } from "../project-core/project-stage-watch";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { BOOKERS, clashes, isDay, isLogisticsKind, KIND_LABEL, parsePeople, parseVehicle, permitCollected, permitFor, permitReminderOn, slotKey, type LogisticsKind } from "./logistics.domain";
import { crewLine, installationTeam, permissionHolders, permitReminderDays, permitWarningDays, readSlots, tell, type SlotView } from "./logistics.store";
import { permitRequired, readPermitFacts, type PermitOwner } from "./permits";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Who reads the bookings: the factory, the people who run projects, sales and the people who deliver deals, and the bookers. */
const READ = ["factory.view", "factory.manage", "projects.view", "projects.manage", "logistics.manage", "crm.opportunities.view", "fulfilment.deliver", "stock.manage"];
/** Who moves a won deal's delivery along (as on the deal itself). */
const DEAL_FULFIL = ["crm.opportunities.manage", "projects.manage", "stock.manage", "fulfilment.deliver"];
/** Who keeps the vehicles register and the permit settings. */
const SETUP = [...BOOKERS, "workspace.settings.manage"];
const OPEN_ORDERS = ["planned", "released", "on_hold"];
const DAY = 86_400_000;
const plusDays = (day: string, count: number) => new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export type BookingInput = {
  kind?: unknown; projectId?: unknown; opportunityId?: unknown; workOrderId?: unknown; permitId?: unknown; day?: unknown; endDay?: unknown;
  /** The day(s) the person saw before changing them: a booking moved by someone else meanwhile is refused. */
  was?: { start?: unknown; end?: unknown } | null;
  /** The assignment's version (0 when nobody was assigned yet). */
  version?: unknown;
  people?: unknown; crewId?: unknown; vehicleId?: unknown; driverWorkerId?: unknown; note?: unknown;
};
export type PermitInput = {
  permitType?: unknown; permitNumber?: unknown; validFrom?: unknown; validTo?: unknown; collectedOn?: unknown; collectedByWorkerId?: unknown; note?: unknown; version?: unknown;
  /** Days before it ends that its reminder goes (PLM-136); empty follows the firm's default. */
  reminderDays?: unknown;
};

/** What a booking is for: a project's (or a work order's) day, or a deal's delivery when the order has no project. */
type Subject = { kind: LogisticsKind; projectId: string | null; opportunityId: string | null; workOrderId: string | null; permitId: string | null };
type Rights = { book: boolean; clear: boolean; booker: boolean };

/**
 * Factory and installation bookings (PLM-063, PLM-069; PLM-135 and PLM-136 from Palm's answers of 6 Oct). From the
 * factory and logistics calendar (the main booking point), a project or a deal: a delivery, an installation, a factory
 * slot, a permit collection or a production work order gets its day and who goes: HRMS workers by name (no login
 * needed), a lead among them, and for a delivery the vehicle and the driver. A person booked twice on a day warns; a
 * vehicle can't be booked twice. A delivery or installation where the building permit is required needs a collected
 * permit covering its day. Commands are validated, version-checked and audited.
 */
@Injectable()
export class LogisticsService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  // ---------- reads ----------

  /** What a booking is made from: projects, deals to deliver, open work orders, people and crews, vehicles; and whether this person books. */
  async options(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, READ, async (client, user) => {
      const projects = (await client.query<{ id: string; label: string; deliveryOn: string | null; installationOn: string | null; slotOn: string | null; permitRequired: boolean;
        plannedPermitId: string | null }>(
        `SELECT project.id, concat_ws(' · ', nullif(project.reference, ''), project.name) AS label, project.delivery_on::text AS "deliveryOn",
                project.installation_on::text AS "installationOn", project.factory_slot_on::text AS "slotOn",
                (SELECT permit.id FROM building_permits permit WHERE permit.workspace_id = project.workspace_id AND permit.project_id = project.id AND permit.status = 'planned') AS "plannedPermitId",
                EXISTS (SELECT 1 FROM project_stages stage, jsonb_array_elements(stage.checks) item WHERE stage.workspace_id = project.workspace_id AND stage.project_id = project.id
                         AND stage.status <> 'skipped' AND item->>'kind' = 'permit_collected') AS "permitRequired"
           FROM delivery_projects project WHERE project.workspace_id = $1 AND project.status IN ('active', 'on_hold') AND project.started_at IS NOT NULL
          ORDER BY project.reference, project.name, project.id LIMIT 500`, [workspaceId])).rows;
      // Won orders delivered without a project (Furniture Only paths B–E), not cancelled and not delivered yet.
      const deals = (await client.query<{ id: string; label: string; deliveryOn: string | null; plannedPermitId: string | null }>(
        `SELECT opportunity.id, concat_ws(' · ', nullif(opportunity.reference, ''), coalesce(party.display_name, opportunity.title)) AS label, deal.delivery_on::text AS "deliveryOn",
                (SELECT permit.id FROM building_permits permit WHERE permit.workspace_id = opportunity.workspace_id AND permit.opportunity_id = opportunity.id AND permit.status = 'planned') AS "plannedPermitId"
           FROM crm_opportunities opportunity
           LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
           LEFT JOIN crm_deal_fulfilment deal ON deal.workspace_id = opportunity.workspace_id AND deal.opportunity_id = opportunity.id
          WHERE opportunity.workspace_id = $1 AND opportunity.status::text = 'won' AND opportunity.furniture_path IS NOT NULL AND opportunity.furniture_path <> 'take_home_now'
            AND deal.cancelled_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM crm_deal_fulfilment_events event WHERE event.workspace_id = opportunity.workspace_id AND event.opportunity_id = opportunity.id AND event.event = 'delivered')
          ORDER BY opportunity.reference, opportunity.id LIMIT 300`, [workspaceId])).rows;
      const dealPermit = (await client.query<{ on: boolean }>(`SELECT deal_delivery_permit AS on FROM workspace_logistics_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.on ?? false;
      const workOrders = (await client.query<{ id: string; projectId: string; label: string; start: string | null; end: string | null; status: string }>(
        `SELECT wo.id, wo.project_id AS "projectId", concat('WO-', lpad(wo.number::text, 4, '0'), ' ', wo.title) AS label, wo.planned_start::text AS start,
                wo.planned_end::text AS "end", wo.status FROM work_orders wo
          WHERE wo.workspace_id = $1 AND wo.status = ANY($2::text[]) ORDER BY wo.number LIMIT 1000`, [workspaceId, OPEN_ORDERS])).rows;
      const workers = (await client.query<{ id: string; name: string; phone: string; trade: string; crewId: string | null }>(
        `SELECT id, name, phone, trade, crew_id AS "crewId" FROM hrms_workers WHERE workspace_id = $1 AND active ORDER BY lower(name), id LIMIT 2000`, [workspaceId])).rows;
      const crews = (await client.query<{ id: string; name: string; trade: string }>(
        `SELECT id, name, trade FROM hrms_crews WHERE workspace_id = $1 AND active ORDER BY lower(name), id`, [workspaceId])).rows
        .map((crew) => ({ ...crew, workerIds: workers.filter((worker) => worker.crewId === crew.id).map((worker) => worker.id) }));
      const vehicles = (await client.query<{ id: string; name: string; plate: string; kind: string; capacityNote: string }>(
        `SELECT id, name, plate, kind, capacity_note AS "capacityNote" FROM logistics_vehicles WHERE workspace_id = $1 AND active ORDER BY lower(name), id`, [workspaceId])).rows;
      const permitTypes = (await client.query<{ type: string }>(
        `SELECT DISTINCT permit_type AS type FROM building_permits WHERE workspace_id = $1 AND permit_type <> '' ORDER BY 1 LIMIT 50`, [workspaceId])).rows.map((row) => row.type);
      return { projects, deals: deals.map((deal) => ({ ...deal, permitRequired: dealPermit })), workOrders, workers, crews, vehicles, permitTypes,
        canBook: await this.any(client, workspaceId, user.userId, BOOKERS),
        canAddPeople: await this.any(client, workspaceId, user.userId, [...BOOKERS, "hrms.manage", "projects.manage", "projects.view", ...DEAL_FULFIL]),
        permitWarningDays: (await permitWarningDays(client, workspaceId)).days };
    });
  }

  /** One booking as it stands (its day, who goes, the vehicle and driver, its permit) and whether this person may change it. */
  async booking(actor: RequestActor, workspaceId: string, query: { kind?: unknown; projectId?: unknown; opportunityId?: unknown; workOrderId?: unknown; permitId?: unknown }) {
    const subject = this.subject(query);
    return this.access.withAnyPermission(actor, workspaceId, READ, async (client, user) => this.view(client, workspaceId, subject, user));
  }

  /** People or vehicles already booked elsewhere on the candidate days (people warn; a vehicle can't be booked twice). */
  async conflicts(actor: RequestActor, workspaceId: string, input: BookingInput & { workerIds?: unknown }) {
    const subject = this.subject(input, true);
    const start = isDay(input.day) ? input.day : null;
    if (!start) throw new BadRequestException("Choose the day.");
    const end = isDay(input.endDay) && input.endDay >= start ? input.endDay : start;
    const workerIds = (Array.isArray(input.workerIds) ? input.workerIds : []).filter((id): id is string => typeof id === "string" && UUID.test(id)).slice(0, 60);
    const driverId = typeof input.driverWorkerId === "string" && UUID.test(input.driverWorkerId) ? input.driverWorkerId : null;
    const vehicleId = typeof input.vehicleId === "string" && UUID.test(input.vehicleId) ? input.vehicleId : null;
    return this.access.withAnyPermission(actor, workspaceId, READ, async (client) =>
      ({ warnings: await this.warnings(client, workspaceId, { key: this.key(subject), start, end, workerIds, driverId, vehicleId }) }));
  }

  // ---------- commands ----------

  /**
   * Books, moves or staffs one booking: its day (written on its source record, through the same rules as the project,
   * the factory and the deal: the installation and delivery days, the factory slot, a work order's planned days, a
   * permit collection, a deal's delivery) and who goes. Fields left out stay as they are. A vehicle already out that day
   * is refused; people booked elsewhere come back as warnings.
   */
  async save(actor: RequestActor, workspaceId: string, input: BookingInput) {
    const subject = this.subject(input, true);
    const day = input.day === undefined ? undefined : input.day === null ? null : isDay(input.day) ? input.day : "invalid";
    if (day === "invalid") throw new BadRequestException("Choose a valid day.");
    if (input.endDay !== undefined && input.endDay !== null && !isDay(input.endDay)) throw new BadRequestException("Choose a valid finish day.");
    const people = parsePeople(input.people);
    if ("problem" in people) throw new UnprocessableEntityException(people.problem);
    const crewId = this.optionalId(input.crewId, "Choose a crew from the list.");
    const vehicleId = this.optionalId(input.vehicleId, "Choose a vehicle from the list.");
    const driverId = this.optionalId(input.driverWorkerId, "Choose the driver from the list.");
    if (subject.kind !== "delivery" && (vehicleId || driverId)) throw new BadRequestException("A vehicle and a driver go on deliveries.");
    const note = input.note === undefined ? undefined : typeof input.note === "string" ? input.note.trim() : "";
    if (note !== undefined && note.length > 500) throw new BadRequestException("Keep the note under 500 characters.");
    if (!Number.isInteger(input.version) || Number(input.version) < 0) throw new BadRequestException("A version is required.");
    return this.access.withAnyPermission(actor, workspaceId, [...READ, ...BOOKERS], async (client, user) => {
      const rights = await this.rights(client, workspaceId, subject, user);
      if (!rights.book) throw new ForbiddenException(this.refusal(subject));
      await this.lock(client, workspaceId, subject);
      const current = await this.current(client, workspaceId, subject, true);
      if (input.was !== undefined && input.was !== null) {
        const seenStart = input.was.start ?? null, seenEnd = input.was.end ?? input.was.start ?? null;
        if ((current.start ?? null) !== seenStart || (subject.kind === "production" && (current.end ?? null) !== seenEnd))
          throw new ConflictException("This booking moved meanwhile. Reload and try again.");
      }
      const assignment = await this.assignment(client, workspaceId, { ...subject, permitId: subject.kind === "permit" ? subject.permitId ?? current.permitId : null });
      if ((assignment?.version ?? 0) !== Number(input.version)) throw new ConflictException("Someone changed who goes on this booking. Reload and try again.");
      const audit: Record<string, unknown> = { kind: subject.kind, projectId: subject.projectId, opportunityId: subject.opportunityId, workOrderId: subject.workOrderId };
      // The day, on its source record.
      let moved = false;
      if (day !== undefined && day !== current.start) {
        if (!day && subject.kind !== "delivery" && subject.kind !== "installation") throw new BadRequestException("Choose the day.");
        if (!day && !rights.clear) throw new ForbiddenException("Only the project manager or the factory and logistics team clear a day.");
        const endDay = subject.kind === "production" && day ? this.productionEnd(day, input.endDay, current) : day;
        await this.writeDay(client, workspaceId, subject, day, endDay, current, user, rights);
        audit.day = { from: current.start, to: day, end: endDay };
        moved = true;
      } else if (subject.kind === "production" && isDay(input.endDay) && input.endDay !== current.end && current.start) {
        if (input.endDay < current.start) throw new BadRequestException("The finish can't be before the start.");
        await this.writeDay(client, workspaceId, subject, current.start, input.endDay, current, user, rights);
        audit.day = { from: current.end, to: input.endDay };
        moved = true;
      }
      if (subject.kind === "permit" && !subject.permitId) subject.permitId = current.permitId;
      // Who goes.
      const staffing = people.people !== undefined || input.crewId !== undefined || input.vehicleId !== undefined || input.driverWorkerId !== undefined || note !== undefined;
      if (staffing) {
        if (!(await this.current(client, workspaceId, subject, false)).start) throw new ConflictException("Book the day first.");
        await this.assertActive(client, workspaceId, { workers: [...(people.people ?? []).map((person) => person.workerId), ...(driverId ? [driverId] : [])], crewId, vehicleId });
        const id = assignment?.id ?? randomUUID();
        const next = { crewId: input.crewId === undefined ? assignment?.crewId ?? null : crewId, vehicleId: input.vehicleId === undefined ? assignment?.vehicleId ?? null : vehicleId,
          driverId: input.driverWorkerId === undefined ? assignment?.driverId ?? null : driverId, note: note ?? assignment?.note ?? "" };
        if (assignment) await client.query(
          `UPDATE logistics_assignments SET crew_id = $3, vehicle_id = $4, driver_worker_id = $5, note = $6, updated_by = $7, updated_at = now(), version = version + 1
            WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, next.crewId, next.vehicleId, next.driverId, next.note, user.userId]);
        else await client.query(
          `INSERT INTO logistics_assignments (id, workspace_id, kind, project_id, opportunity_id, work_order_id, permit_id, crew_id, vehicle_id, driver_worker_id, note, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
          [id, workspaceId, subject.kind, subject.projectId, subject.opportunityId, subject.workOrderId, subject.permitId, next.crewId, next.vehicleId, next.driverId, next.note, user.userId]);
        if (people.people !== undefined) {
          await client.query(`DELETE FROM logistics_assignment_people WHERE workspace_id = $1 AND assignment_id = $2`, [workspaceId, id]);
          for (const person of people.people)
            await client.query(`INSERT INTO logistics_assignment_people (workspace_id, assignment_id, worker_id, lead) VALUES ($1, $2, $3, $4)`, [workspaceId, id, person.workerId, person.lead]);
        }
        audit.crew = { ...next, people: people.people };
      }
      if (!moved && !staffing) return { ...await this.view(client, workspaceId, subject, user), warnings: [] };
      const view = await this.view(client, workspaceId, subject, user);
      const warnings = view.start ? await this.warnings(client, workspaceId, { key: this.key(subject), start: view.start, end: view.end ?? view.start,
        workerIds: view.people.map((person) => person.id), driverId: view.driver?.id ?? null, vehicleId: view.vehicle?.id ?? null }) : [];
      // PLM-135: a vehicle is accounted for: it can't go out twice on a day (the whole command is undone).
      const vehicleClash = warnings.find((clash) => clash.kind === "vehicle");
      if (vehicleClash) throw new ConflictException(`${vehicleClash.name} is already out that day: ${vehicleClash.whatLabel.toLowerCase()} · ${vehicleClash.project}. Choose another vehicle or day.`);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "logistics.booked.v1", entityType: subject.projectId ? "project" : "crm_opportunity",
        entityId: (subject.projectId ?? subject.opportunityId)!, after: audit });
      // The project's managers and installation team (a deal's owner) hear a delivery or a permit collection booked or
      // moved; an installation day and a factory slot are told by the project's own notices, a deal's delivery by the deal's.
      if (moved && view.start && (subject.kind === "permit" || (subject.kind === "delivery" && subject.projectId))) {
        const users = (subject.projectId ? (await installationTeam(client, workspaceId, subject.projectId)).map((person) => person.userId) : await this.dealOwner(client, workspaceId, subject.opportunityId!))
          .filter((id) => id !== user.userId);
        await tell(client, { workspaceId, users, code: "logistics.booked", deepLink: this.link(subject), key: `logistics:${this.key(subject)}:${view.start}`,
          variables: { what: KIND_LABEL[subject.kind], project: view.project, date: await this.day(client, workspaceId, view.start), actor: user.displayName ?? "", crew: crewLine(view) } });
      }
      if (subject.projectId) await noticeStageReady(client, workspaceId, subject.projectId, user.userId);
      return { ...view, warnings };
    });
  }

  /** Cancels a delivery, an installation, a factory slot or a planned permit collection: its day is cleared and nobody goes. */
  async cancel(actor: RequestActor, workspaceId: string, input: BookingInput) {
    const subject = this.subject(input);
    if (subject.kind === "production") throw new BadRequestException("Change production on its work order.");
    return this.access.withAnyPermission(actor, workspaceId, [...READ, ...BOOKERS], async (client, user) => {
      const rights = await this.rights(client, workspaceId, subject, user);
      if (!rights.book) throw new ForbiddenException(this.refusal(subject));
      await this.lock(client, workspaceId, subject);
      const current = await this.current(client, workspaceId, subject, true);
      if (!current.start) throw new ConflictException("This booking is already cancelled.");
      if (input.was && (input.was.start ?? null) !== current.start) throw new ConflictException("This booking moved meanwhile. Reload and try again.");
      if (subject.kind === "permit") {
        await client.query(`UPDATE building_permits SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, current.permitId, user.userId]);
      } else await this.writeDay(client, workspaceId, subject, null, null, current, user, { ...rights, clear: true });
      const assignment = await this.assignment(client, workspaceId, { ...subject, permitId: subject.kind === "permit" ? current.permitId : null });
      if (assignment) await client.query(`DELETE FROM logistics_assignments WHERE workspace_id = $1 AND id = $2`, [workspaceId, assignment.id]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "logistics.cancelled.v1", entityType: subject.projectId ? "project" : "crm_opportunity",
        entityId: (subject.projectId ?? subject.opportunityId)!, before: { kind: subject.kind, day: current.start } });
      if (subject.projectId) await noticeStageReady(client, workspaceId, subject.projectId, user.userId);
      return { cancelled: true };
    });
  }

  /**
   * Adds a person by name (and phone, when known) from a booking: a saved name the team picks again later, or one typed
   * as free text there and then (PLM-135: crews and installers needn't be Wodana users). An HRMS worker without a login.
   * Replayed safely by its id; the same name and phone again finds the person already there.
   */
  async addPerson(actor: RequestActor, workspaceId: string, input: { id?: unknown; name?: unknown; phone?: unknown; trade?: unknown; crewId?: unknown }) {
    if (typeof input.id !== "string" || !UUID.test(input.id)) throw new BadRequestException("An id is required.");
    const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";
    const trade = tradeName(typeof input.trade === "string" ? input.trade : "");
    if (!name || name.length > 120) throw new UnprocessableEntityException("Give the person's name.");
    if (phone.length > 40) throw new UnprocessableEntityException("Check the phone number.");
    if (!trade || trade.length > 80) throw new UnprocessableEntityException("Say what they do (their trade).");
    const crewId = this.optionalId(input.crewId, "Choose a crew from the list.");
    const id = input.id;
    return this.access.withAnyPermission(actor, workspaceId, [...BOOKERS, "hrms.manage", "projects.manage", "projects.view", ...DEAL_FULFIL], async (client, user) => {
      const again = (await client.query<{ id: string }>(`SELECT id FROM hrms_workers WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      const same = again ?? (await client.query<{ id: string }>(
        `SELECT id FROM hrms_workers WHERE workspace_id = $1 AND active AND lower(name) = lower($2) AND phone = $3 ORDER BY created_at LIMIT 1`, [workspaceId, name, phone])).rows[0];
      if (same) return this.person(client, workspaceId, same.id);
      if (crewId && !(await client.query(`SELECT 1 FROM hrms_crews WHERE workspace_id = $1 AND id = $2 AND active`, [workspaceId, crewId])).rowCount)
        throw new BadRequestException("Choose an active crew.");
      await client.query(`INSERT INTO hrms_workers (id, workspace_id, crew_id, name, trade, phone) VALUES ($1, $2, $3, $4, $5, $6)`, [id, workspaceId, crewId, name, trade, phone]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "hrms.worker_created.v1", entityType: "hrms", entityId: id,
        after: { id, name, phone, trade, crewId, from: "booking" } });
      return this.person(client, workspaceId, id);
    });
  }

  // ---------- vehicles and settings ----------

  async vehicles(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, [...READ, ...SETUP], (client, user) => this.vehiclesView(client, workspaceId, user.userId));
  }

  /** Adds or changes a vehicle (version-checked; a name is used once). Audited. */
  async saveVehicle(actor: RequestActor, workspaceId: string, input: { id?: unknown; version?: unknown; name?: unknown; plate?: unknown; kind?: unknown; capacityNote?: unknown; active?: unknown }) {
    if (typeof input.id !== "string" || !UUID.test(input.id)) throw new BadRequestException("An id is required.");
    const parsed = parseVehicle(input);
    if ("problem" in parsed) throw new UnprocessableEntityException(parsed.problem);
    const id = input.id, vehicle = parsed.vehicle;
    return this.access.withAnyPermission(actor, workspaceId, SETUP, async (client, user) => {
      const before = (await client.query<{ version: number; name: string; plate: string; kind: string; capacityNote: string; active: boolean }>(
        `SELECT version, name, plate, kind, capacity_note AS "capacityNote", active FROM logistics_vehicles WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id])).rows[0];
      if ((before?.version ?? 0) !== Number(input.version ?? 0)) throw new ConflictException("Someone changed this vehicle. Reload and try again.");
      if ((await client.query(`SELECT 1 FROM logistics_vehicles WHERE workspace_id = $1 AND lower(name) = lower($2) AND id <> $3`, [workspaceId, vehicle.name, id])).rowCount)
        throw new ConflictException("A vehicle with this name exists.");
      if (before) await client.query(
        `UPDATE logistics_vehicles SET name = $3, plate = $4, kind = $5, capacity_note = $6, active = $7, updated_by = $8, updated_at = now(), version = version + 1
          WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, vehicle.name, vehicle.plate, vehicle.kind, vehicle.capacityNote, vehicle.active, user.userId]);
      else await client.query(
        `INSERT INTO logistics_vehicles (id, workspace_id, name, plate, kind, capacity_note, active, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [id, workspaceId, vehicle.name, vehicle.plate, vehicle.kind, vehicle.capacityNote, vehicle.active, user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: before ? "logistics.vehicle_changed.v1" : "logistics.vehicle_added.v1", entityType: "logistics_vehicle",
        entityId: id, before: before ?? null, after: vehicle });
      return this.vehiclesView(client, workspaceId, user.userId);
    });
  }

  /**
   * How many working days before a delivery or installation a missing building permit is raised (0–30), and whether
   * deals delivered without a project need a permit too. Version-checked; audited.
   */
  async saveSettings(actor: RequestActor, workspaceId: string, input: { version?: unknown; permitWarningDays?: unknown; dealDeliveryPermit?: unknown; permitExpiryReminderDays?: unknown }) {
    const days = input.permitWarningDays === undefined ? undefined : Number(input.permitWarningDays);
    if (days !== undefined && (!Number.isInteger(days) || days < 0 || days > 30)) throw new UnprocessableEntityException("Days are between 0 and 30.");
    const reminder = input.permitExpiryReminderDays === undefined ? undefined : Number(input.permitExpiryReminderDays);
    if (reminder !== undefined && (!Number.isInteger(reminder) || reminder < 0 || reminder > 365)) throw new UnprocessableEntityException("Reminder days are between 0 and 365.");
    if (input.dealDeliveryPermit !== undefined && typeof input.dealDeliveryPermit !== "boolean") throw new BadRequestException("Choose on or off.");
    return this.access.withAnyPermission(actor, workspaceId, SETUP, async (client, user) => {
      const before = await this.settingsOf(client, workspaceId);
      if (before.version !== Number(input.version ?? 0)) throw new ConflictException("Someone changed these settings. Reload and try again.");
      const next = { permitWarningDays: days ?? before.permitWarningDays, dealDeliveryPermit: typeof input.dealDeliveryPermit === "boolean" ? input.dealDeliveryPermit : before.dealDeliveryPermit,
        permitExpiryReminderDays: reminder ?? before.permitExpiryReminderDays };
      if (next.permitWarningDays !== before.permitWarningDays || next.dealDeliveryPermit !== before.dealDeliveryPermit || next.permitExpiryReminderDays !== before.permitExpiryReminderDays) {
        await client.query(
          `INSERT INTO workspace_logistics_settings (workspace_id, permit_warning_days, deal_delivery_permit, permit_expiry_reminder_days, updated_by) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (workspace_id) DO UPDATE SET permit_warning_days = excluded.permit_warning_days, deal_delivery_permit = excluded.deal_delivery_permit,
             permit_expiry_reminder_days = excluded.permit_expiry_reminder_days, updated_by = excluded.updated_by, updated_at = now(), version = workspace_logistics_settings.version + 1`,
          [workspaceId, next.permitWarningDays, next.dealDeliveryPermit, next.permitExpiryReminderDays, user.userId]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "logistics.settings_changed.v1", entityType: "workspace_logistics_settings", entityId: workspaceId,
          before: { permitWarningDays: before.permitWarningDays, dealDeliveryPermit: before.dealDeliveryPermit, permitExpiryReminderDays: before.permitExpiryReminderDays }, after: next });
      }
      return this.vehiclesView(client, workspaceId, user.userId);
    });
  }

  // ---------- building permits ----------

  /** A project's or a deal's building permits (PLM-136): whether one is required, the collected ones with their files, the planned collection. */
  async permits(actor: RequestActor, workspaceId: string, owner: PermitOwner) {
    return this.access.withAnyPermission(actor, workspaceId, READ, async (client, user) => {
      await this.ownerExists(client, workspaceId, owner);
      return this.permitsView(client, workspaceId, owner, user);
    });
  }

  /**
   * Records the building permit collected (PLM-136): its type, reference, valid-from and valid-to days, the file, the
   * day and who collected it, on the project or the deal (it shows on both). A planned collection becomes the permit;
   * otherwise a new one is added. Replayed safely by its id and file.
   */
  async collectPermit(actor: RequestActor, workspaceId: string, owner: PermitOwner, permitId: string, input: PermitInput, file?: ReferenceUpload) {
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    if (!UUID.test(permitId)) throw new BadRequestException("The upload isn't valid.");
    const type = typeof input.permitType === "string" ? input.permitType.trim().replace(/\s+/g, " ") : "";
    if (type.length > 80) throw new UnprocessableEntityException("Keep the permit type short.");
    const number = typeof input.permitNumber === "string" ? input.permitNumber.trim() : "";
    if (!number || number.length > 80) throw new UnprocessableEntityException("Give the permit number.");
    if (!isDay(input.validFrom) || !isDay(input.validTo)) throw new UnprocessableEntityException("Give the days the permit is valid.");
    if (input.validTo < input.validFrom) throw new UnprocessableEntityException("The permit can't end before it starts.");
    if (input.collectedOn !== undefined && input.collectedOn !== "" && !isDay(input.collectedOn)) throw new UnprocessableEntityException("Choose the day it was collected.");
    const collectedBy = this.optionalId(input.collectedByWorkerId === "" ? undefined : input.collectedByWorkerId, "Choose who collected it.");
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
    const reminderDays = this.reminderDays(input.reminderDays);
    const prepared = await prepareReferenceUpload(file);
    const validFrom = input.validFrom, validTo = input.validTo;
    const subject: Subject = { kind: "permit", projectId: owner.projectId ?? null, opportunityId: owner.opportunityId ?? null, workOrderId: null, permitId };
    return this.access.withAnyPermission(actor, workspaceId, [...READ, ...BOOKERS], async (client, user) => {
      const rights = await this.rights(client, workspaceId, subject, user);
      if (!rights.book) throw new ForbiddenException(this.refusal(subject));
      await this.lock(client, workspaceId, subject);
      const today = await this.today(client, workspaceId);
      const collectedOn = isDay(input.collectedOn) ? input.collectedOn : today;
      if (collectedOn > today) throw new UnprocessableEntityException("The permit can't be collected in the future.");
      const before = (await client.query<{ status: string; projectId: string | null; opportunityId: string | null; sha: string | null; version: number }>(
        `SELECT status, project_id AS "projectId", opportunity_id AS "opportunityId", file_sha256 AS sha, version FROM building_permits WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [workspaceId, permitId])).rows[0];
      if (before && (before.projectId ?? null) !== subject.projectId && (before.opportunityId ?? null) !== subject.opportunityId) throw new NotFoundException("Permit not found.");
      if (before?.status === "collected") {
        if (before.sha === prepared.digest) return this.permitsView(client, workspaceId, owner, user);
        throw new ConflictException("This permit is already recorded. Record a new one to replace it.");
      }
      if (before?.status === "cancelled") throw new ConflictException("This collection was cancelled.");
      if (before && input.version !== undefined && input.version !== "" && Number(input.version) !== before.version) throw new ConflictException("This permit changed. Reload and try again.");
      if (collectedBy) await this.assertActive(client, workspaceId, { workers: [collectedBy], crewId: null, vehicleId: null });
      const key = `permits/${workspaceId}/${permitId}`;
      await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
      const values = [workspaceId, permitId, type, number, validFrom, validTo, collectedOn, collectedBy, note, prepared.name, prepared.mimeType, prepared.body.length, `${key}/original`,
        prepared.digest, user.userId, reminderDays];
      if (before) await client.query(
        `UPDATE building_permits SET status = 'collected', permit_type = $3, permit_number = $4, valid_from = $5, valid_to = $6, collected_on = $7, collected_by_worker_id = $8, note = $9,
                file_name = $10, file_mime = $11, file_size = $12, file_key = $13, file_sha256 = $14, recorded_by = $15, recorded_at = now(), reminder_days = $16, version = version + 1
          WHERE workspace_id = $1 AND id = $2`, values);
      else {
        // A collection still planned for the project or deal is done: this permit is what it brought back.
        await client.query(`UPDATE building_permits SET status = 'cancelled', cancel_reason = 'Collected', cancelled_by = $4, cancelled_at = now(), version = version + 1
          WHERE workspace_id = $1 AND (project_id = $2::uuid OR opportunity_id = $3::uuid) AND status = 'planned'`, [workspaceId, subject.projectId, subject.opportunityId, user.userId]);
        await client.query(
          `INSERT INTO building_permits (workspace_id, id, status, permit_type, permit_number, valid_from, valid_to, collected_on, collected_by_worker_id, note, file_name, file_mime, file_size,
                  file_key, file_sha256, created_by, recorded_by, recorded_at, reminder_days, project_id, opportunity_id)
           VALUES ($1, $2, 'collected', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, now(), $16, $17, $18)`, [...values, subject.projectId, subject.opportunityId]);
      }
      await this.touch(client, workspaceId, subject);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "logistics.permit_collected.v1", entityType: subject.projectId ? "project" : "crm_opportunity",
        entityId: (subject.projectId ?? subject.opportunityId)!, after: { permitId, type, number, validFrom, validTo, collectedOn, collectedBy, reminderDays, file: prepared.name, sha256: prepared.digest } });
      const users = (subject.projectId ? (await installationTeam(client, workspaceId, subject.projectId)).map((person) => person.userId) : await this.dealOwner(client, workspaceId, subject.opportunityId!))
        .filter((id) => id !== user.userId);
      await tell(client, { workspaceId, users, code: "logistics.permit_collected", deepLink: this.link(subject), key: `logistics:permit:${permitId}:collected`, inAppOnly: true,
        variables: { project: await this.label(client, workspaceId, subject), number, from: await this.day(client, workspaceId, validFrom), to: await this.day(client, workspaceId, validTo),
          actor: user.displayName ?? "" } });
      // The permit task closes; the delivery and installation can be booked.
      if (subject.projectId) await noticeStageReady(client, workspaceId, subject.projectId, user.userId);
      return this.permitsView(client, workspaceId, owner, user);
    });
  }

  /** Withdraws a recorded permit (a wrong file or number) with the reason. Version-checked; audited. */
  async cancelPermit(actor: RequestActor, workspaceId: string, owner: PermitOwner, permitId: string, input: { version?: unknown; reason?: unknown }) {
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason || reason.length > 500) throw new UnprocessableEntityException("Say why the permit is withdrawn.");
    const subject: Subject = { kind: "permit", projectId: owner.projectId ?? null, opportunityId: owner.opportunityId ?? null, workOrderId: null, permitId };
    return this.access.withAnyPermission(actor, workspaceId, [...READ, ...BOOKERS], async (client, user) => {
      const rights = await this.rights(client, workspaceId, subject, user);
      if (!rights.book) throw new ForbiddenException(this.refusal(subject));
      const before = (await client.query<{ status: string; version: number }>(
        `SELECT status, version FROM building_permits WHERE workspace_id = $1 AND id = $2 AND (project_id = $3::uuid OR opportunity_id = $4::uuid) FOR UPDATE`,
        [workspaceId, permitId, subject.projectId, subject.opportunityId])).rows[0];
      if (!before) throw new NotFoundException("Permit not found.");
      if (before.version !== Number(input.version)) throw new ConflictException("This permit changed. Reload and try again.");
      if (before.status === "cancelled") return this.permitsView(client, workspaceId, owner, user);
      await client.query(`UPDATE building_permits SET status = 'cancelled', cancel_reason = $3, cancelled_by = $4, cancelled_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, permitId, reason, user.userId]);
      await client.query(`DELETE FROM logistics_assignments WHERE workspace_id = $1 AND permit_id = $2`, [workspaceId, permitId]);
      await this.touch(client, workspaceId, subject);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "logistics.permit_withdrawn.v1", entityType: subject.projectId ? "project" : "crm_opportunity",
        entityId: (subject.projectId ?? subject.opportunityId)!, before: { permitId, status: before.status }, after: { reason } });
      if (subject.projectId) await noticeStageReady(client, workspaceId, subject.projectId, user.userId);
      return this.permitsView(client, workspaceId, owner, user);
    });
  }

  /**
   * When a recorded permit reminds before it ends (PLM-136): its own days, or back to the firm's default (null). A
   * reminder already sent stays sent unless the permit's end moves past it. Version-checked; audited.
   */
  async setPermitReminder(actor: RequestActor, workspaceId: string, owner: PermitOwner, permitId: string, input: { reminderDays?: unknown; version?: unknown }) {
    const reminderDays = this.reminderDays(input.reminderDays);
    const subject: Subject = { kind: "permit", projectId: owner.projectId ?? null, opportunityId: owner.opportunityId ?? null, workOrderId: null, permitId };
    return this.access.withAnyPermission(actor, workspaceId, [...READ, ...BOOKERS], async (client, user) => {
      const rights = await this.rights(client, workspaceId, subject, user);
      if (!rights.book) throw new ForbiddenException(this.refusal(subject));
      const before = (await client.query<{ status: string; reminderDays: number | null; version: number }>(
        `SELECT status, reminder_days AS "reminderDays", version FROM building_permits WHERE workspace_id = $1 AND id = $2 AND (project_id = $3::uuid OR opportunity_id = $4::uuid) FOR UPDATE`,
        [workspaceId, permitId, subject.projectId, subject.opportunityId])).rows[0];
      if (!before) throw new NotFoundException("Permit not found.");
      if (before.version !== Number(input.version)) throw new ConflictException("This permit changed. Reload and try again.");
      if (before.status !== "collected") throw new ConflictException("Only a recorded permit has a reminder.");
      if ((before.reminderDays ?? null) === reminderDays) return this.permitsView(client, workspaceId, owner, user);
      await client.query(`UPDATE building_permits SET reminder_days = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, permitId, reminderDays]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "logistics.permit_reminder_changed.v1", entityType: subject.projectId ? "project" : "crm_opportunity",
        entityId: (subject.projectId ?? subject.opportunityId)!, before: { permitId, reminderDays: before.reminderDays }, after: { permitId, reminderDays } });
      return this.permitsView(client, workspaceId, owner, user);
    });
  }

  /** A permit's file, for someone who reads the bookings. */
  async permitFile(actor: RequestActor, workspaceId: string, permitId: string) {
    return this.access.withAnyPermission(actor, workspaceId, READ, async (client) => {
      if (!UUID.test(permitId)) throw new NotFoundException("File not found.");
      const row = (await client.query<{ key: string | null; mime: string | null; name: string | null }>(
        `SELECT file_key AS key, file_mime AS mime, file_name AS name FROM building_permits WHERE workspace_id = $1 AND id = $2`, [workspaceId, permitId])).rows[0];
      if (!row?.key || !this.storage) throw new NotFoundException("File not found.");
      const stored = await this.storage.read(row.key).catch(() => null);
      if (!stored) throw new NotFoundException("File not found.");
      return { body: stored.body, contentType: row.mime ?? "application/octet-stream", name: row.name ?? "permit" };
    });
  }

  // ---------- helpers ----------

  /** A permit's own reminder days (0–365), or null to follow the firm's default. */
  private reminderDays(value: unknown) {
    if (value === undefined || value === null || value === "") return null;
    const days = Number(value);
    if (!Number.isInteger(days) || days < 0 || days > 365) throw new UnprocessableEntityException("Reminder days are between 0 and 365.");
    return days;
  }

  private subject(input: { kind?: unknown; projectId?: unknown; opportunityId?: unknown; workOrderId?: unknown; permitId?: unknown }, allowNewPermit = false): Subject {
    if (!isLogisticsKind(input.kind)) throw new BadRequestException("Choose what to book.");
    const projectId = typeof input.projectId === "string" && UUID.test(input.projectId) ? input.projectId : null;
    const opportunityId = !projectId && typeof input.opportunityId === "string" && UUID.test(input.opportunityId) ? input.opportunityId : null;
    if (!projectId && !opportunityId) throw new BadRequestException("Choose the project.");
    if (opportunityId && input.kind !== "delivery" && input.kind !== "permit") throw new BadRequestException("A deal books its delivery and its permit collection.");
    const workOrderId = typeof input.workOrderId === "string" && UUID.test(input.workOrderId) ? input.workOrderId : null;
    const permitId = typeof input.permitId === "string" && UUID.test(input.permitId) ? input.permitId : null;
    if (input.kind === "production" && !workOrderId) throw new BadRequestException("Choose the work order.");
    if (input.kind === "permit" && !permitId && !allowNewPermit) throw new BadRequestException("Choose the permit collection.");
    return { kind: input.kind, projectId, opportunityId, workOrderId: input.kind === "production" ? workOrderId : null, permitId: input.kind === "permit" ? permitId : null };
  }

  private key(subject: Subject) {
    return slotKey(subject.kind, { projectId: subject.projectId, opportunityId: subject.opportunityId, workOrderId: subject.workOrderId, permitId: subject.permitId ?? "new" });
  }

  private link(subject: Subject) {
    return subject.projectId ? `/workspace/projects/${subject.projectId}` : `/workspace/crm/opportunities?record=${subject.opportunityId}`;
  }

  private refusal(subject: Subject) {
    if (subject.kind === "production") return "Only the factory books production.";
    return subject.projectId ? "Only the factory and logistics team, or the project's manager and installation team, book this."
      : "Only the factory and logistics team, or the people who deliver orders, book this.";
  }

  private optionalId(value: unknown, message: string) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(message);
    return value;
  }

  private async any(client: Db, workspaceId: string, userId: string, codes: string[]) {
    for (const code of codes) if (await this.access.hasPermission(client, workspaceId, userId, code)) return true;
    return false;
  }

  /**
   * Who may book this: the bookers (logistics or factory managers) anything; the project's manager and its installation
   * team its delivery, installation and permit; its manager and factory lead its factory slot; production only the
   * factory; a deal's delivery and permit the people who move won orders along. `clear`: the project manager (or a
   * booker) may clear the days.
   */
  private async rights(client: Db, workspaceId: string, subject: Subject, user: ActorUser): Promise<Rights> {
    const booker = await this.any(client, workspaceId, user.userId, BOOKERS);
    if (subject.kind === "production") return { book: await this.access.hasPermission(client, workspaceId, user.userId, "factory.manage"), clear: false, booker };
    if (!subject.projectId) {
      const fulfil = booker || await this.any(client, workspaceId, user.userId, DEAL_FULFIL);
      return { book: fulfil, clear: fulfil, booker };
    }
    const all = await this.access.hasPermission(client, workspaceId, user.userId, "projects.manage");
    const membershipId = await membershipOf(client, workspaceId, user.userId);
    const team = (await readTeam(client, workspaceId, [subject.projectId])).get(subject.projectId) ?? [];
    const mine = team.filter((member) => member.membershipId === membershipId);
    const manager = all || mine.some((member) => member.lead);
    const roles = subject.kind === "factory_slot" ? ["factory_lead"] : installationRoles(await readStages(client, workspaceId, [subject.projectId]));
    const onTeam = mine.some((member) => member.roles.some((role) => roles.includes(role)));
    return { book: booker || manager || onTeam, clear: booker || manager, booker };
  }

  /** The project (running) or the deal (won, not cancelled) the booking is for, locked for the command. */
  private async lock(client: Db, workspaceId: string, subject: Subject) {
    if (subject.projectId) {
      const project = (await client.query<{ status: string }>(`SELECT status FROM delivery_projects WHERE workspace_id = $1 AND id = $2 AND started_at IS NOT NULL FOR UPDATE`,
        [workspaceId, subject.projectId])).rows[0];
      if (!project) throw new NotFoundException("Project not found.");
      if (!["active", "on_hold"].includes(project.status)) throw new ConflictException("The project is closed.");
      return;
    }
    const deal = (await client.query<{ status: string }>(`SELECT status::text AS status FROM crm_opportunities WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
      [workspaceId, subject.opportunityId])).rows[0];
    if (!deal) throw new NotFoundException("Deal not found.");
    if (deal.status !== "won") throw new ConflictException("The deal is won first: attach the payment proof.");
    if ((await client.query(`SELECT 1 FROM crm_deal_fulfilment WHERE workspace_id = $1 AND opportunity_id = $2 AND cancelled_at IS NOT NULL`, [workspaceId, subject.opportunityId])).rowCount)
      throw new ConflictException("This order is cancelled.");
  }

  private async ownerExists(client: Db, workspaceId: string, owner: PermitOwner) {
    const found = owner.projectId ? (await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, owner.projectId])).rowCount
      : (await client.query(`SELECT 1 FROM crm_opportunities WHERE workspace_id = $1 AND id = $2`, [workspaceId, owner.opportunityId])).rowCount;
    if (!found) throw new NotFoundException(owner.projectId ? "Project not found." : "Deal not found.");
  }

  /** A change to a project's or deal's bookings moves its version on (open screens reload). */
  private async touch(client: Db, workspaceId: string, subject: Subject) {
    if (subject.projectId) await client.query(`UPDATE delivery_projects SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, subject.projectId]);
    else await client.query(`UPDATE crm_deal_fulfilment SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, subject.opportunityId]);
  }

  private async assignment(client: Db, workspaceId: string, subject: Subject) {
    return (await client.query<{ id: string; version: number; crewId: string | null; vehicleId: string | null; driverId: string | null; note: string }>(
      `SELECT id, version, crew_id AS "crewId", vehicle_id AS "vehicleId", driver_worker_id AS "driverId", note FROM logistics_assignments
        WHERE workspace_id = $1 AND kind = $2 AND project_id IS NOT DISTINCT FROM $3::uuid AND opportunity_id IS NOT DISTINCT FROM $4::uuid
          AND work_order_id IS NOT DISTINCT FROM $5::uuid AND permit_id IS NOT DISTINCT FROM $6::uuid FOR UPDATE`,
      [workspaceId, subject.kind, subject.projectId, subject.opportunityId, subject.workOrderId, subject.permitId])).rows[0];
  }

  /** The booking's day(s) on its source record (and, for production, the work order's status). */
  private async current(client: Db, workspaceId: string, subject: Subject, lock: boolean) {
    const none = { status: "", permitId: null as string | null, installationOn: null as string | null, deliveryOn: null as string | null, note: "" };
    if (subject.kind === "production") {
      const order = (await client.query<{ start: string | null; end: string | null; status: string; projectId: string }>(
        `SELECT planned_start::text AS start, planned_end::text AS "end", status, project_id AS "projectId" FROM work_orders WHERE workspace_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`,
        [workspaceId, subject.workOrderId])).rows[0];
      if (!order || order.projectId !== subject.projectId) throw new NotFoundException("Work order not found.");
      return { ...none, start: order.start ?? order.end, end: order.end ?? order.start, status: order.status };
    }
    if (subject.kind === "permit") {
      const permit = (await client.query<{ id: string; collectOn: string | null }>(
        `SELECT id, collect_on::text AS "collectOn" FROM building_permits WHERE workspace_id = $1 AND (project_id = $2::uuid OR opportunity_id = $3::uuid) AND status = 'planned'
            AND ($4::uuid IS NULL OR id = $4) ${lock ? "FOR UPDATE" : ""}`, [workspaceId, subject.projectId, subject.opportunityId, subject.permitId])).rows[0];
      return { ...none, start: permit?.collectOn ?? null, end: permit?.collectOn ?? null, status: "planned", permitId: permit?.id ?? null };
    }
    if (!subject.projectId) {
      const deal = (await client.query<{ deliveryOn: string | null; note: string }>(
        `SELECT delivery_on::text AS "deliveryOn", delivery_note AS note FROM crm_deal_fulfilment WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, subject.opportunityId])).rows[0];
      return { ...none, start: deal?.deliveryOn ?? null, end: deal?.deliveryOn ?? null, deliveryOn: deal?.deliveryOn ?? null, note: deal?.note ?? "" };
    }
    const project = (await client.query<{ deliveryOn: string | null; installationOn: string | null; slotOn: string | null; note: string }>(
      `SELECT delivery_on::text AS "deliveryOn", installation_on::text AS "installationOn", factory_slot_on::text AS "slotOn", installation_note AS note
         FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, subject.projectId])).rows[0];
    if (!project) throw new NotFoundException("Project not found.");
    const start = subject.kind === "delivery" ? project.deliveryOn : subject.kind === "installation" ? project.installationOn : project.slotOn;
    return { ...none, start, end: start, installationOn: project.installationOn, deliveryOn: project.deliveryOn, note: project.note };
  }

  /** A work order keeps its length when only its start moves. */
  private productionEnd(start: string, endDay: unknown, current: { start: string | null; end: string | null }) {
    if (isDay(endDay)) { if (endDay < start) throw new BadRequestException("The finish can't be before the start."); return endDay; }
    return current.start && current.end ? plusDays(start, Math.max(0, daysBetween(current.start, current.end))) : start;
  }

  /** Writes the day on its source record, through the same rules the project, the factory and the deal use. */
  private async writeDay(client: Db, workspaceId: string, subject: Subject, day: string | null, endDay: string | null,
    current: Awaited<ReturnType<LogisticsService["current"]>>, user: ActorUser, rights: Rights) {
    if (subject.kind === "permit") {
      if (current.permitId) await client.query(`UPDATE building_permits SET collect_on = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, current.permitId, day]);
      else {
        const id = subject.permitId ?? randomUUID();
        if ((await client.query(`SELECT 1 FROM building_permits WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) throw new ConflictException("This permit collection is already closed.");
        if ((await client.query(`SELECT 1 FROM building_permits WHERE workspace_id = $1 AND (project_id = $2::uuid OR opportunity_id = $3::uuid) AND status = 'planned'`,
          [workspaceId, subject.projectId, subject.opportunityId])).rowCount)
          throw new ConflictException("A permit collection is already booked for this project. Move that one instead.");
        await client.query(`INSERT INTO building_permits (id, workspace_id, project_id, opportunity_id, status, collect_on, created_by) VALUES ($1, $2, $3, $4, 'planned', $5, $6)`,
          [id, workspaceId, subject.projectId, subject.opportunityId, day, user.userId]);
        subject.permitId = id;
      }
      await this.touch(client, workspaceId, subject);
      return;
    }
    if (!subject.projectId) {
      // A deal's delivery: the deal's own rules (won, not cancelled, the permit where the firm asks deals for one).
      await writeDealDelivery(client, { workspaceId, opportunityId: subject.opportunityId!, date: day, note: current.note, actorUserId: user.userId, actorName: user.displayName ?? "" });
      return;
    }
    const projectId = subject.projectId;
    if (subject.kind === "production") {
      if (!OPEN_ORDERS.includes(current.status)) throw new ConflictException("Only a planned, released or held work order can be moved.");
      await client.query(`UPDATE work_orders SET planned_start = $3, planned_end = $4, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, subject.workOrderId, day, endDay]);
      return;
    }
    const team = (await readTeam(client, workspaceId, [projectId])).get(projectId) ?? [];
    const installers = installationRoles(await readStages(client, workspaceId, [projectId]));
    const told = team.filter((member) => member.lead || member.roles.some((role) => installers.includes(role))).map((member) => member.membershipId);
    if (subject.kind === "delivery" || subject.kind === "installation") {
      const days = { deliveryOn: subject.kind === "delivery" ? day : current.deliveryOn, installationOn: subject.kind === "installation" ? day : current.installationOn, note: current.note };
      await writeInstallationDays(client, { workspaceId, projectId, days, actorUserId: user.userId, canClear: rights.clear, team: told, deliveryAlone: true });
    } else {
      await writeFactorySlot(client, { workspaceId, projectId, slot: day, note: "", actorUserId: user.userId, canClear: rights.clear,
        leads: team.filter((member) => member.lead).map((member) => member.membershipId) });
    }
    await this.touch(client, workspaceId, subject);
  }

  private async assertActive(client: Db, workspaceId: string, input: { workers: string[]; crewId: string | null; vehicleId: string | null }) {
    const workers = [...new Set(input.workers)];
    if (workers.length && (await client.query(`SELECT 1 FROM hrms_workers WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND active`, [workspaceId, workers])).rowCount !== workers.length)
      throw new UnprocessableEntityException("Choose active people.");
    if (input.crewId && !(await client.query(`SELECT 1 FROM hrms_crews WHERE workspace_id = $1 AND id = $2 AND active`, [workspaceId, input.crewId])).rowCount)
      throw new UnprocessableEntityException("Choose an active crew.");
    if (input.vehicleId && !(await client.query(`SELECT 1 FROM logistics_vehicles WHERE workspace_id = $1 AND id = $2 AND active`, [workspaceId, input.vehicleId])).rowCount)
      throw new UnprocessableEntityException("Choose an active vehicle.");
  }

  /** Double bookings of the candidate's people and vehicle, by name, with where else they are. */
  private async warnings(client: Db, workspaceId: string, candidate: { key: string; start: string; end: string; workerIds: string[]; driverId: string | null; vehicleId: string | null }) {
    const slots = await readSlots(client, workspaceId, candidate.start, plusDays(candidate.end, 1));
    const found = clashes(candidate, slots);
    if (!found.length) return [];
    const names = new Map<string, string>();
    for (const slot of slots) {
      for (const person of slot.people) names.set(person.id, person.name);
      if (slot.driver) names.set(slot.driver.id, slot.driver.name);
      if (slot.vehicle) names.set(slot.vehicle.id, slot.vehicle.name);
    }
    return found.map((clash) => ({ ...clash, name: names.get(clash.id) ?? "", whatLabel: KIND_LABEL[clash.what] }));
  }

  private async view(client: Db, workspaceId: string, subject: Subject, user: ActorUser) {
    const current = await this.current(client, workspaceId, subject, false);
    const permitId = subject.kind === "permit" ? subject.permitId ?? current.permitId : null;
    const key = slotKey(subject.kind, { projectId: subject.projectId, opportunityId: subject.opportunityId, workOrderId: subject.workOrderId, permitId });
    const slot: SlotView | undefined = current.start
      ? (await readSlots(client, workspaceId, current.start, plusDays(current.end ?? current.start, 1), subject.projectId ? { projectId: subject.projectId } : { opportunityId: subject.opportunityId! }))
        .find((item) => item.key === key)
      : undefined;
    const rights = await this.rights(client, workspaceId, subject, user);
    const owner = (subject.projectId ? { projectId: subject.projectId } : { opportunityId: subject.opportunityId! }) as PermitOwner;
    const permit = (subject.kind === "delivery" || subject.kind === "installation") && await permitRequired(client, workspaceId, owner)
      ? { required: true, permits: await readPermitFacts(client, workspaceId, owner) } : { required: false, permits: [] };
    return {
      kind: subject.kind, projectId: subject.projectId, opportunityId: subject.opportunityId, workOrderId: subject.workOrderId, permitId, project: await this.label(client, workspaceId, subject),
      start: current.start, end: current.end, assignmentId: slot?.assignmentId ?? null, version: slot?.version ?? 0, people: slot?.people ?? [], crew: slot?.crew ?? null,
      vehicle: slot?.vehicle ?? null, driver: slot?.driver ?? null, note: slot?.note ?? "", permit, canBook: rights.book, canClear: rights.clear,
    };
  }

  private async label(client: Db, workspaceId: string, subject: Pick<Subject, "projectId" | "opportunityId">) {
    if (subject.projectId) return (await client.query<{ label: string }>(`SELECT concat_ws(' · ', nullif(reference, ''), name) AS label FROM delivery_projects WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, subject.projectId])).rows[0]?.label ?? "";
    return (await client.query<{ label: string }>(
      `SELECT concat_ws(' · ', nullif(opportunity.reference, ''), coalesce(party.display_name, opportunity.title)) AS label FROM crm_opportunities opportunity
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`,
      [workspaceId, subject.opportunityId])).rows[0]?.label ?? "";
  }

  /** A deal's owner and the people who deliver orders: who hears about its permit. */
  private async dealOwner(client: Db, workspaceId: string, opportunityId: string) {
    const owner = (await client.query<{ userId: string }>(
      `SELECT member.user_id AS "userId" FROM crm_opportunities opportunity JOIN workspace_memberships member ON member.workspace_id = opportunity.workspace_id
          AND member.id = opportunity.owner_membership_id AND member.status = 'active' WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, opportunityId])).rows
      .map((row) => row.userId);
    return [...new Set([...owner, ...await permissionHolders(client, workspaceId, ["fulfilment.deliver"])])];
  }

  private async person(client: Db, workspaceId: string, id: string) {
    return (await client.query<{ id: string; name: string; phone: string; trade: string; crewId: string | null }>(
      `SELECT id, name, phone, trade, crew_id AS "crewId" FROM hrms_workers WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
  }

  private async settingsOf(client: Db, workspaceId: string) {
    const row = (await client.query<{ days: number; deal: boolean; reminder: number; version: number }>(
      `SELECT permit_warning_days AS days, deal_delivery_permit AS deal, permit_expiry_reminder_days AS reminder, version FROM workspace_logistics_settings WHERE workspace_id = $1`,
      [workspaceId])).rows[0];
    return { permitWarningDays: Number(row?.days ?? 3), dealDeliveryPermit: Boolean(row?.deal), permitExpiryReminderDays: Number(row?.reminder ?? 7), version: Number(row?.version ?? 0) };
  }

  private async vehiclesView(client: Db, workspaceId: string, userId: string) {
    const vehicles = (await client.query(
      `SELECT id, name, plate, kind, capacity_note AS "capacityNote", active, version FROM logistics_vehicles WHERE workspace_id = $1 ORDER BY active DESC, lower(name), id`, [workspaceId])).rows;
    const settings = await this.settingsOf(client, workspaceId);
    return { vehicles, permitWarningDays: settings.permitWarningDays, dealDeliveryPermit: settings.dealDeliveryPermit, permitExpiryReminderDays: settings.permitExpiryReminderDays,
      settingsVersion: settings.version,
      canManage: await this.any(client, workspaceId, userId, SETUP) };
  }

  private async permitsView(client: Db, workspaceId: string, owner: PermitOwner, user: ActorUser) {
    const facts = await readPermitFacts(client, workspaceId, owner);
    const ids = facts.map((fact) => fact.id);
    const permits = ids.length ? (await client.query(
      `SELECT permit.id, permit.status, permit.collect_on::text AS "collectOn", permit.permit_type AS "permitType", permit.permit_number AS "permitNumber",
              permit.valid_from::text AS "validFrom", permit.valid_to::text AS "validTo", permit.collected_on::text AS "collectedOn", worker.name AS "collectedBy", permit.note,
              permit.file_name AS "fileName", permit.file_mime AS "fileMime", recorder.display_name AS "recordedBy", permit.recorded_at AS "recordedAt",
              permit.reminder_days AS "reminderDays", permit.expiry_reminded_at AS "remindedAt", permit.version
         FROM building_permits permit LEFT JOIN hrms_workers worker ON worker.workspace_id = permit.workspace_id AND worker.id = permit.collected_by_worker_id
         LEFT JOIN users recorder ON recorder.id = permit.recorded_by
        WHERE permit.workspace_id = $1 AND permit.id = ANY($2::uuid[]) ORDER BY permit.created_at DESC, permit.id`, [workspaceId, ids])).rows : [];
    const days = owner.projectId
      ? (await client.query<{ deliveryOn: string | null; installationOn: string | null }>(
        `SELECT delivery_on::text AS "deliveryOn", installation_on::text AS "installationOn" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, owner.projectId])).rows[0]
      : { deliveryOn: (await client.query<{ on: string | null }>(`SELECT delivery_on::text AS on FROM crm_deal_fulfilment WHERE workspace_id = $1 AND opportunity_id = $2`,
        [workspaceId, owner.opportunityId])).rows[0]?.on ?? null, installationOn: null };
    const today = await this.today(client, workspaceId);
    const rights = await this.rights(client, workspaceId, { kind: "permit", projectId: owner.projectId ?? null, opportunityId: owner.opportunityId ?? null, workOrderId: null, permitId: null }, user);
    const first = [days?.deliveryOn, days?.installationOn].filter((day): day is string => Boolean(day)).sort()[0] ?? null;
    // When each recorded permit reminds before it ends (its own days, else the firm's).
    const reminderDefault = await permitReminderDays(client, workspaceId);
    for (const permit of permits as Array<Record<string, unknown>>)
      permit.reminderOn = permit.status === "collected" && typeof permit.validTo === "string" ? permitReminderOn(permit.validTo, (permit.reminderDays as number | null) ?? null, reminderDefault) : null;
    return { reminderDays: reminderDefault, required: await permitRequired(client, workspaceId, owner), deliveryOn: days?.deliveryOn ?? null, installationOn: days?.installationOn ?? null, today, permits,
      valid: permitCollected(facts, [days?.deliveryOn ?? null, days?.installationOn ?? null], today), covering: first ? permitFor(facts, first)?.id ?? null : null, canRecord: rights.book };
  }

  private async today(client: Db, workspaceId: string) {
    return (await client.query<{ today: string }>(
      `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.today ?? new Date().toISOString().slice(0, 10);
  }

  private async day(client: Db, workspaceId: string, day: string) {
    const locale = (await client.query<{ locale: string | null }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale || "en";
    try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T00:00:00Z`)); } catch { return day; }
  }
}
