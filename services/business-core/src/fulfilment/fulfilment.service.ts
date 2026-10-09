import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { permissionHolders } from "../project-core/project-release";
import { readCalendar } from "../project-core/work-calendar";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { fulfilmentPlan, type FulfilmentFacts } from "./deal-fulfilment";
import { dealRule, ensureRules, isFurnitureFlow, loadRules, parseRules, writeRules, type DealRule } from "./fulfilment-rules";
import { readReservations, releaseForDeal, shortOf } from "./stock-reservations";
import { writeDealDelivery } from "./deal-delivery";
import { permitCollected, permitFor } from "../logistics/logistics.domain";
import { readSlots } from "../logistics/logistics.store";
import { permitRequired, readPermitFacts } from "../logistics/permits";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VIEW = ["crm.opportunities.view", "fulfilment.deliver", "stock.manage"];
/** Who moves a won order along: sales and sales admin, project managers, and the people who keep stock. */
const FULFIL = ["crm.opportunities.manage", "projects.manage", "stock.manage"];
const BOQ = ["crm.opportunities.manage", "commercial.estimate"];
const SETTINGS = "crm.settings.manage";

/**
 * PLM-083 / PLM-126 on the deal: the order's BOQ choice, how it reaches the client on its path (transfer request,
 * supplier orders, production, the booked delivery, collection or delivery), when it's expected and whether it's
 * late, what stock it holds, and its cancellation. The deal is the record: no parallel global list. Commands are
 * validated, idempotent by command id, version-checked and audited.
 */
@Injectable()
export class FulfilmentService {
  constructor(private readonly access: WorkspaceAccessService) {}

  view(actor: RequestActor, workspaceId: string, opportunityId: string) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, (client, user) => this.read(client, workspaceId, uuid(opportunityId, "Deal"), user.userId));
  }

  command(actor: RequestActor, workspaceId: string, opportunityIdInput: string, body: Record<string, unknown>) {
    const opportunityId = uuid(opportunityIdInput, "Deal");
    return this.access.withAnyPermission(actor, workspaceId, [...new Set([...FULFIL, ...BOQ])], async (client, user) => {
      const action = String(body.action ?? "");
      const commandId = uuid(body.commandId, "Command");
      const can = (codes: string[]) => this.any(client, workspaceId, user.userId, codes);
      const first = Boolean((await client.query(`INSERT INTO fulfilment_commands (workspace_id, id, action, actor_id) VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, id) DO NOTHING`,
        [workspaceId, commandId, action.slice(0, 32), user.userId])).rowCount);
      if (!first) return this.read(client, workspaceId, opportunityId, user.userId);
      const rule = await dealRule(client, workspaceId, opportunityId);
      if (!rule) throw new NotFoundException("Deal not found.");
      await client.query(`INSERT INTO crm_deal_fulfilment (workspace_id, opportunity_id) VALUES ($1, $2) ON CONFLICT (workspace_id, opportunity_id) DO NOTHING`, [workspaceId, opportunityId]);
      const current = (await client.query<{ version: number; transferRequestedAt: Date | null; transferArrivedAt: Date | null; deliveryOn: string | null; cancelledAt: Date | null;
        boqRequired: boolean | null }>(
        `SELECT version, transfer_requested_at AS "transferRequestedAt", transfer_arrived_at AS "transferArrivedAt", delivery_on::text AS "deliveryOn", cancelled_at AS "cancelledAt",
                boq_required AS "boqRequired"
           FROM crm_deal_fulfilment WHERE workspace_id = $1 AND opportunity_id = $2 FOR UPDATE`, [workspaceId, opportunityId])).rows[0];
      if (body.version !== current.version) throw new ConflictException("Someone else changed this order. Reload to see their change.");
      if (current.cancelledAt) throw new ConflictException("This order is cancelled.");
      const set = async (sql: string, values: unknown[]) => client.query(
        `UPDATE crm_deal_fulfilment SET ${sql}, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, opportunityId, ...values]);
      const deal = await this.deal(client, workspaceId, opportunityId);
      let audit: Record<string, unknown> = {};
      if (action === "set_boq") {
        if (!(await can(BOQ))) throw new ForbiddenException("Only sales or the QS choose whether an order needs a BOQ.");
        const value = body.value === true ? true : body.value === false ? false : body.value === null ? null : undefined;
        if (value === undefined) throw new BadRequestException("Choose yes, no or the default.");
        await set(`boq_required = $3`, [value]);
        audit = { from: current.boqRequired, to: value };
      } else if (["request_transfer", "transfer_arrived", "book_delivery", "cancel"].includes(action)) {
        if (!(await can(action === "cancel" ? ["crm.opportunities.manage", "stock.manage"] : FULFIL))) throw new ForbiddenException("You can't move this order along.");
        if (rule.status !== "won") throw new ConflictException("The deal is won first: attach the payment proof.");
        const note = text(body.note ?? body.reason, action === "cancel" ? 1000 : 500, "Note");
        if (action === "request_transfer") {
          if (current.transferRequestedAt) throw new ConflictException("The transfer is already asked for.");
          await set(`transfer_requested_at = now(), transfer_requested_by = $3, transfer_note = $4`, [user.userId, note]);
          const items = (await readReservations(client, workspaceId, { opportunityId })).filter((row) => row.status !== "released").map((row) => row.itemName).slice(0, 3).join(", ");
          await this.tell(client, workspaceId, "fulfilment.transfer_requested", (await permissionHolders(client, workspaceId, ["factory.manage", "stock.manage"])).map((row) => row.userId),
            user.userId, `${opportunityId}:transfer`, { deal: deal.title, actor: user.displayName ?? "", items: items || deal.title, note }, opportunityId);
          audit = { note };
        } else if (action === "transfer_arrived") {
          if (!current.transferRequestedAt) throw new ConflictException("Ask the factory for the transfer first.");
          if (current.transferArrivedAt) return this.read(client, workspaceId, opportunityId, user.userId);
          await set(`transfer_arrived_at = now(), transfer_arrived_by = $3`, [user.userId]);
          audit = { note };
        } else if (action === "book_delivery") {
          const date = typeof body.date === "string" && DATE.test(body.date) && !Number.isNaN(Date.parse(`${body.date}T00:00:00Z`)) ? body.date : null;
          if (!date) throw new BadRequestException("Choose the delivery day.");
          if (current.deliveryOn === date) return this.read(client, workspaceId, opportunityId, user.userId);
          // PLM-136: where the firm asks deals for a building permit, the day needs one covering it. The drivers hear the day.
          await writeDealDelivery(client, { workspaceId, opportunityId, date, note, actorUserId: user.userId, actorName: user.displayName ?? "" });
          audit = { from: current.deliveryOn, to: date, note };
        } else {
          if (!note) throw new BadRequestException("Say why the order is cancelled.");
          await set(`cancelled_at = now(), cancelled_by = $3, cancel_reason = $4`, [user.userId, note]);
          audit = { reason: note, stockLines: await releaseForDeal(client, workspaceId, { opportunityId, reason: `Cancelled: ${note}`, actorUserId: user.userId }) };
        }
      } else throw new BadRequestException("Unknown action.");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `crm.deal.fulfilment.${action}`, entityType: "crm_opportunity", entityId: opportunityId, after: { commandId, ...audit } });
      return this.read(client, workspaceId, opportunityId, user.userId);
    });
  }

  /** Every enquiry type's rules per path (seeded from the product defaults on first read). */
  rules(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, SETTINGS, (client) => this.allRules(client, workspaceId));
  }

  /** Replaces one enquiry type's rules, version-checked against what the editor saw. */
  saveRules(actor: RequestActor, workspaceId: string, flowIdInput: string, body: Record<string, unknown>) {
    const flowId = uuid(flowIdInput, "Enquiry type");
    const parsed = parseRules(body.rules);
    if (typeof parsed === "string") throw new BadRequestException(parsed);
    return this.access.withPermission(actor, workspaceId, SETTINGS, async (client, user) => {
      if (!(await client.query(`SELECT 1 FROM crm_flows WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, flowId])).rowCount) throw new NotFoundException("Enquiry type not found.");
      for (const place of new Set(parsed.map((rule) => rule.takeFromLocationId).filter((id): id is string => Boolean(id))))
        if (!(await client.query(`SELECT 1 FROM stock_locations WHERE workspace_id = $1 AND id = $2 AND kind <> 'site' AND active`, [workspaceId, place])).rowCount)
          throw new BadRequestException("Choose a place where stock is kept.");
      const before = await ensureRules(client, workspaceId, flowId);
      const seen = before.map((rule) => `${rule.furniturePath ?? ""}:${rule.version}`).sort().join(",");
      const sent = Array.isArray(body.versions) ? (body.versions as unknown[]).map(String).sort().join(",") : null;
      if (sent !== seen) throw new ConflictException("Someone else changed these rules. Reload to see their change.");
      const keep = parsed.map((rule) => rule.furniturePath ?? "");
      await client.query(`DELETE FROM crm_flow_fulfilment_rules WHERE workspace_id = $1 AND flow_id = $2 AND NOT (coalesce(furniture_path, '') = ANY($3::text[]))`, [workspaceId, flowId, keep]);
      await writeRules(client, workspaceId, flowId, parsed, user.userId, true);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "crm.flow.fulfilment_rules_changed", entityType: "crm_flow", entityId: flowId, before, after: parsed });
      return this.allRules(client, workspaceId);
    });
  }

  private async allRules(client: Db, workspaceId: string) {
    const flows = (await client.query<{ id: string; name: string; types: string[] | null }>(
      `SELECT flow.id, flow.name,
              (SELECT array_agg(option.label ORDER BY option.position, option.label) FROM crm_taxonomy_options option
                 JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = option.workspace_id AND taxonomy.id = option.taxonomy_id AND taxonomy.code = 'enquiry_type'
                WHERE option.workspace_id = flow.workspace_id AND option.flow = flow.code AND option.status = 'active') AS types
         FROM crm_flows flow WHERE flow.workspace_id = $1 AND flow.status = 'active' ORDER BY flow.name`, [workspaceId])).rows;
    const out = [];
    for (const flow of flows) {
      const rules = await ensureRules(client, workspaceId, flow.id);
      out.push({ id: flow.id, name: flow.name, enquiryTypes: flow.types ?? [], furniture: await isFurnitureFlow(client, workspaceId, flow.id), rules });
    }
    const quotation = (await client.query<{ qsReview: boolean }>(`SELECT qs_review AS "qsReview" FROM workspace_quotation_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
    const places = (await client.query<{ id: string; name: string }>(`SELECT id, name FROM stock_locations WHERE workspace_id = $1 AND kind <> 'site' AND active ORDER BY is_default DESC, name`,
      [workspaceId])).rows;
    return { flows: out, places, qsReview: quotation?.qsReview ?? false };
  }

  // ---------- reading ----------
  private async read(client: Db, workspaceId: string, opportunityId: string, userId: string) {
    const rule = await dealRule(client, workspaceId, opportunityId);
    if (!rule) throw new NotFoundException("Deal not found.");
    const row = (await client.query<{ version: number; transferNote: string; transferRequestedAt: Date | null; transferBy: string | null; deliveryOn: string | null; deliveryNote: string;
      deliveryBy: string | null; cancelledAt: Date | null; cancelReason: string; cancelledBy: string | null }>(
      `SELECT deal.version, deal.transfer_note AS "transferNote", deal.transfer_requested_at AS "transferRequestedAt", requester.display_name AS "transferBy",
              deal.delivery_on::text AS "deliveryOn", deal.delivery_note AS "deliveryNote", booker.display_name AS "deliveryBy", deal.cancelled_at AS "cancelledAt",
              deal.cancel_reason AS "cancelReason", canceller.display_name AS "cancelledBy"
         FROM crm_deal_fulfilment deal LEFT JOIN users requester ON requester.id = deal.transfer_requested_by LEFT JOIN users booker ON booker.id = deal.delivery_booked_by
         LEFT JOIN users canceller ON canceller.id = deal.cancelled_by
        WHERE deal.workspace_id = $1 AND deal.opportunity_id = $2`, [workspaceId, opportunityId])).rows[0];
    const facts = await readFacts(client, workspaceId, rule);
    const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
      [workspaceId])).rows[0].today;
    const plan = rule.status === "won" ? fulfilmentPlan(rule.furniturePath, rule, facts, await readCalendar(client, workspaceId), today) : null;
    const reservations = (await readReservations(client, workspaceId, { opportunityId })).map((item) => ({ ...item, short: shortOf(item) }));
    const orders = (await client.query<{ id: string; number: string; status: string; supplierName: string; shipment: string | null; eta: string | null; trackingRef: string | null }>(
      `SELECT DISTINCT ON (purchase.id) purchase.id, purchase.number, purchase.status, vendor.display_name AS "supplierName", shipment.status AS shipment, shipment.eta::text AS eta,
              nullif(shipment.tracking_ref, '') AS "trackingRef"
         FROM purchase_order_lines line JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
         JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
         LEFT JOIN LATERAL (SELECT tracked.status, tracked.eta, tracked.tracking_ref FROM purchase_order_shipments tracked WHERE tracked.workspace_id = purchase.workspace_id
                             AND tracked.order_id = purchase.id AND tracked.status <> 'cancelled' ORDER BY tracked.updated_at DESC LIMIT 1) shipment ON true
        WHERE line.workspace_id = $1 AND line.opportunity_id = $2 ORDER BY purchase.id, purchase.created_at`, [workspaceId, opportunityId])).rows;
    // The order's items, from its quotation (the accepted one, else the latest on the table): what a supplier order is raised for.
    const items = rule.caseId ? (await client.query<{ id: string; title: string; quantity: string; unit: string; stockItemId: string | null }>(
      `SELECT line.id, line.title, line.quantity::text AS quantity, line.unit, stock.id AS "stockItemId"
         FROM commercial_quote_lines line
         JOIN LATERAL (SELECT quote.id FROM commercial_quotes quote WHERE quote.workspace_id = line.workspace_id AND quote.case_id = line.case_id AND quote.kind = 'quotation'
                        AND quote.status NOT IN ('superseded', 'withdrawn', 'declined') ORDER BY (quote.status = 'accepted') DESC, quote.number DESC LIMIT 1) chosen ON chosen.id = line.quote_id
         LEFT JOIN stock_items stock ON stock.workspace_id = line.workspace_id AND stock.catalog_item_id = line.catalog_item_id AND stock.active
        WHERE line.workspace_id = $1 AND line.case_id = $2 AND line.kind = 'item' AND line.quantity > 0 ORDER BY line.sort_order`, [workspaceId, rule.caseId])).rows : [];
    const can = {
      fulfil: rule.status === "won" && !rule.cancelledAt && await this.any(client, workspaceId, userId, FULFIL),
      boq: !rule.cancelledAt && await this.any(client, workspaceId, userId, BOQ),
      cancel: rule.status === "won" && !rule.cancelledAt && await this.any(client, workspaceId, userId, ["crm.opportunities.manage", "stock.manage"]),
      order: rule.status === "won" && !rule.cancelledAt && await this.any(client, workspaceId, userId, ["purchasing.manage"]),
    };
    return {
      opportunityId, status: rule.status, furniturePath: rule.furniturePath, projectId: rule.projectId, version: row?.version ?? 1,
      rule: { reserveOn: rule.reserveOn, deductOn: rule.deductOn, leadMinDays: rule.leadMinDays, leadMaxDays: rule.leadMaxDays, leadFrom: rule.leadFrom, leadFromCatalogue: rule.leadFromCatalogue,
        takeFromLocationId: rule.takeFromLocationId },
      boq: await boqView(client, workspaceId, rule),
      plan, reservations, orders, items,
      transfer: row?.transferRequestedAt ? { requestedAt: iso(row.transferRequestedAt), by: row.transferBy, note: row.transferNote, arrivedAt: facts.transfer.at } : null,
      delivery: row?.deliveryOn ? { on: row.deliveryOn, note: row.deliveryNote, by: row.deliveryBy, ...await this.crew(client, workspaceId, opportunityId, row.deliveryOn) } : null,
      // PLM-136: the building permit the delivery needs (on the deal, or its project), where the firm asks for one.
      permit: rule.furniturePath === "take_home_now" ? null : await this.permit(client, workspaceId, opportunityId, row?.deliveryOn ?? null, today),
      cancelled: row?.cancelledAt ? { at: iso(row.cancelledAt), reason: row.cancelReason, by: row.cancelledBy } : null,
      can,
    };
  }

  /** PLM-135: who goes on the delivery (people by name, the lead first), the vehicle and the driver. */
  private async crew(client: Db, workspaceId: string, opportunityId: string, day: string) {
    const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const slot = (await readSlots(client, workspaceId, day, next, { opportunityId })).find((item) => item.kind === "delivery");
    return { people: slot?.people ?? [], vehicle: slot?.vehicle ?? null, driver: slot?.driver ?? null, crewVersion: slot?.version ?? 0 };
  }

  private async permit(client: Db, workspaceId: string, opportunityId: string, deliveryOn: string | null, today: string) {
    const owner = { opportunityId };
    const facts = await readPermitFacts(client, workspaceId, owner);
    const covering = deliveryOn ? permitFor(facts, deliveryOn) : null;
    return { required: await permitRequired(client, workspaceId, owner), valid: permitCollected(facts, [deliveryOn], today), validTo: covering?.validTo ?? null,
      collected: facts.some((fact) => fact.status === "collected"), plannedId: facts.find((fact) => fact.status === "planned")?.id ?? null };
  }

  private async deal(client: Db, workspaceId: string, opportunityId: string) {
    return (await client.query<{ title: string; ownerId: string | null }>(
      `SELECT concat_ws(' · ', opportunity.reference, coalesce(party.display_name, opportunity.title)) AS title, owner.user_id AS "ownerId"
         FROM crm_opportunities opportunity LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
         LEFT JOIN workspace_memberships owner ON owner.workspace_id = opportunity.workspace_id AND owner.id = opportunity.owner_membership_id AND owner.status = 'active'
        WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, opportunityId])).rows[0] ?? { title: "", ownerId: null };
  }

  private async any(client: Db, workspaceId: string, userId: string, codes: string[]) {
    for (const code of codes) if (await this.access.hasPermission(client, workspaceId, userId, code)) return true;
    return false;
  }

  private async tell(client: Db, workspaceId: string, code: string, userIds: string[], actorId: string, key: string, variables: Record<string, string>, opportunityId: string) {
    for (const userId of new Set(userIds)) {
      if (userId === actorId) continue;
      const message = { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: `/workspace/crm/opportunities?record=${opportunityId}` };
      const idempotencyKey = `${code}:${key}:${userId}`.slice(0, 200);
      await notifyUserInApp(client, { ...message, idempotencyKey });
      await queueUserEmail(client, { ...message, idempotencyKey: `${idempotencyKey}:email` });
    }
  }
}

/**
 * The order's BOQ: its own choice, the path's (or type's) default, and what applies — the choice, else the default,
 * else the firm's quotation setting (QS review on or off).
 */
async function boqView(client: Db, workspaceId: string, rule: DealRule) {
  const rules = rule.flowId ? await loadRules(client, workspaceId, rule.flowId) : [];
  const own = (rule.furniturePath ? rules.find((item) => item.furniturePath === rule.furniturePath) : undefined) ?? rules.find((item) => item.furniturePath === null);
  const qsReview = (await client.query<{ qsReview: boolean }>(`SELECT qs_review AS "qsReview" FROM workspace_quotation_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.qsReview ?? false;
  const byDefault = own?.boqRequired ?? qsReview;
  return { chosen: rule.boqOverride, byDefault, required: rule.boqOverride ?? byDefault };
}

const iso = (value: Date | string | null | undefined) => (value instanceof Date ? value.toISOString() : value ?? null);

/** The records a deal's fulfilment is read from: Won, collection and delivery, the transfer, supplier orders and production. */
export async function readFacts(db: Pick<PoolClient, "query">, workspaceId: string, rule: DealRule): Promise<FulfilmentFacts> {
  const row = (await db.query<{
    wonAt: Date | null; collectedAt: Date | null; deliveredAt: Date | null; transferAt: Date | null; transferDone: Date | null;
    deliveryOn: string | null; deliveryBookedAt: Date | null; placed: number; firstPlacedAt: Date | null; received: number; lastReceivedAt: Date | null; cancelledAt: Date | null;
    catalogueDays: number | null;
  }>(
    `SELECT coalesce((SELECT min(proposal.won_at) FROM crm_opportunity_proposals proposal WHERE proposal.workspace_id = opportunity.workspace_id AND proposal.opportunity_id = opportunity.id),
                     CASE WHEN opportunity.status = 'won' THEN opportunity.closed_at END) AS "wonAt",
            (SELECT min(event.recorded_at) FROM crm_deal_fulfilment_events event WHERE event.workspace_id = opportunity.workspace_id AND event.opportunity_id = opportunity.id AND event.event = 'collected') AS "collectedAt",
            (SELECT min(event.recorded_at) FROM crm_deal_fulfilment_events event WHERE event.workspace_id = opportunity.workspace_id AND event.opportunity_id = opportunity.id AND event.event = 'delivered') AS "deliveredAt",
            deal.transfer_requested_at AS "transferAt", deal.transfer_arrived_at AS "transferDone",
            deal.delivery_on::text AS "deliveryOn", deal.delivery_booked_at AS "deliveryBookedAt", deal.cancelled_at AS "cancelledAt",
            coalesce(orders.placed, 0) AS placed, orders."firstPlacedAt", coalesce(orders.received, 0) AS received, orders."lastReceivedAt",
            (SELECT max(greatest(coalesce(catalog.production_days, 0), coalesce((SELECT max(link.lead_time_days) FROM catalog_supplier_links link
                                                                                   WHERE link.workspace_id = catalog.workspace_id AND link.item_id = catalog.id), 0)))
               FROM commercial_quote_lines line JOIN catalog_items catalog ON catalog.workspace_id = line.workspace_id AND catalog.id = line.catalog_item_id
               JOIN commercial_quotes quote ON quote.workspace_id = line.workspace_id AND quote.case_id = line.case_id AND quote.id = line.quote_id
              WHERE line.workspace_id = opportunity.workspace_id AND line.case_id = $3::uuid AND quote.kind = 'quotation'
                AND quote.status NOT IN ('superseded', 'withdrawn', 'declined', 'draft')) AS "catalogueDays"
       FROM crm_opportunities opportunity
       LEFT JOIN crm_deal_fulfilment deal ON deal.workspace_id = opportunity.workspace_id AND deal.opportunity_id = opportunity.id
       LEFT JOIN LATERAL (
         SELECT count(DISTINCT purchase.id) FILTER (WHERE purchase.status IN ('approved', 'sent', 'confirmed', 'partly_received', 'received', 'closed'))::int AS placed,
                min(purchase.approved_at) AS "firstPlacedAt",
                count(DISTINCT purchase.id) FILTER (WHERE purchase.status IN ('received', 'closed'))::int AS received,
                (SELECT max(receipt.created_at) FROM goods_receipts receipt WHERE receipt.workspace_id = opportunity.workspace_id AND receipt.order_id = ANY(array_agg(purchase.id))) AS "lastReceivedAt"
           FROM purchase_order_lines line JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
          WHERE line.workspace_id = opportunity.workspace_id AND line.opportunity_id = opportunity.id AND purchase.status <> 'cancelled') orders ON true
      WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, rule.opportunityId, rule.caseId])).rows[0];
  const made = rule.projectId ? (await db.query<{ drawingApprovedAt: Date | null; slotOn: string | null; slotAt: Date | null; total: number; started: number; ready: number;
    firstStartedAt: Date | null; lastReadyAt: Date | null }>(
    // The drawing is approved when a work order records it, or when the client approves the project's technical drawings (Scope › Drawings).
    `SELECT least((SELECT min(work.drawing_approved_at) FROM work_orders work WHERE work.workspace_id = project.workspace_id AND work.project_id = project.id AND work.status <> 'cancelled'),
                  (SELECT min(revision.decided_at) FROM project_drawing_revisions revision WHERE revision.workspace_id = project.workspace_id AND revision.project_id = project.id
                      AND revision.status = 'approved')) AS "drawingApprovedAt",
            project.factory_slot_on::text AS "slotOn", project.factory_slot_at AS "slotAt",
            count(work.id) FILTER (WHERE work.status <> 'cancelled')::int AS total,
            count(work.id) FILTER (WHERE work.started_at IS NOT NULL AND work.status <> 'cancelled')::int AS started,
            count(work.id) FILTER (WHERE work.status IN ('ready', 'short_closed'))::int AS ready,
            min(work.started_at) AS "firstStartedAt", max(work.ready_at) AS "lastReadyAt"
       FROM delivery_projects project LEFT JOIN work_orders work ON work.workspace_id = project.workspace_id AND work.project_id = project.id
      WHERE project.workspace_id = $1 AND project.id = $2 GROUP BY project.id`, [workspaceId, rule.projectId])).rows[0] : undefined;
  return {
    wonAt: iso(row?.wonAt), collectedAt: iso(row?.collectedAt), deliveredAt: iso(row?.deliveredAt),
    transfer: { requestedAt: iso(row?.transferAt), at: iso(row?.transferDone) },
    deliveryOn: row?.deliveryOn ?? null, deliveryBookedAt: iso(row?.deliveryBookedAt),
    supplierOrders: { placed: row?.placed ?? 0, firstPlacedAt: iso(row?.firstPlacedAt), received: row?.received ?? 0, lastReceivedAt: iso(row?.lastReceivedAt) },
    production: { projectId: rule.projectId, drawingApprovedAt: iso(made?.drawingApprovedAt), slotOn: made?.slotOn ?? null, slotAt: iso(made?.slotAt), total: made?.total ?? 0,
      started: made?.started ?? 0, ready: made?.ready ?? 0, firstStartedAt: iso(made?.firstStartedAt), lastReadyAt: iso(made?.lastReadyAt) },
    catalogueDays: row?.catalogueDays ?? null, cancelledAt: iso(row?.cancelledAt),
  };
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} is not valid.`);
  return value;
}

function text(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadRequestException(`${label} is not valid.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequestException(`${label} is too long (up to ${max} characters).`);
  return trimmed;
}
