import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { WorkspaceAccessService } from "./workspace-access.service";
import { DOCUMENT_TYPES, previewNumber, validateSequence, validateTaxRates, type SequenceInput, type TaxModel, type TaxRateInput } from "./tax-numbering.domain";

const READ = ["legal_entities.view", "finance.settings.manage"];
const WRITE = "finance.settings.manage";
const DEFAULT_SHORT: Record<string, string> = { QUOTATION: "QUO", INVOICE: "INV", PURCHASE_ORDER: "PO" };

type Entity = { id: string; code: string; countryCode: string; currency: string; timezone: string; taxRegistrationNumber: string | null };

/** Tax (from the entity's country model) and document numbering per legal entity. */
@Injectable()
export class TaxNumberingService {
  constructor(private readonly access: WorkspaceAccessService) {}

  get(actor: RequestActor, workspaceId: string, entityId: string) {
    return this.access.withAnyPermission(actor, workspaceId, READ, async (client) => this.read(client, workspaceId, entityId));
  }

  saveTax(actor: RequestActor, workspaceId: string, entityId: string, input: { version?: number; pricesIncludeTax: boolean; rates: TaxRateInput[] }) {
    return this.access.withPermission(actor, workspaceId, WRITE, async (client, actorUser) => {
      const entity = await this.entity(client, workspaceId, entityId, true);
      const model = await this.taxModel(client, entity.countryCode);
      const rates = validateTaxRates(model, input.rates ?? []);
      const current = await this.currentTax(client, workspaceId, entityId);
      if (current && input.version !== current.version) throw new ConflictException("Tax settings changed; reload and try again");
      const unchanged = current && current.pricesIncludeTax === Boolean(input.pricesIncludeTax)
        && JSON.stringify(current.rates.map(({ code, label, rate, isDefault }) => ({ code, label, rate: String(Number(rate)), isDefault })))
          === JSON.stringify(rates.map((rate) => ({ ...rate, rate: String(Number(rate.rate)) })));
      if (unchanged) return this.read(client, workspaceId, entityId);
      // Effective-dated: close the current profile and rates, open new ones. Issued documents keep theirs.
      if (current) {
        await client.query(`UPDATE tax_rates SET effective_to = now() WHERE workspace_id = $1 AND tax_profile_id = $2 AND effective_to IS NULL`, [workspaceId, current.id]);
        await client.query(`UPDATE tax_profiles SET effective_to = now(), updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, current.id]);
      }
      const profile = await client.query<{ id: string }>(
        `INSERT INTO tax_profiles (workspace_id, legal_entity_id, name, jurisdiction_code, scheme, prices_include_tax, effective_from, version)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7) RETURNING id`,
        [workspaceId, entityId, model.label ?? "Tax", entity.countryCode, model.model, Boolean(input.pricesIncludeTax), (current?.version ?? 0) + 1],
      );
      for (const rate of rates) {
        await client.query(
          `INSERT INTO tax_rates (workspace_id, tax_profile_id, code, label, rate, is_default, created_by) VALUES ($1, $2, $3, $4, $5::numeric, $6, $7)`,
          [workspaceId, profile.rows[0].id, rate.code, rate.label, rate.rate, rate.isDefault, actorUser.userId],
        );
      }
      await recordAudit(client, { workspaceId, actorUserId: actorUser.userId, action: "finance.tax_settings_changed", entityType: "legal_entity", entityId,
        before: current ? { pricesIncludeTax: current.pricesIncludeTax, rates: current.rates } : null, after: { pricesIncludeTax: Boolean(input.pricesIncludeTax), rates } });
      return this.read(client, workspaceId, entityId);
    });
  }

  saveNumbering(actor: RequestActor, workspaceId: string, entityId: string, documentType: string, input: SequenceInput & { version?: number }) {
    return this.access.withPermission(actor, workspaceId, WRITE, async (client, actorUser) => {
      if (!(DOCUMENT_TYPES as readonly string[]).includes(documentType)) throw new NotFoundException("Unknown document type");
      const entity = await this.entity(client, workspaceId, entityId, true);
      const found = await client.query<{ id: string; prefix: string; padding: number; resetPolicy: "never" | "annual"; nextNumber: number; currentPeriod: number | null; version: number }>(
        `SELECT id, prefix, padding, reset_policy AS "resetPolicy", next_number AS "nextNumber", current_period AS "currentPeriod", version
         FROM document_sequences WHERE workspace_id = $1 AND legal_entity_id = $2 AND document_type = $3 FOR UPDATE`,
        [workspaceId, entityId, documentType],
      );
      const before = found.rows[0];
      if (before && input.version !== before.version) throw new ConflictException("Numbering changed; reload and try again");
      const next = validateSequence(input, { nextNumber: before?.nextNumber ?? 1, currentPeriod: before?.currentPeriod ?? null });
      if (before) {
        await client.query(
          `UPDATE document_sequences SET prefix = $3, padding = $4, reset_policy = $5, next_number = $6, version = version + 1, updated_at = now()
           WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, before.id, next.prefix, next.padding, next.resetPolicy, next.nextNumber],
        );
      } else {
        await client.query(
          `INSERT INTO document_sequences (workspace_id, legal_entity_id, document_type, prefix, padding, reset_policy, next_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [workspaceId, entity.id, documentType, next.prefix, next.padding, next.resetPolicy, next.nextNumber],
        );
      }
      await recordAudit(client, { workspaceId, actorUserId: actorUser.userId, action: "finance.numbering_changed", entityType: "legal_entity", entityId,
        before: before ?? null, after: { documentType, ...next } });
      return this.read(client, workspaceId, entityId);
    });
  }

  private async read(client: PoolClient, workspaceId: string, entityId: string) {
    const entity = await this.entity(client, workspaceId, entityId, false);
    const model = await this.taxModel(client, entity.countryCode);
    const tax = await this.currentTax(client, workspaceId, entityId);
    const sequences = await client.query<{ documentType: string; prefix: string; padding: number; resetPolicy: "never" | "annual"; nextNumber: number; currentPeriod: number | null; version: number }>(
      `SELECT document_type AS "documentType", prefix, padding, reset_policy AS "resetPolicy", next_number AS "nextNumber",
              current_period AS "currentPeriod", version FROM document_sequences WHERE workspace_id = $1 AND legal_entity_id = $2`,
      [workspaceId, entityId],
    );
    const year = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: entity.timezone }).format(new Date()));
    return {
      entity: { id: entity.id, countryCode: entity.countryCode, currency: entity.currency, taxRegistrationNumber: entity.taxRegistrationNumber },
      taxModel: model,
      // null means "not configured": never shown as 0%.
      tax: tax ? { version: tax.version, pricesIncludeTax: tax.pricesIncludeTax, rates: tax.rates } : null,
      numbering: DOCUMENT_TYPES.map((documentType) => {
        const row = sequences.rows.find((sequence) => sequence.documentType === documentType);
        const value = row ?? { documentType, prefix: `${entity.code}-${DEFAULT_SHORT[documentType]}-{YYYY}-`, padding: 5, resetPolicy: "annual" as const, nextNumber: 1, currentPeriod: null, version: 0 };
        const next = value.resetPolicy === "annual" && value.currentPeriod !== null && value.currentPeriod !== year ? 1 : value.nextNumber;
        return { ...value, exists: Boolean(row), preview: previewNumber(value.prefix, value.padding, next, year) };
      }),
    };
  }

  private async entity(client: PoolClient, workspaceId: string, entityId: string, lock: boolean): Promise<Entity> {
    const result = await client.query<Entity>(
      `SELECT id, code, country_code AS "countryCode", base_currency AS currency, timezone, tax_registration_number AS "taxRegistrationNumber"
       FROM legal_entities WHERE workspace_id = $1 AND id = $2 AND status = 'active' ${lock ? "FOR UPDATE" : ""}`,
      [workspaceId, entityId],
    );
    if (!result.rowCount) throw new NotFoundException("Legal entity not found");
    return result.rows[0];
  }

  private async taxModel(client: PoolClient, countryCode: string): Promise<TaxModel> {
    const result = await client.query<{ tax: TaxModel | null }>(
      `SELECT configuration->'tax' AS tax FROM tenant_setup_profiles WHERE kind = 'region' AND code = $1 ORDER BY version DESC LIMIT 1`,
      [countryCode],
    );
    // A country without a region pack yet is treated as "tax model unknown": rates can still be set.
    return result.rows[0]?.tax ?? { model: "unknown", label: "Tax", registrationLabel: "Tax registration number" };
  }

  private async currentTax(client: PoolClient, workspaceId: string, entityId: string) {
    const profile = await client.query<{ id: string; version: number; pricesIncludeTax: boolean }>(
      `SELECT id, version, prices_include_tax AS "pricesIncludeTax" FROM tax_profiles
       WHERE workspace_id = $1 AND legal_entity_id = $2 AND status = 'active' AND effective_to IS NULL`,
      [workspaceId, entityId],
    );
    if (!profile.rowCount) return null;
    const rates = await client.query<{ code: string; label: string; rate: string; isDefault: boolean }>(
      `SELECT code, label, rate::text AS rate, is_default AS "isDefault" FROM tax_rates
       WHERE workspace_id = $1 AND tax_profile_id = $2 AND effective_to IS NULL ORDER BY is_default DESC, label`,
      [workspaceId, profile.rows[0].id],
    );
    return { ...profile.rows[0], rates: rates.rows };
  }
}
