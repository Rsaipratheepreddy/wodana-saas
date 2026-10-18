import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { tellClients } from "../client-portal/portal-notices";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { currencyDecimals, firstTime } from "../purchasing/orders";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { readInvoiceLines, readInvoices, readMilestonePaid, readMilestones, splitMilestone, withBalances, type Milestone } from "./receivables";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Receivables: tax invoices issued for projects' payment milestones, credited in full when they need
 * correcting, and what clients paid on them (from the finance-verified receipts the deal records).
 */
@Injectable()
export class ReceivablesService {
  constructor(private readonly access: WorkspaceAccessService) {}

  overview(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "receivables.view", async (client, user) => {
      const today = await this.today(client, workspaceId);
      const milestones = (await readMilestones(client, workspaceId)).filter((item) => !item.invoiceId);
      const paid = await readMilestonePaid(client, workspaceId, milestones);
      // When each payment's client was last reminded (Send reminder, or the automatic schedule).
      const reminded = new Map((await client.query<{ caseId: string; paymentId: string; sentOn: string; channel: string }>(
        `SELECT DISTINCT ON (case_id, payment_id) case_id AS "caseId", payment_id AS "paymentId", sent_on::text AS "sentOn", channel
           FROM crm_payment_reminders WHERE workspace_id = $1 ORDER BY case_id, payment_id, sent_on DESC`, [workspaceId])).rows
        .map((row) => [`${row.caseId}|${row.paymentId}`, { on: row.sentOn, channel: row.channel }]));
      const lastReminder = (caseId: string, paymentId: string) => reminded.get(`${caseId}|${paymentId}`) ?? null;
      return {
        invoices: (await withBalances(client, workspaceId, await readInvoices(client, workspaceId), today)).map((invoice) => ({ ...invoice, lastReminder: lastReminder(invoice.caseId, invoice.paymentId) })),
        // Milestones still to invoice, with anything already paid on them.
        toInvoice: milestones.map((item) => ({ ...item, paid: (paid.get(`${item.caseId}|${item.paymentId}`) ?? Dec.ZERO).toFixed(4), lastReminder: lastReminder(item.caseId, item.paymentId) })),
        canManage: await this.access.hasPermission(client, workspaceId, user.userId, "receivables.manage"),
      };
    });
  }

  invoice(actor: RequestActor, workspaceId: string, invoiceId: string) {
    return this.access.withPermission(actor, workspaceId, "receivables.view", async (client, user) => this.detail(client, workspaceId, uuid(invoiceId, "Invoice"), user.userId));
  }

  /** What an invoice for a milestone would say, before it's issued. */
  preview(actor: RequestActor, workspaceId: string, caseId: string, paymentId: string) {
    return this.access.withPermission(actor, workspaceId, "receivables.manage", async (client) => {
      return this.draft(client, workspaceId, uuid(caseId, "Case"), text(paymentId, 80, "Milestone"));
    });
  }

  command(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    const action = body.action;
    if (action !== "issue" && action !== "credit") throw new BadRequestException("Unknown action.");
    return this.access.withPermission(actor, workspaceId, "receivables.manage", async (client, user) => {
      const id = uuid(body.id, "Invoice");
      if (!(await firstTime(client, workspaceId, uuid(body.commandId, "Command"), id, `receivables_${action}`, user.userId))) return this.detail(client, workspaceId, id, user.userId);
      if (action === "issue") await this.issue(client, workspaceId, user.userId, id, body);
      else await this.credit(client, workspaceId, user.userId, id, body);
      return this.detail(client, workspaceId, id, user.userId);
    });
  }

  /**
   * Issues the tax invoice for a milestone: numbered by its company's invoice sequence, split by the
   * sealed quotation's tax rates, with the client and the company as they are today. A milestone has one
   * live invoice; issuing it again (the same id) changes nothing.
   */
  private async issue(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    if ((await client.query(`SELECT 1 FROM client_invoices WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) return;
    const caseId = uuid(body.caseId, "Case"), paymentId = text(body.paymentId, 80, "Milestone");
    // One milestone is invoiced once at a time.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('receivables:' || $1::text || ':' || $2::text, 0))`, [caseId, paymentId]);
    const draft = await this.draft(client, workspaceId, caseId, paymentId);
    const { milestone } = draft;
    if (milestone.invoiceNumber) throw new ConflictException(`Tax invoice ${milestone.invoiceNumber} is already issued for this milestone.`);
    const today = await this.today(client, workspaceId);
    const issueDate = body.issueDate ? date(body.issueDate, "Invoice date") : today;
    if (issueDate > today) throw new BadRequestException("An invoice date can't be in the future.");
    const dueDate = body.dueDate ? date(body.dueDate, "Due date") : milestone.dueDate && milestone.dueDate > issueDate ? milestone.dueDate : issueDate;
    if (dueDate < issueDate) throw new BadRequestException("The due date can't be before the invoice date.");
    const customerTaxNumber = text(body.customerTaxNumber, 80, "Client tax number");
    const note = text(body.note, 1000, "Note");
    await client.query(
      `INSERT INTO document_sequences (workspace_id, legal_entity_id, document_type, prefix, padding, reset_policy, next_number)
       SELECT $1, entity.id, 'INVOICE', entity.code || '-INV-{YYYY}-', 5, 'annual', 1 FROM legal_entities entity WHERE entity.workspace_id = $1 AND entity.id = $2
       ON CONFLICT (legal_entity_id, document_type) DO NOTHING`, [workspaceId, draft.legalEntityId]);
    const number = (await client.query<{ number: string }>(`SELECT allocate_document_number($1, $2, 'INVOICE', $3::date::timestamptz) AS number`,
      [workspaceId, draft.legalEntityId, issueDate])).rows[0].number;
    await client.query(
      `INSERT INTO client_invoices (id, workspace_id, legal_entity_id, project_id, case_id, payment_id, quote_id, number, issue_date, due_date, currency, net, tax, total, prices_include_tax,
                                    milestone_title, customer_name, customer_address, customer_tax_number, company_name, company_address, company_tax_number, note, issued_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
      [id, workspaceId, draft.legalEntityId, milestone.projectId, caseId, paymentId, milestone.quoteId, number, issueDate, dueDate, draft.currency, draft.net, draft.tax, draft.total,
        draft.pricesIncludeTax, milestone.title.slice(0, 200), draft.customer.name.slice(0, 240), draft.customer.address, customerTaxNumber, draft.company.name, draft.company.address,
        draft.company.taxNumber, note, userId]);
    for (const [position, line] of draft.lines.entries())
      await client.query(`INSERT INTO client_invoice_lines (id, workspace_id, invoice_id, position, description, tax_rate, net, tax, total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [randomUUID(), workspaceId, id, position, line.description, line.rate, line.net, line.tax, line.total]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "client_invoice.issued", entityType: "client_invoice", entityId: id,
      after: { number, projectId: milestone.projectId, caseId, paymentId, issueDate, dueDate, currency: draft.currency, total: draft.total } });
    // The client hears an invoice is due (in the portal's Payments, once per invoice).
    await tellClients(client, { workspaceId, caseId, event: "invoice_issued", recordId: id, title: number, due: dueDate });
  }

  /**
   * Credits an invoice in full with a numbered credit note and why. The milestone can then be invoiced
   * again; what the client already paid stays on the milestone.
   */
  private async credit(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    await client.query(`SELECT 1 FROM client_invoices WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id]);
    const invoice = (await readInvoices(client, workspaceId, { id }))[0];
    if (!invoice) throw new NotFoundException("Invoice not found.");
    if (body.version !== invoice.version) throw new ConflictException("Someone else changed this invoice. Reload to see their change.");
    if (invoice.status !== "issued") throw new ConflictException("This invoice is already credited.");
    const reason = text(body.reason, 1000, "Reason");
    if (!reason) throw new BadRequestException("Say why the invoice is credited.");
    const today = await this.today(client, workspaceId);
    await client.query(
      `INSERT INTO document_sequences (workspace_id, legal_entity_id, document_type, prefix, padding, reset_policy, next_number)
       SELECT $1, entity.id, 'CREDIT_NOTE', entity.code || '-CN-{YYYY}-', 5, 'annual', 1 FROM legal_entities entity WHERE entity.workspace_id = $1 AND entity.id = $2
       ON CONFLICT (legal_entity_id, document_type) DO NOTHING`, [workspaceId, invoice.legalEntityId]);
    const number = (await client.query<{ number: string }>(`SELECT allocate_document_number($1, $2, 'CREDIT_NOTE') AS number`, [workspaceId, invoice.legalEntityId])).rows[0].number;
    await client.query(
      `INSERT INTO client_credit_notes (id, workspace_id, legal_entity_id, invoice_id, number, issue_date, currency, net, tax, total, reason, issued_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [randomUUID(), workspaceId, invoice.legalEntityId, id, number, today, invoice.currency, invoice.net, invoice.tax, invoice.total, reason, userId]);
    await client.query(`UPDATE client_invoices SET status = 'credited', version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "Someone";
    const amount = `${invoice.currency} ${Dec.of(invoice.total).toFixed(currencyDecimals(invoice.currency))}`;
    for (const person of invoice.projectId ? await this.projectManagers(client, workspaceId, invoice.projectId) : [])
      if (person !== userId)
        await notifyUserInApp(client, { workspaceId, recipientUserId: person, code: "receivables.credited", eventType: "receivables.credited",
          variables: { invoice: invoice.number, client: invoice.customerName, amount, actor, note: `${number}: ${reason}`.slice(0, 480) },
          deepLink: `/workspace/finance/client-invoices?invoice=${id}`, idempotencyKey: `receivables.credited:${id}:${person}` });
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "client_invoice.credited", entityType: "client_invoice", entityId: id, after: { creditNote: number, reason } });
  }

  /** The invoice a milestone would get: its company, currency, lines by tax rate, and the client and company details. */
  private async draft(client: Db, workspaceId: string, caseId: string, paymentId: string) {
    const milestone = (await readMilestones(client, workspaceId, { caseId, paymentId }))[0] as Milestone | undefined;
    if (!milestone) throw new NotFoundException("That milestone isn't on an accepted design quotation or a started project's accepted quotation.");
    // The tax split: a sealed quotation's rates; for the design fee (no seal), the accepted design quotation's rate,
    // exactly as its receipts are posted, so the invoice and the ledger agree to the minor unit.
    const seal = milestone.sealed ? (await client.query<{ currency: string; pricing: { total: string; taxes: Array<{ rate: string; base: string; tax: string }> }; includeTax: boolean | null }>(
      `SELECT currency, snapshot->'pricing' AS pricing, (snapshot->'quote'->>'pricesIncludeTax')::boolean AS "includeTax"
         FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2 AND quote_id = $3 ORDER BY sealed_at LIMIT 1`, [workspaceId, milestone.projectId, milestone.quoteId])).rows[0]
      : (await client.query<{ currency: string; total: string; rate: string; includeTax: boolean | null }>(
        `SELECT trim(currency) AS currency, total::text AS total, coalesce(tax_rate, 0)::text AS rate, (detail->'pricing'->>'pricesIncludeTax')::boolean AS "includeTax"
           FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, milestone.quoteId])).rows
        .map((quote) => ({ currency: quote.currency, includeTax: quote.includeTax,
          pricing: { total: quote.total, taxes: Dec.of(quote.rate).isZero() ? [] : [{ rate: quote.rate, base: quote.total, tax: "0" }] } }))[0];
    if (!seal) throw new NotFoundException("The milestone's quotation isn't there any more.");
    const currency = (milestone.currency ?? seal.currency).trim();
    if (currency !== seal.currency.trim()) throw new ConflictException(`The milestone is in ${currency} and its quotation in ${seal.currency.trim()}.`);
    // The contract's company; a deal kept before companies were recorded uses the only active one.
    let legalEntityId = milestone.legalEntityId;
    if (!legalEntityId) {
      const entities = (await client.query<{ id: string }>(`SELECT id FROM legal_entities WHERE workspace_id = $1 AND status = 'active' AND archived_at IS NULL`, [workspaceId])).rows;
      if (entities.length !== 1) throw new ConflictException("Record which company the contract is with before invoicing.");
      legalEntityId = entities[0].id;
    }
    const company = (await client.query<{ name: string; address: string; taxNumber: string }>(
      `SELECT coalesce(nullif(registered_name, ''), display_name) AS name,
              concat_ws(', ', nullif(address->>'line1', ''), nullif(address->>'line2', ''), nullif(address->>'city', ''), nullif(address->>'region', ''),
                        nullif(address->>'postalCode', ''), nullif(country_code, '')) AS address, coalesce(tax_registration_number, '') AS "taxNumber"
         FROM legal_entities WHERE workspace_id = $1 AND id = $2`, [workspaceId, legalEntityId])).rows[0];
    if (!company) throw new NotFoundException("Company not found.");
    const customer = (await client.query<{ name: string; address: string }>(
      `SELECT coalesce(party.display_name, opportunity.title) AS name,
              coalesce((SELECT concat_ws(', ', nullif(address.line1, ''), nullif(address.line2, ''), nullif(address.locality, ''), nullif(address.region, ''), nullif(address.postal_code, ''),
                                          nullif(address.country_code, ''))
                          FROM crm_addresses address WHERE address.workspace_id = party.workspace_id AND address.party_id = party.id
                         ORDER BY address.is_primary DESC, address.created_at LIMIT 1), '') AS address
         FROM pre_project_cases pre_case
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
        WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0];
    const groups = splitMilestone(milestone.amount, seal.pricing, currency);
    const lines = groups.map((group) => ({ ...group, description: groups.length > 1 ? `${milestone.title} (${Dec.of(group.rate).toString()}%)` : milestone.title }));
    const sum = (pick: (line: (typeof lines)[number]) => string) => lines.reduce((acc, line) => acc.add(pick(line)), Dec.ZERO).toFixed(4);
    return { milestone, legalEntityId, currency, lines, net: sum((line) => line.net), tax: sum((line) => line.tax), total: sum((line) => line.total), pricesIncludeTax: seal.includeTax ?? false,
      customer: { name: customer?.name ?? milestone.clientName, address: (customer?.address ?? "").slice(0, 1000) },
      company: { name: company.name.slice(0, 240), address: company.address.slice(0, 1000), taxNumber: company.taxNumber.slice(0, 80) } };
  }

  private async detail(client: Db, workspaceId: string, id: string, userId: string) {
    const invoice = (await withBalances(client, workspaceId, await readInvoices(client, workspaceId, { id }), await this.today(client, workspaceId)))[0];
    if (!invoice) throw new NotFoundException("Invoice not found.");
    const canManage = await this.access.hasPermission(client, workspaceId, userId, "receivables.manage");
    return { invoice, lines: await readInvoiceLines(client, workspaceId, id), canManage, canCredit: canManage && invoice.status === "issued" };
  }

  private async projectManagers(client: Db, workspaceId: string, projectId: string) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager`, [workspaceId, projectId])).rows.map((row) => row.userId);
  }

  private async today(client: Db, workspaceId: string) {
    return (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
  }
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

function date(value: unknown, label: string) {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}
