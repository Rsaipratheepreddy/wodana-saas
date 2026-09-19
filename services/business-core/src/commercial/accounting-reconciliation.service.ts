import {
  Injectable,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { CommercialService } from "./commercial.service";
import { object, text } from "./commercial.domain";
import { verifiedInvoiceSnapshot } from "./accounting-invoice";
import {
  recordProviderSettlement,
  reverseProviderSettlement,
  upsertProviderInvoiceDocument,
} from "./finance-ledger";
const actor = "00000000-0000-4000-8000-000000000000";
@Injectable()
export class AccountingReconciliationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly commercial: CommercialService,
  ) {}
  async claim() {
    const jobs = await this.db.query(
      `WITH due AS(SELECT id FROM commercial_reconciliation_jobs WHERE next_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_at FOR UPDATE SKIP LOCKED LIMIT 20) UPDATE commercial_reconciliation_jobs j SET lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1 FROM due WHERE due.id=j.id RETURNING j.id,j.workspace_id AS "workspaceId",j.case_id AS "caseId",j.payment_id AS "paymentId",j.connection_id AS "connectionId",j.invoice_id AS "invoiceId",j.provider,j.lease_token AS "leaseToken"`,
    );
    return { jobs: jobs.rows };
  }
  async finish(input: unknown) {
    const b = object(input),
      id = text(b.id, 80, true),
      token = text(b.leaseToken, 80, true);
    const found = await this.db.query(
      `SELECT workspace_id AS "workspaceId",case_id AS "caseId" FROM commercial_reconciliation_jobs WHERE id=$1 AND lease_token=$2 AND lease_until>now()`,
      [id, token],
    );
    if (!found.rowCount)
      throw new ConflictException(
        "This reconciliation lease expired or was already completed.",
      );
    const w = found.rows[0].workspaceId,
      c = found.rows[0].caseId;
    return this.db.tenantTransaction(w, actor, async (client) => {
      await client.query(
        "SELECT id FROM pre_project_cases WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [w, c],
      );
      const jobs = await client.query(
        `SELECT * FROM commercial_reconciliation_jobs WHERE id=$1 AND lease_token=$2 AND lease_until>now() FOR UPDATE`,
        [id, token],
      );
      if (!jobs.rowCount)
        throw new ConflictException("This reconciliation job changed.");
      const job = jobs.rows[0],
        d = await this.commercial.load(client, w, c),
        p = d.payments.find((p) => p.id === job.payment_id);
      if (
        !p?.invoice ||
        p.invoice.id !== job.invoice_id ||
        p.invoice.connectionId !== job.connection_id
      )
        throw new NotFoundException("The linked invoice changed.");
      const checkedAt = new Date().toISOString();
      let error = text(b.error ?? "", 300);
      if (!p.invoice.accountId)
        error =
          "Confirm the accounting company for this existing invoice link before automatic reconciliation.";
      if (!error) {
        const snapshot = object(b.invoice);
        const q =
          d.quotes.find((q) => q.id === p.sourceQuoteId) ??
          d.quotes.find(
            (q) => q.kind === "quotation" && q.status === "accepted",
          );
        try {
          const verified = verifiedInvoiceSnapshot(snapshot, {
            id: job.invoice_id,
            amount: p.amount,
            currency: q?.currency ?? "",
            accountId: p.invoice.accountId,
          });
          const settled = verified.settled;
          Object.assign(p.invoice, {
            total: verified.total,
            balance: verified.balance,
            status: verified.status,
            paymentUrl: verified.paymentUrl,
            refreshedAt: checkedAt,
            lastError: "",
            checkedAt,
          });
          upsertProviderInvoiceDocument(
            d,
            p,
            {
              provider: job.provider,
              connectionId: job.connection_id,
              providerDocumentId: job.invoice_id,
              number: p.invoice.number,
              total: verified.total,
              status: verified.status,
            },
            checkedAt,
          );
          if (settled) {
            recordProviderSettlement(
              d,
              p,
              {
                provider: job.provider,
                connectionId: job.connection_id,
                providerDocumentId: job.invoice_id,
                reference: p.invoice.number || job.invoice_id,
              },
              "Accounting provider",
              checkedAt,
            );
          } else {
            const wasVerified = p.status === "verified";
            const reversed = reverseProviderSettlement(
              d,
              p,
              "The accounting provider no longer reports this invoice as settled.",
              checkedAt,
            );
            if (wasVerified || reversed) {
            // Settlement reversal reopens the financial account, without changing accepted physical handovers.
            await client.query(
              `UPDATE project_execution SET content=jsonb_set(jsonb_set(jsonb_set(content,'{financeClosed}','false'::jsonb),'{financeEvidence}',to_jsonb('Accounting balance reopened; review settlement.'::text)),'{revision}',to_jsonb(revision+1)),revision=revision+1,updated_at=now() WHERE workspace_id=$1 AND project_id IN(SELECT id FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2)`,
              [w, c],
            );
            }
          }
        } catch {
          error =
            "Provider invoice identity, currency, amount or balance did not match the linked milestone.";
        }
      }
      if (error) {
        p.invoice.lastError = error;
        p.invoice.checkedAt = checkedAt;
      }
      await this.commercial.persist(
        client,
        w,
        c,
        d,
        "Accounting reconciliation",
        error ? "invoice_refresh_failed" : "invoice_reconciled",
        undefined,
        error || `${job.provider} · ${job.invoice_id}`,
      );
      await client.query(
        `UPDATE commercial_reconciliation_jobs SET lease_token=NULL,lease_until=NULL,next_at=now()+CASE WHEN $3='' THEN interval '15 minutes' ELSE interval '5 minutes' END,last_error=NULLIF($3,'') WHERE id=$1 AND workspace_id=$2`,
        [id, w, error],
      );
      return { reconciled: !error };
    });
  }
}
