import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../purchasing/orders";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { readTradeRates, tradeKey, tradeName } from "./labour-rates";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;

/**
 * Settings → Projects → Labour rates: what a day of each trade on site costs, from a date. The trades on
 * site reports that have no rate are listed too, so their days can be priced. Setting a rate from the same
 * date again replaces it (version-checked); setting it from another date adds to the history.
 */
@Injectable()
export class LabourRatesService {
  constructor(private readonly access: WorkspaceAccessService) {}

  read(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["workspace.settings.manage", "commercial.costs.view"], async (client, user) => this.view(client, workspaceId, user.userId));
  }

  command(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "workspace.settings.manage", async (client, user) => {
      if (body.action === "save") await this.save(client, workspaceId, body, user.userId);
      else if (body.action === "remove") await this.remove(client, workspaceId, body, user.userId);
      else throw new BadRequestException("Unknown action.");
      return this.view(client, workspaceId, user.userId);
    });
  }

  /** A trade's day rate from a date; the same rate sent again changes nothing. */
  private async save(client: Db, workspaceId: string, body: Record<string, unknown>, userId: string) {
    const trade = tradeName(typeof body.trade === "string" ? body.trade : "");
    if (!trade) throw new BadRequestException("Name the trade.");
    if (trade.length > 80) throw new BadRequestException("The trade's name is too long (up to 80 characters).");
    const from = typeof body.from === "string" && DATE.test(body.from) && !Number.isNaN(Date.parse(`${body.from}T00:00:00Z`)) ? body.from : null;
    if (!from) throw new BadRequestException("Say from which day the rate applies.");
    const currency = (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].currency;
    const rate = typeof body.dayRate === "number" ? String(body.dayRate) : typeof body.dayRate === "string" ? body.dayRate.trim() : "";
    if (!NUMBER.test(rate)) throw new BadRequestException("Enter the day rate as an amount.");
    if (Dec.of(rate).round(currencyDecimals(currency)).cmp(rate) !== 0) throw new BadRequestException(`The day rate has more decimals than ${currency} uses.`);
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('labour-rate:' || $1::text || ':' || $2::text, 0))`, [workspaceId, tradeKey(trade)]);
    const current = (await client.query<{ id: string; trade: string; rate: string; currency: string; version: number }>(
      `SELECT id, trade, day_rate::text AS rate, currency, version FROM workspace_labour_rates WHERE workspace_id = $1 AND lower(trade) = lower($2) AND effective_from = $3 FOR UPDATE`,
      [workspaceId, trade, from])).rows[0];
    if (current && current.trade === trade && current.currency === currency && Dec.of(current.rate).cmp(rate) === 0) return;
    if ((current?.version ?? 0) !== body.version) throw new ConflictException("Someone else changed this rate. Reload to see their change.");
    if (current)
      await client.query(`UPDATE workspace_labour_rates SET trade = $3, day_rate = $4, currency = $5, updated_by = $6, updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, current.id, trade, rate, currency, userId]);
    else
      await client.query(`INSERT INTO workspace_labour_rates (id, workspace_id, trade, effective_from, day_rate, currency, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), workspaceId, trade, from, rate, currency, userId]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "project.labour_rate_set", entityType: "workspace", entityId: workspaceId,
      before: current ? { trade: current.trade, from, dayRate: current.rate, currency: current.currency } : undefined, after: { trade, from, dayRate: rate, currency } });
  }

  /** A rate set by mistake; the days it covered fall back to the rate before it (or none). Already gone, nothing changes. */
  private async remove(client: Db, workspaceId: string, body: Record<string, unknown>, userId: string) {
    if (typeof body.id !== "string" || !UUID.test(body.id)) throw new BadRequestException("Rate is not valid.");
    const current = (await client.query<{ trade: string; from: string; rate: string; version: number }>(
      `SELECT trade, effective_from::text AS "from", day_rate::text AS rate, version FROM workspace_labour_rates WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, body.id])).rows[0];
    if (!current) return;
    if (current.version !== body.version) throw new ConflictException("Someone else changed this rate. Reload to see their change.");
    await client.query(`DELETE FROM workspace_labour_rates WHERE workspace_id = $1 AND id = $2`, [workspaceId, body.id]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "project.labour_rate_removed", entityType: "workspace", entityId: workspaceId,
      before: { trade: current.trade, from: current.from, dayRate: current.rate } });
  }

  private async view(client: Db, workspaceId: string, userId: string) {
    const workspace = (await client.query<{ currency: string; today: string }>(
      `SELECT default_currency AS currency, (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
    if (!workspace) throw new NotFoundException("Workspace not found.");
    const rates = await readTradeRates(client, workspaceId);
    const used = (await client.query<{ trade: string; reports: number }>(
      `SELECT min(btrim(trade)) AS trade, count(DISTINCT report_id)::int AS reports FROM site_report_workforce WHERE workspace_id = $1
        GROUP BY lower(regexp_replace(btrim(trade), '\\s+', ' ', 'g'))`, [workspaceId])).rows;
    // One row per trade however it was typed, named as its rates name it.
    const trades = new Map<string, { key: string; name: string; reports: number; rates: typeof rates }>();
    for (const rate of rates) {
      const row = trades.get(rate.key) ?? { key: rate.key, name: rate.trade, reports: 0, rates: [] };
      row.name = rate.trade;
      row.rates.push(rate);
      trades.set(rate.key, row);
    }
    for (const usage of used) {
      const key = tradeKey(usage.trade);
      const row = trades.get(key) ?? { key, name: tradeName(usage.trade), reports: 0, rates: [] };
      row.reports += usage.reports;
      trades.set(key, row);
    }
    return {
      currency: workspace.currency, today: workspace.today,
      trades: [...trades.values()].sort((a, b) => a.name.localeCompare(b.name)),
      canManage: await this.access.hasPermission(client, workspaceId, userId, "workspace.settings.manage"),
    };
  }
}
