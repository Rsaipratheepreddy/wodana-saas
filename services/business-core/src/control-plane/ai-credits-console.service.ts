import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { applyCreditEntry, creditLimits, ensureCreditAccount, type CreditEntryType } from "../ai-gateway/ai-credits";
import { compareCredits, isCreditAmount, lowBalanceThreshold, normalizeCredits, toUnits } from "../ai-gateway/ai-credits.domain";
import { readCreditOverview } from "../ai-gateway/ai-credits.service";
import { aiModelFor, aiProviderName } from "../ai-gateway/ai-provider";
import { DatabaseService } from "../database/database.service";
import { resolveTenantRegistry, type TenantRegistry } from "./tenant-registry";

type DirectoryRow = {
  workspaceId: string; accountId: string | null; externalTenantId: string | null; name: string; slug: string; hasAccount: boolean;
  balance: string | null; lowBalanceThreshold: string | null; lastTopUpBalance: string | null;
  usedThisMonth: string; usedToday: string; lastTopUpCredits: string | null; lastTopUpAt: Date | null; aiEnabled: boolean;
};
type RateRow = {
  model: string; provider: string; label: string; listInput: string; listOutput: string; margin: string;
  inputPerMillion: string; outputPerMillion: string; priceConfirmed: boolean; active: boolean; version: number; updatedAt: Date;
};
const RATE_COLUMNS = `model, provider, label, list_input_usd_per_million::text AS "listInput", list_output_usd_per_million::text AS "listOutput",
  margin::text AS margin, input_credits_per_million::text AS "inputPerMillion", output_credits_per_million::text AS "outputPerMillion",
  price_confirmed AS "priceConfirmed", active, version, updated_at AS "updatedAt"`;
const MAX_CREDITS = 100_000_000n * 10_000n;

/** A positive (or, for adjustments, signed non-zero) credit amount within the ledger's range. */
function amount(value: string, signed: boolean) {
  if (!isCreditAmount(value)) throw new BadRequestException("Enter credits with up to four decimals.");
  const units = toUnits(value);
  if ((signed ? units === 0n : units <= 0n) || (units < 0n ? -units : units) > MAX_CREDITS) {
    throw new BadRequestException(signed ? "Enter a non-zero number of credits." : "Enter a positive number of credits.");
  }
  return normalizeCredits(value);
}

/**
 * AI credits in Wodana Control: every organization's balance and use, one organization's ledger, top-ups
 * recorded by the Wodana team (there is no payment gateway yet), adjustments and refunds, the low-balance
 * line, and the platform's model rates. Every change is idempotent or version-checked, and audited both
 * in the workspace and in the operator audit.
 */
@Injectable()
export class AiCreditsConsoleService {
  constructor(private readonly database: DatabaseService) {}

  async list(operatorUserId: string) {
    const limits = creditLimits();
    const { rows, platformUsed } = await this.database.actorTransaction(operatorUserId, async (client) => ({
      rows: (await client.query<DirectoryRow>(
        `SELECT workspace_id AS "workspaceId", account_id AS "accountId", external_tenant_id AS "externalTenantId", organization_name AS name, slug, has_account AS "hasAccount",
                balance::text AS balance, low_balance_threshold::text AS "lowBalanceThreshold", last_top_up_balance::text AS "lastTopUpBalance",
                used_this_month::numeric(14, 4)::text AS "usedThisMonth", used_today::numeric(14, 4)::text AS "usedToday",
                last_top_up_credits::text AS "lastTopUpCredits", last_top_up_at AS "lastTopUpAt", ai_enabled AS "aiEnabled"
           FROM control_plane_ai_credits() ORDER BY organization_name`)).rows,
      platformUsed: (await client.query<{ used: string }>(`SELECT ai_platform_usage_today()::text AS used`)).rows[0]?.used ?? "0.0000",
    }));
    const provider = aiProviderName();
    return {
      organizations: rows.map((row) => {
        const threshold = row.hasAccount ? lowBalanceThreshold({ lowBalanceThreshold: row.lowBalanceThreshold, lastTopUpBalance: row.lastTopUpBalance }) : null;
        const balance = row.balance ?? limits.welcome;
        return {
          workspaceId: row.workspaceId, accountId: row.accountId, key: row.externalTenantId ?? row.workspaceId, name: row.name, slug: row.slug, aiEnabled: row.aiEnabled,
          hasAccount: row.hasAccount, balance,
          state: compareCredits(balance, "0") <= 0 ? "exhausted" : threshold && compareCredits(balance, threshold) <= 0 ? "low" : "ok",
          usedThisMonth: row.usedThisMonth, usedToday: row.usedToday,
          lastTopUp: row.lastTopUpAt ? { credits: row.lastTopUpCredits, at: row.lastTopUpAt } : null,
        };
      }),
      platform: {
        usedToday: platformUsed, dailyLimit: limits.platformDaily, reached: compareCredits(platformUsed, limits.platformDaily) >= 0,
        workspaceDailyLimit: limits.workspaceDaily, welcomeCredits: limits.welcome,
        provider, model: provider ? aiModelFor(provider) : null,
      },
      observedAt: new Date().toISOString(),
    };
  }

  async organization(key: string, operatorUserId: string) {
    const registry = await resolveTenantRegistry(this.database, key);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, (client) => readCreditOverview(client, registry.workspaceId, { withOperatorNames: true }));
  }

  /** Records credits the organization paid for (invoice or payment note in the reference). */
  async topUp(key: string, input: { credits: string; reference: string; note?: string }, idempotencyKey: string | undefined, operatorUserId: string) {
    return this.entry(key, "top_up", amount(input.credits, false), input, idempotencyKey, operatorUserId);
  }

  /** A correction (signed) or credits given back for AI answers that went wrong (a refund). */
  async adjust(key: string, input: { kind: "adjustment" | "refund"; credits: string; reference: string; note?: string }, idempotencyKey: string | undefined, operatorUserId: string) {
    return this.entry(key, input.kind, amount(input.credits, input.kind === "adjustment"), input, idempotencyKey, operatorUserId);
  }

  /** The low-balance line: a number of credits, or null for 20% of the balance after the last top-up. */
  async setThreshold(key: string, input: { expectedVersion: number; threshold: string | null }, operatorUserId: string) {
    const registry = await resolveTenantRegistry(this.database, key);
    const threshold = input.threshold === null ? null : isCreditAmount(input.threshold) && toUnits(input.threshold) >= 0n ? normalizeCredits(input.threshold) : null;
    if (input.threshold !== null && threshold === null) throw new BadRequestException("Enter the credits at which owners are told.");
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      await ensureCreditAccount(client, registry.workspaceId);
      const current = await client.query<{ version: number; threshold: string | null }>(
        `SELECT version, low_balance_threshold::text AS threshold FROM ai_credit_accounts WHERE workspace_id = $1 FOR UPDATE`, [registry.workspaceId]);
      if (current.rows[0].version !== input.expectedVersion) throw new ConflictException("AI credits changed. Refresh and try again.");
      await client.query(
        `UPDATE ai_credit_accounts SET low_balance_threshold = $2::numeric, version = version + 1, updated_at = now(),
                -- A new line re-arms the low-balance notice.
                low_balance_notified_at = NULL
          WHERE workspace_id = $1`, [registry.workspaceId, threshold]);
      await this.audit(client, registry, operatorUserId, "ai.credit_threshold_changed", registry.workspaceId,
        { threshold: current.rows[0].threshold }, { threshold });
      return readCreditOverview(client, registry.workspaceId, { withOperatorNames: true });
    });
  }

  async rates(operatorUserId: string) {
    const rows = await this.database.actorTransaction(operatorUserId, (client) =>
      client.query<RateRow>(`SELECT ${RATE_COLUMNS} FROM ai_model_rates ORDER BY provider, input_credits_per_million, model`));
    const provider = aiProviderName();
    return { rates: rows.rows, inUse: provider ? { provider, model: aiModelFor(provider) } : null };
  }

  /** New list prices, margin or state for one model (the credits per million follow). */
  async setRate(model: string, input: { expectedVersion: number; listInput: string; listOutput: string; margin: string; priceConfirmed: boolean; active: boolean },
    operatorUserId: string) {
    for (const value of [input.listInput, input.listOutput, input.margin]) {
      if (!isCreditAmount(value) || toUnits(value) < 0n) throw new BadRequestException("Enter prices and the margin as positive numbers.");
    }
    if (toUnits(input.margin) <= 0n) throw new BadRequestException("The margin must be more than zero.");
    return this.database.actorTransaction(operatorUserId, async (client) => {
      const before = await client.query<RateRow>(`SELECT ${RATE_COLUMNS} FROM ai_model_rates WHERE model = $1`, [model]);
      if (!before.rowCount) throw new NotFoundException("Model rate was not found");
      const updated = await client.query<{ model: string }>(
        `SELECT model FROM control_plane_set_ai_model_rate($1, $2, $3::numeric, $4::numeric, $5::numeric, $6, $7)`,
        [model, input.expectedVersion, input.listInput, input.listOutput, input.margin, input.priceConfirmed, input.active]);
      if (!updated.rowCount) throw new ConflictException("This rate changed. Refresh and try again.");
      const after = (await client.query<RateRow>(`SELECT ${RATE_COLUMNS} FROM ai_model_rates WHERE model = $1`, [model])).rows[0];
      await client.query(
        `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
         VALUES ($1, 'ai.model_rate_changed', 'ai_model_rate', $2, $3, $4::jsonb)`,
        [operatorUserId, model, randomUUID(), JSON.stringify({ before: pick(before.rows[0]), after: pick(after) })]);
      return after;
    });
  }

  private async entry(key: string, entryType: CreditEntryType, credits: string, input: { reference: string; note?: string },
    idempotencyKey: string | undefined, operatorUserId: string) {
    if (!idempotencyKey || !/^[a-zA-Z0-9_-]{8,120}$/.test(idempotencyKey)) throw new BadRequestException("A request key is required.");
    const registry = await resolveTenantRegistry(this.database, key);
    return this.database.tenantTransaction(registry.workspaceId, operatorUserId, async (client) => {
      const { entry, replay } = await applyCreditEntry(client, {
        workspaceId: registry.workspaceId, entryType, credits, idempotencyKey: `operator:${idempotencyKey}`, createdBy: operatorUserId,
        reference: input.reference.trim(), note: input.note?.trim() || null,
      });
      if (!replay) {
        await this.audit(client, registry, operatorUserId, `ai.credits_${entryType}`, entry.id, null,
          { credits: entry.credits, balanceAfter: entry.balanceAfter, reference: entry.reference, note: entry.note });
      }
      return readCreditOverview(client, registry.workspaceId, { withOperatorNames: true });
    });
  }

  private async audit(client: PoolClient, registry: TenantRegistry, operatorUserId: string, action: string, entityId: string, before: unknown, after: Record<string, unknown>) {
    const correlationId = randomUUID();
    await client.query(
      `INSERT INTO audit_events (workspace_id, actor_user_id, source, action, entity_type, entity_id, before, after, correlation_id)
       VALUES ($1, $2, 'internal', $3, 'ai_credit_account', $4, $5::jsonb, $6::jsonb, $7)`,
      [registry.workspaceId, operatorUserId, action, entityId, before === null ? null : JSON.stringify(before), JSON.stringify(after), correlationId]);
    await client.query(
      `INSERT INTO platform_operator_audit (actor_user_id, action, target_type, target_id, correlation_id, details)
       VALUES ($1, $2, 'tenant', $3, $4, $5::jsonb)`,
      [operatorUserId, action, registry.externalTenantId, correlationId, JSON.stringify({ workspaceId: registry.workspaceId, before, after,
        reason: typeof after.reason === "string" ? after.reason : typeof after.reference === "string" ? after.reference : undefined })]);
  }
}

function pick(rate: RateRow) {
  return { listInput: rate.listInput, listOutput: rate.listOutput, margin: rate.margin, priceConfirmed: rate.priceConfirmed, active: rate.active };
}
