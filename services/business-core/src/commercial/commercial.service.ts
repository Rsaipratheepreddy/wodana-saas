import {
  importedScopeDetails,
  importedScopeCatalogLinks,
} from "./commercial-scope";
import { quotationTemplateContent } from "./quotation-template";
import { sameOffer, validateDeduction } from "./variation-controls";
import { releaseDeliveryProject } from "../projects/project-release";
import { verifiedInvoiceSnapshot } from "./accounting-invoice";
import {
  agreementIsOperational,
  isOperationalEvidence,
  materialApprovalsComplete,
  quotationApprovalSources,
  releasePaymentIsOperational,
} from "./release-integrity";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { ConfigService } from "@nestjs/config";
import {
  actionable,
  date,
  defaultBrand,
  editable,
  emptyCommercial,
  freezeHash,
  newRequest,
  number,
  object,
  parseBrand,
  parseCover,
  parseLines,
  parsePaymentTerms,
  phone,
  text,
  totals,
} from "./commercial.domain";
import type {
  CommercialData,
  CommercialState,
  PortalSettings,
  Quote,
  QuotationTemplate,
  CatalogSelection,
} from "./commercial.types";

@Injectable()
export class CommercialService {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly config: ConfigService,
  ) {}
  get testMode() {
    return (
      this.config.get("PORTAL_DEMO_OTP") === "true" &&
      this.config.get("NODE_ENV") !== "production"
    );
  }
  async caseRecord(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    lock = false,
  ) {
    const result = await client.query(
      `SELECT c.status,o.title,p.display_name AS "customerName",o.currency_code AS currency FROM pre_project_cases c JOIN crm_opportunities o ON o.workspace_id=c.workspace_id AND o.id=c.opportunity_id JOIN crm_parties p ON p.workspace_id=o.workspace_id AND p.id=o.party_id WHERE c.workspace_id=$1 AND c.id=$2 ${lock ? "FOR UPDATE OF c" : ""}`,
      [workspaceId, caseId],
    );
    if (!result.rowCount)
      throw new NotFoundException("Pre-execution not found.");
    return result.rows[0];
  }
  private async designReadiness(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    quote: Quote | undefined,
  ) {
    if (!quote) return { designsRequired: 0, designsApproved: 0 };
    let designsApproved = 0;
    for (const line of quote.lines) {
      const design = await client.query(
        `SELECT count(*)::int AS total,count(*) FILTER (WHERE v.status='approved' AND NOT EXISTS(SELECT 1 FROM pre_project_design_threads t WHERE t.workspace_id=v.workspace_id AND t.version_id=v.id AND t.blocking AND t.status='open'))::int AS approved FROM pre_project_item_design_refs r JOIN pre_project_design_versions v ON v.workspace_id=r.workspace_id AND v.id=r.design_version_id WHERE r.workspace_id=$1 AND r.case_id=$2 AND r.entry_id=$3 AND r.version=$4`,
        [workspaceId, caseId, line.scopeId, line.specificationVersion ?? 0],
      );
      const readiness = design.rows[0] as { total: number; approved: number };
      if (readiness.total > 0 && readiness.total === readiness.approved)
        designsApproved += 1;
    }
    return { designsRequired: quote.lines.length, designsApproved };
  }
  async load(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
  ): Promise<CommercialData> {
    const r = await client.query(
      "SELECT content FROM commercial_cases WHERE workspace_id=$1 AND case_id=$2",
      [workspaceId, caseId],
    );
    const stored = r.rows[0]?.content as Partial<CommercialData> | undefined;
    if (!stored) return emptyCommercial();
    return {
      ...emptyCommercial(),
      ...stored,
      ownerReview: stored.ownerReview ?? null,
      dealFile: stored.dealFile ?? null,
      materialApprovals: stored.materialApprovals ?? [],
    };
  }
  async persist(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    data: CommercialData,
    actor: string,
    action: string,
    quoteId?: string,
    note = "",
  ) {
    data.revision++;
    data.audit.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      actor,
      action,
      quoteId,
      note,
    });
    await client.query(
      `INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,$3,$4) ON CONFLICT(case_id) DO UPDATE SET revision=$3,content=$4,updated_at=now() WHERE commercial_cases.workspace_id=$1`,
      [workspaceId, caseId, data.revision, JSON.stringify(data)],
    );
    for (const payment of data.payments) {
      if (!payment.invoice) continue;
      const invoice = payment.invoice;
      await client.query(
        `INSERT INTO commercial_reconciliation_jobs(workspace_id,case_id,payment_id,connection_id,invoice_id,provider) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,case_id,payment_id) DO UPDATE SET connection_id=$4,invoice_id=$5,provider=$6`,
        [
          workspaceId,
          caseId,
          payment.id,
          invoice.connectionId,
          invoice.id,
          invoice.provider,
        ],
      );
    }
  }
  private async seedPreparationRooms(
    client: PoolClient,
    workspaceId: string,
    caseId: string,
    quote: Quote,
  ) {
    const rooms = (
      await client.query(
        `SELECT id,name,catalog_record_id AS "catalogRecordId",catalog_snapshot AS "catalogSnapshot"
         FROM pre_project_rooms WHERE workspace_id=$1 AND case_id=$2 ORDER BY created_at,id`,
        [workspaceId, caseId],
      )
    ).rows as Array<{
      id: string;
      name: string;
      catalogRecordId?: string | null;
      catalogSnapshot?: CatalogSelection["snapshot"] | null;
    }>;
    quote.rooms ??= [];
    for (const room of rooms) {
      if (
        quote.rooms.some(
          (value) =>
            value.id === room.id ||
            value.name.toLowerCase() === room.name.toLowerCase(),
        )
      )
        continue;
      quote.rooms.push({
        id: room.id,
        name: room.name,
        ...(room.catalogRecordId && room.catalogSnapshot
          ? {
              catalog: {
                role: "room",
                recordId: room.catalogRecordId,
                version: room.catalogSnapshot.version,
                snapshot: room.catalogSnapshot,
              },
            }
          : {}),
      });
    }
  }
  async settings(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(
      actor,
      workspaceId,
      "pre_projects.view",
      async (client, user) => {
        const saved = await client.query(
          'SELECT workspace_id AS "workspaceId",slug,enabled,version,brand FROM client_portal_settings WHERE workspace_id=$1',
          [workspaceId],
        );
        const workspace = await client.query(
          "SELECT name,slug FROM workspaces WHERE id=$1",
          [workspaceId],
        );
        return {
          ...(saved.rows[0] ?? {
            workspaceId,
            slug: workspace.rows[0].slug,
            enabled: false,
            version: 0,
            brand: defaultBrand(workspace.rows[0].name),
          }),
          testMode: this.testMode,
          canManage: await this.access.hasPermission(
            client,
            workspaceId,
            user.userId,
            "portal.manage",
          ),
        } as PortalSettings;
      },
    );
  }
  async saveSettings(actor: RequestActor, workspaceId: string, input: unknown) {
    return this.access.withPermission(
      actor,
      workspaceId,
      "portal.manage",
      async (client) => {
        const b = object(input),
          brand = parseBrand(b.brand),
          version = number(b.version),
          enabled = b.enabled === true;
        const workspace = await client.query(
          "SELECT slug FROM workspaces WHERE id=$1 FOR UPDATE",
          [workspaceId],
        );
        const current = await client.query(
          "SELECT version FROM client_portal_settings WHERE workspace_id=$1",
          [workspaceId],
        );
        if ((current.rows[0]?.version ?? 0) !== version)
          throw new ConflictException(
            "Settings changed. Reload before saving.",
          );
        await client.query(
          `INSERT INTO client_portal_settings(workspace_id,slug,enabled,version,brand) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id) DO UPDATE SET enabled=$3,version=$4,brand=$5,updated_at=now()`,
          [
            workspaceId,
            workspace.rows[0].slug,
            enabled,
            version + 1,
            JSON.stringify(brand),
          ],
        );
        if (!enabled)
          await client.query(
            "UPDATE client_portal_sessions SET revoked_at=now() WHERE workspace_id=$1",
            [workspaceId],
          );
        return {
          workspaceId,
          slug: workspace.rows[0].slug,
          enabled,
          version: version + 1,
          brand,
          testMode: this.testMode,
          canManage: true,
        };
      },
    );
  }
  async state(
    actor: RequestActor,
    workspaceId: string,
    caseId: string,
  ): Promise<CommercialState> {
    return this.access.withPermission(
      actor,
      workspaceId,
      "pre_projects.view",
      async (client, user) => {
        const record = await this.caseRecord(client, workspaceId, caseId);
        const data = await this.load(client, workspaceId, caseId);
        const accepted = data.quotes.find(
          (quote) => quote.kind === "quotation" && quote.status === "accepted",
        );
        const releaseReadiness = await this.designReadiness(
          client,
          workspaceId,
          caseId,
          accepted,
        );
        for (const quote of data.quotes) {
          if (
            quote.kind === "quotation" &&
            quote.status === "draft" &&
            quote.direction !== "deduction" &&
            !quote.rooms?.length &&
            !quote.lines.length
          )
            await this.seedPreparationRooms(client, workspaceId, caseId, quote);
        }
        const contacts = (
          await client.query(
            `SELECT id,name,phone,role,active,test_contact AS "testContact" FROM client_portal_grants WHERE workspace_id=$1 AND case_id=$2 ORDER BY created_at`,
            [workspaceId, caseId],
          )
        ).rows;
        const settings = await client.query(
          "SELECT slug,brand,enabled FROM client_portal_settings WHERE workspace_id=$1",
          [workspaceId],
        );
        return {
          workspaceId,
          caseId,
          ...record,
          data,
          contacts,
          portalSlug: settings.rows[0]?.slug ?? null,
          portalBrand: settings.rows[0]?.brand,
          portalEnabled: settings.rows[0]?.enabled ?? false,
          testMode: this.testMode,
          releaseReadiness,
          canEdit:
            ["active", "released"].includes(record.status) &&
            (await this.access.hasPermission(
              client,
              workspaceId,
              user.userId,
              "pre_projects.edit",
            )),
          canApprove: await this.access.hasPermission(
            client,
            workspaceId,
            user.userId,
            "commercial.approve",
          ),
          canRelease: await this.access.hasPermission(
            client,
            workspaceId,
            user.userId,
            "commercial.release",
          ),
          canManagePortal: await this.access.hasPermission(
            client,
            workspaceId,
            user.userId,
            "portal.manage",
          ),
        };
      },
    );
  }
  async contact(
    actor: RequestActor,
    workspaceId: string,
    caseId: string,
    input: unknown,
  ) {
    return this.access.withPermission(
      actor,
      workspaceId,
      "portal.manage",
      async (client, user) => {
        await this.caseRecord(client, workspaceId, caseId, true);
        const b = object(input);
        const mobile = phone(b.phone),
          name = text(b.name, 160, true),
          role = b.role === "approver" ? "approver" : "viewer";
        const old = (
          await client.query(
            "SELECT id FROM client_portal_grants WHERE workspace_id=$1 AND case_id=$2 AND phone=$3",
            [workspaceId, caseId, mobile],
          )
        ).rows[0];
        if (old) {
          const data = await this.load(client, workspaceId, caseId);
          if (
            data.quotes.some(
              (q) => q.status === "issued" && q.approverId === old.id,
            )
          )
            throw new ConflictException(
              "Withdraw the pending quotation before changing its approver access.",
            );
        }
        const active = b.active !== false;
        await client.query(
          `INSERT INTO client_portal_grants(workspace_id,case_id,name,phone,role,active,test_contact) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,case_id,phone) DO UPDATE SET name=$3,role=$5,active=$6,test_contact=$7`,
          [
            workspaceId,
            caseId,
            name,
            mobile,
            role,
            active,
            this.testMode && b.testContact === true,
          ],
        );
        // A change to any case grant invalidates all current portal sessions for this contact.
        await client.query(
          "UPDATE client_portal_sessions SET revoked_at=now() WHERE workspace_id=$1 AND phone=$2",
          [workspaceId, mobile],
        );
        const data = await this.load(client, workspaceId, caseId);
        await this.persist(
          client,
          workspaceId,
          caseId,
          data,
          user.displayName,
          "Client access updated",
          undefined,
          `${name}: ${active ? role : "access removed"}`,
        );
        return { ok: true };
      },
    );
  }
  async syncInvoice(
    actor: RequestActor,
    w: string,
    caseId: string,
    input: unknown,
    authorization: string,
  ) {
    const b = object(input),
      connectionId = text(b.connectionId, 80, true),
      invoiceId = text(b.invoiceId, 100, true),
      paymentId = text(b.paymentId, 80, true);
    if (
      !/^[0-9a-f-]{36}$/i.test(connectionId) ||
      !/^[a-zA-Z0-9]{1,100}$/.test(invoiceId)
    )
      throw new BadRequestException("Choose a valid connection and invoice.");
    const connection = await this.access.withPermissions(
      actor,
      w,
      ["pre_projects.view", "commercial.approve"],
      async (client) => {
        await this.caseRecord(client, w, caseId);
        const d = await this.load(client, w, caseId);
        if (!d.payments.some((p) => p.id === paymentId))
          throw new NotFoundException("Payment milestone not found.");
        const c = (
          await client.query(
            "SELECT provider,status,legal_entity_id,configuration FROM integration_connections WHERE workspace_id=$1 AND id=$2",
            [w, connectionId],
          )
        ).rows[0];
        if (
          !c ||
          !["quickbooks", "zoho_books"].includes(c.provider) ||
          c.status !== "connected" ||
          !c.legal_entity_id
        )
          throw new ConflictException(
            "Connect the accounting company in Workspace settings first.",
          );
        return c;
      },
    );
    const base =
      this.config.get<string>("INTELLIGENCE_API_URL") ??
      this.config.get<string>("NEXT_PUBLIC_INTELLIGENCE_API_URL") ??
      "http://127.0.0.1:8001/api/v1";
    const response = await fetch(
      `${base.replace(/\/$/, "")}/integrations/providers/workspaces/${w}/connections/${connectionId}/invoices/${invoiceId}`,
      { headers: { authorization }, signal: AbortSignal.timeout(20000) },
    ).catch(() => null);
    if (!response?.ok)
      throw new ConflictException(
        "Accounting could not verify this invoice. Check the connection and try again.",
      );
    const invoice = object(await response.json());
    return this.access.withPermissions(
      actor,
      w,
      ["pre_projects.view", "commercial.approve"],
      async (client, user) => {
        // One provider invoice can settle only one milestone across the workspace.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [`${w}:${connection.provider}:${invoice.accountId}:${invoiceId}`],
        );
        await this.caseRecord(client, w, caseId, true);
        const duplicate = await client.query(
          `SELECT cc.case_id FROM commercial_cases cc CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cc.content->'payments','[]'::jsonb)) AS p WHERE cc.workspace_id=$1 AND p->'invoice'->>'id'=$2 AND p->'invoice'->>'provider'=$3 AND (p->'invoice'->>'accountId'=$4 OR p->'invoice'->>'connectionId'=$5) AND NOT(cc.case_id=$6 AND p->>'id'=$7) LIMIT 1`,
          [
            w,
            invoiceId,
            connection.provider,
            invoice.accountId,
            connectionId,
            caseId,
            paymentId,
          ],
        );
        if (duplicate.rowCount)
          throw new ConflictException(
            "This invoice is already linked to another payment milestone. Choose that milestone to refresh it.",
          );
        const d = await this.load(client, w, caseId);
        if (b.revision !== d.revision)
          throw new ConflictException(
            "The payment schedule changed. Refresh and try again.",
          );
        const p = d.payments.find((p) => p.id === paymentId);
        if (!p) throw new NotFoundException("Payment milestone not found.");
        if (
          d.payments.some(
            (x) =>
              x.id !== p.id &&
              x.invoice?.connectionId === connectionId &&
              x.invoice.id === invoiceId,
          )
        )
          throw new ConflictException(
            "This invoice is already linked to another milestone.",
          );
        if (
          d.payments.some(
            (x) => x.invoice && x.invoice.connectionId !== connectionId,
          )
        )
          throw new ConflictException(
            "Use the same accounting company for this agreement.",
          );
        if (!p.invoice?.accountId && b.clientConfirmed !== true)
          throw new BadRequestException(
            "Confirm that this invoice belongs to the client and milestone.",
          );
        if (
          p.invoice &&
          (p.invoice.id !== invoiceId ||
            p.invoice.connectionId !== connectionId)
        )
          throw new ConflictException(
            "This milestone already has an accounting invoice. Resolve any replacement through a controlled commercial correction.",
          );
        const q =
          d.quotes.find((q) => q.id === p.sourceQuoteId) ??
          d.quotes.find(
            (q) => q.kind === "quotation" && q.status === "accepted",
          );
        const { total, balance, status, paymentUrl, settled } =
          verifiedInvoiceSnapshot(invoice, {
            id: invoiceId,
            amount: p.amount,
            currency: q?.currency ?? "",
            accountId: p.invoice?.accountId,
          });
        p.invoice = {
          accountId: text(invoice.accountId, 100, true),
          connectionId,
          provider: connection.provider,
          id: invoiceId,
          number: text(invoice.number ?? invoiceId, 100),
          customer: text(invoice.customerName ?? "", 240),
          total,
          balance,
          currency: q!.currency,
          status,
          paymentUrl,
          refreshedAt: new Date().toISOString(),
        };
        p.reference = p.invoice.number || invoiceId;
        if (settled) {
          p.status = "verified";
          p.verifiedBy = user.displayName;
          p.verifiedAt = new Date().toISOString();
        } else if (p.status === "verified") {
          p.status = "pending";
          delete p.verifiedBy;
          delete p.verifiedAt;
          await client.query(
            `UPDATE project_execution SET content=jsonb_set(jsonb_set(jsonb_set(content,'{financeClosed}','false'::jsonb),'{financeEvidence}',to_jsonb('Accounting balance reopened; review settlement.'::text)),'{revision}',to_jsonb(revision+1)),revision=revision+1,updated_at=now() WHERE workspace_id=$1 AND project_id IN(SELECT id FROM delivery_projects WHERE workspace_id=$1 AND case_id=$2)`,
            [w, caseId],
          );
        }
        await this.persist(
          client,
          w,
          caseId,
          d,
          user.displayName,
          "invoice_refreshed",
          undefined,
          `${connection.provider} · ${invoiceId}`,
        );
        return { data: d };
      },
    );
  }
  async paymentTemplates(actor: RequestActor, w: string) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (c) => ({
        items: (
          await c.query(
            "SELECT id,name,version,milestones FROM commercial_payment_templates WHERE workspace_id=$1 ORDER BY name",
            [w],
          )
        ).rows,
      }),
    );
  }
  async quotationTemplates(actor: RequestActor, w: string) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (c) => ({
        items: (
          await c.query(
            'SELECT id,name,version,content,updated_at AS "updatedAt" FROM commercial_quotation_templates WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 100',
            [w],
          )
        ).rows,
      }),
    );
  }
  async saveQuotationTemplate(actor: RequestActor, w: string, input: unknown) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.edit",
      async (c) => {
        const b = object(input),
          caseId = text(b.caseId, 80, true),
          name = text(b.name, 160, true);
        await this.caseRecord(c, w, caseId);
        const data = await this.load(c, w, caseId),
          quote = data.quotes.find((q) => q.id === text(b.quoteId, 80, true));
        if (!quote)
          throw new NotFoundException(
            "Save the quotation before making a template.",
          );
        if (quote.kind !== "quotation" || !quote.lines.length)
          throw new BadRequestException(
            "Use a quotation with at least one item as your template.",
          );
        const result = await c.query(
          'INSERT INTO commercial_quotation_templates(id,workspace_id,name,content) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,name) DO NOTHING RETURNING id,name,version,content,updated_at AS "updatedAt"',
          [
            randomUUID(),
            w,
            name,
            JSON.stringify(quotationTemplateContent(quote)),
          ],
        );
        if (!result.rowCount)
          throw new ConflictException(
            "A template with this name already exists. Choose another name.",
          );
        return result.rows[0];
      },
    );
  }
  async prepareQuotationTemplate(actor: RequestActor, w: string, id: string) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (c) => {
        const template: QuotationTemplate | undefined = (
          await c.query(
            'SELECT id,name,version,content,updated_at AS "updatedAt" FROM commercial_quotation_templates WHERE workspace_id=$1 AND id=$2',
            [w, id],
          )
        ).rows[0];
        if (!template)
          throw new NotFoundException("Quotation template not found.");
        const content = template.content,
          warnings = new Set<string>();
        const refs = [
          ...(content.rooms ?? []).flatMap((r) =>
            r.catalog ? [r.catalog] : [],
          ),
          ...content.lines.flatMap((l) => l.catalogLinks ?? []),
        ];
        const records = (
          await c.query(
            `SELECT r.id,r.name,r.code,r.kind,r.version,r.catalog_id AS "catalogId",c.name AS "catalogName",CASE WHEN r.kind='unit' THEN coalesce(r.content->'configuration','{}'::jsonb)||jsonb_build_object('symbol',coalesce(r.content->'configuration'->>'symbol',r.content->'aliases'->>0,r.code)) ELSE r.content->'configuration' END AS configuration FROM workspace_catalog_records r JOIN workspace_catalog_records c ON c.workspace_id=r.workspace_id AND c.id=r.catalog_id WHERE r.workspace_id=$1 AND r.id=ANY($2::uuid[]) AND NOT r.archived AND NOT c.archived`,
            [w, [...new Set(refs.map((r) => r.recordId))]],
          )
        ).rows;
        const selected = new Map(records.map((r) => [r.id, r]));
        const refresh = (ref: CatalogSelection): CatalogSelection | null => {
          const current = selected.get(ref.recordId);
          if (
            !current ||
            !(
              current.kind === ref.role ||
              (ref.role === "material" &&
                ["sku", "hardware", "consumable"].includes(current.kind))
            )
          ) {
            warnings.add(
              `${ref.snapshot.name} is unavailable. Its written specification is retained; choose a replacement if needed.`,
            );
            return null;
          }
          if (current.version !== ref.version)
            warnings.add(
              `${current.name} uses the latest catalog version. Review the specification; the template price is unchanged.`,
            );
          return {
            role: ref.role,
            recordId: current.id,
            version: current.version,
            snapshot: current,
          };
        };
        for (const room of content.rooms ?? [])
          if (room.catalog) room.catalog = refresh(room.catalog) ?? undefined;
        for (const line of content.lines) {
          const old = line.catalogLinks ?? [];
          line.catalogLinks = old.flatMap((ref) => {
            const current = refresh(ref);
            return current ? [current] : [];
          });
          for (const role of ["material", "finish"] as const) {
            const labels = (refs: CatalogSelection[]) =>
              refs
                .filter((r) => r.role === role)
                .map(
                  (r) =>
                    r.snapshot.name +
                    (r.snapshot.code ? ` · ${r.snapshot.code}` : ""),
                )
                .join("\n");
            const previous = labels(old),
              next = labels(line.catalogLinks);
            // Preserve unavailable products as written scope instead of silently deleting them.
            if (
              previous &&
              next &&
              old.filter((r) => r.role === role).length ===
                line.catalogLinks.filter((r) => r.role === role).length &&
              (line[role] === previous ||
                line[role].startsWith(previous + "\n\n"))
            )
              line[role] = next + line[role].slice(previous.length);
          }
          const unit = line.catalogLinks.find((r) => r.role === "unit");
          if (
            unit &&
            String(
              unit.snapshot.configuration?.symbol ?? unit.snapshot.code,
            ) !== line.unit
          ) {
            line.catalogLinks = line.catalogLinks.filter((r) => r !== unit);
            warnings.add(
              `The unit for ${line.title} changed in the catalog. The quoted unit and rate were preserved.`,
            );
          }
          const work = line.catalogLinks.find((r) => r.role === "work"),
            variant = line.catalogLinks.find((r) => r.role === "variant");
          if (variant) {
            const related = (
              await c.query(
                "SELECT target_id FROM workspace_catalog_links WHERE workspace_id=$1 AND record_id=$2 AND relation='work'",
                [w, variant.recordId],
              )
            ).rows;
            if (
              !work ||
              (related.length &&
                !related.some((r) => r.target_id === work.recordId))
            ) {
              line.catalogLinks = line.catalogLinks.filter(
                (r) => r !== variant,
              );
              warnings.add(
                `Choose a matching catalog variant for ${line.title}.`,
              );
            }
          }
        }
        return { template, warnings: [...warnings] };
      },
    );
  }
  async savePaymentTemplate(actor: RequestActor, w: string, input: unknown) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.edit",
      async (c) => {
        const b = object(input),
          name = text(b.name, 160, true),
          milestones = parsePaymentTerms(b.milestones, true),
          id = b.id ? text(b.id, 80, true) : randomUUID();
        const version = number(b.version ?? 0);
        const result = await c.query(
          `INSERT INTO commercial_payment_templates(id,workspace_id,name,version,milestones) VALUES($1,$2,$3,1,$4) ON CONFLICT(id) DO UPDATE SET name=$3,milestones=$4,version=commercial_payment_templates.version+1 WHERE commercial_payment_templates.workspace_id=$2 AND commercial_payment_templates.version=$5 RETURNING id,name,version,milestones`,
          [id, w, name, JSON.stringify(milestones), version],
        );
        if (!result.rowCount)
          throw new ConflictException(
            "Template changed. Reload before saving.",
          );
        return result.rows[0];
      },
    );
  }
  private async importIncludedScope(
    client: import("pg").PoolClient,
    workspaceId: string,
    caseId: string,
    q: Quote,
    refreshExisting = false,
  ) {
    const rows = await client.query(
      `SELECT e.id,e.version,e.title,e.note,e.quantity,e.unit,r.id AS room_id,r.catalog_record_id,r.catalog_snapshot,coalesce(r.name,'General') AS room,coalesce((SELECT jsonb_agg(jsonb_build_object('role',l.role,'recordId',l.record_id,'version',l.snapshot->'version','snapshot',l.snapshot)) FROM pre_project_scope_links l WHERE l.workspace_id=e.workspace_id AND l.entry_id=e.id),'[]') AS catalog_links,s.version AS specification_version,s.content AS specification FROM pre_project_brief_entries e LEFT JOIN pre_project_rooms r ON r.workspace_id=e.workspace_id AND r.id=e.room_id LEFT JOIN LATERAL(SELECT version,content FROM pre_project_item_specifications WHERE workspace_id=e.workspace_id AND entry_id=e.id AND case_id=e.case_id ORDER BY version DESC LIMIT 1)s ON true WHERE e.workspace_id=$1 AND e.case_id=$2 AND e.kind='requirement' AND e.scope_status='included' AND e.archived_at IS NULL`,
      [workspaceId, caseId],
    );
    for (const line of rows.rows) {
      const prior = q.lines.find((l) => l.scopeId === line.id);
      if (prior && !refreshExisting) continue;
      q.rooms ??= [];
      if (line.room_id && !q.rooms.some((r) => r.name === line.room))
        q.rooms.push({
          id: line.room_id,
          name: line.room,
          ...(line.catalog_snapshot
            ? {
                catalog: {
                  role: "room",
                  recordId: line.catalog_record_id,
                  version: line.catalog_snapshot.version,
                  snapshot: line.catalog_snapshot,
                },
              }
            : {}),
        });
      const next = {
        id: prior?.id ?? randomUUID(),
        room: line.room,
        title: line.title,
        ...importedScopeDetails({
          note: line.note,
          specification: line.specification,
          catalogLinks: line.catalog_links,
        }),
        quantity: Number(line.quantity ?? 1),
        unit: line.unit || "nos",
        unitCost: prior?.unitCost ?? 0,
        rate: prior?.rate ?? 0,
        ...(prior
          ? {
              materialRows: prior.materialRows,
              pricingMode: prior.pricingMode,
              photo: prior.photo,
              variant: prior.variant,
              customMaterials: prior.customMaterials,
            }
          : {}),
        catalogLinks: importedScopeCatalogLinks({
          catalogLinks: line.catalog_links,
          specification: line.specification,
        }),
        scopeId: line.id,
        scopeVersion: line.version,
        specificationVersion: line.specification_version ?? undefined,
      };
      if (next.catalogLinks.length > 12)
        throw new BadRequestException(
          `“${line.title}” has more than 12 catalog selections. Split its scope into separate items before importing.`,
        );
      if (prior) Object.assign(prior, next);
      else q.lines.push(next);
    }
    return rows.rowCount ?? 0;
  }
  catalogOptions(
    actor: RequestActor,
    w: string,
    caseId: string,
    q: Record<string, string>,
  ) {
    const kind = text(q.kind ?? "work", 30, true),
      search = text(q.search ?? "", 180),
      linked = text(q.linkedTo ?? "", 80),
      catalog = text(q.catalogId ?? "", 80);
    if (
      ![
        "room",
        "work",
        "variant",
        "material",
        "brand",
        "finish",
        "unit",
        "construction",
        "hardware",
      ].includes(kind)
    )
      throw new BadRequestException("Choose a catalog type.");
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (client) => {
        await this.caseRecord(client, w, caseId);
        return {
          items: (
            await client.query(
              `SELECT r.id,r.name,r.code,r.kind,r.version,r.catalog_id AS "catalogId",c.name AS "catalogName",CASE WHEN r.kind='unit' THEN coalesce(r.content->'configuration','{}'::jsonb)||jsonb_build_object('symbol',coalesce(r.content->'configuration'->>'symbol',r.content->'aliases'->>0,r.code)) ELSE r.content->'configuration' END AS configuration,r.content->>'description' AS description,
      coalesce((SELECT jsonb_agg(jsonb_build_object('role',l.relation,'recordId',t.id,'snapshot',jsonb_build_object('id',t.id,'name',t.name,'code',t.code,'kind',t.kind,'version',t.version,'catalogId',t.catalog_id,'catalogName',tc.name,'configuration',CASE WHEN t.kind='unit' THEN coalesce(t.content->'configuration','{}'::jsonb)||jsonb_build_object('symbol',coalesce(t.content->'configuration'->>'symbol',t.content->'aliases'->>0,t.code)) ELSE t.content->'configuration' END))) FROM workspace_catalog_links l JOIN workspace_catalog_records t ON t.workspace_id=l.workspace_id AND t.id=l.target_id JOIN workspace_catalog_records tc ON tc.workspace_id=t.workspace_id AND tc.id=t.catalog_id WHERE l.workspace_id=r.workspace_id AND l.record_id=r.id AND l.relation IN ('unit','work','variant','material','finish','brand','construction') AND NOT t.archived AND NOT tc.archived),'[]'::jsonb) AS links
      FROM workspace_catalog_records r JOIN workspace_catalog_records c ON c.workspace_id=r.workspace_id AND c.id=r.catalog_id WHERE r.workspace_id=$1 AND (r.kind=$2 OR ($2='material' AND r.kind IN ('sku','hardware','consumable'))) AND NOT r.archived AND NOT c.archived AND ($3='' OR strpos(lower(r.name||' '||r.code||' '||c.name),lower($3))>0) AND ($4='' OR r.catalog_id::text=$4) AND ($5='' OR EXISTS(SELECT 1 FROM workspace_catalog_links l WHERE l.workspace_id=r.workspace_id AND ((l.record_id=r.id AND l.target_id::text=$5) OR (l.target_id=r.id AND l.record_id::text=$5)))) ORDER BY r.name,r.id LIMIT 100`,
              [w, kind, search, catalog, linked],
            )
          ).rows,
        };
      },
    );
  }
  async masterCatalog(actor: RequestActor, w: string, caseId: string) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (client) => {
        await this.caseRecord(client, w, caseId);
        const result = await client.query(
          `SELECT id AS "catalogId" FROM workspace_catalog_records
        WHERE workspace_id=$1 AND kind='catalog_group' AND NOT archived
        ORDER BY CASE WHEN content->'attributes' @> '[{"name":"Default catalog","value":"true"}]'::jsonb THEN 0 ELSE 1 END,name,id LIMIT 1`,
          [w],
        );
        return result.rows[0] ?? {};
      },
    );
  }
  async catalogItemContext(
    actor: RequestActor,
    w: string,
    caseId: string,
    workId: string,
  ) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (client) => {
        await this.caseRecord(client, w, caseId);
        // Follow only the selected item's recipe, variants, materials, units and prices.
        // Never traverse room membership, which would expand into unrelated items.
        const catalogs = await client.query(
          `WITH RECURSIVE edges(source,target) AS (
        SELECT l.record_id,l.target_id FROM workspace_catalog_links l
        JOIN workspace_catalog_records r ON r.workspace_id=l.workspace_id AND r.id=l.record_id
        WHERE l.workspace_id=$1 AND (l.relation='unit'
          OR (r.kind IN ('work','variant','construction') AND l.relation IN ('material','sku','hardware','consumable','finish','construction'))
          OR (r.kind='construction' AND l.relation='variant'))
        UNION
        SELECT l.target_id,l.record_id FROM workspace_catalog_links l
        JOIN workspace_catalog_records r ON r.workspace_id=l.workspace_id AND r.id=l.record_id
        WHERE l.workspace_id=$1 AND ((r.kind IN ('construction','variant') AND l.relation='work')
          OR (r.kind='construction' AND l.relation='parent')
          OR (r.kind='rate_card' AND l.relation IN ('work','variant','material','sku','hardware','consumable','finish')))
      ), scoped(id) AS (
        SELECT r.id FROM workspace_catalog_records r JOIN workspace_catalog_records parent ON parent.workspace_id=r.workspace_id AND parent.id=r.catalog_id
        WHERE r.workspace_id=$1 AND r.id=$2 AND r.kind='work' AND NOT r.archived AND NOT parent.archived
        UNION SELECT e.target FROM scoped s JOIN edges e ON e.source=s.id
      )
      SELECT r.id,r.name,r.code,r.kind,r.version,r.catalog_id AS "catalogId",parent.name AS "catalogName",r.content
      FROM scoped s JOIN workspace_catalog_records r ON r.id=s.id AND r.workspace_id=$1
      JOIN workspace_catalog_records parent ON parent.workspace_id=r.workspace_id AND parent.id=r.catalog_id
      WHERE NOT r.archived AND NOT parent.archived ORDER BY r.kind,r.name,r.id`,
          [w, workId],
        );
        if (!catalogs.rows.length)
          throw new NotFoundException("Item not found in Master Data.");
        const links = await client.query(
          `SELECT record_id AS "recordId",target_id AS "targetId",relation FROM workspace_catalog_links
        WHERE workspace_id=$1 AND record_id=ANY($2::uuid[]) AND target_id=ANY($2::uuid[])`,
          [w, catalogs.rows.map((r) => r.id)],
        );
        return { catalogs: catalogs.rows, links: links.rows };
      },
    );
  }
  async catalogContext(actor: RequestActor, w: string, caseId: string) {
    return this.access.withPermission(
      actor,
      w,
      "pre_projects.view",
      async (c) => {
        const record = await this.caseRecord(c, w, caseId);
        const data = await this.load(c, w, caseId);
        const catalogs = await c.query(
          `SELECT r.id,r.name,r.code,r.kind,r.version,r.updated_at AS "updatedAt",r.catalog_id AS "catalogId",parent.name AS "catalogName",r.content FROM workspace_catalog_records r LEFT JOIN workspace_catalog_records parent ON parent.workspace_id=r.workspace_id AND parent.id=r.catalog_id WHERE r.workspace_id=$1 AND NOT r.archived AND (r.kind='catalog_group' OR (parent.id IS NOT NULL AND NOT parent.archived)) ORDER BY r.kind,r.name`,
          [w],
        );
        const links = (
          await c.query(
            'SELECT record_id AS "recordId",target_id AS "targetId",relation FROM workspace_catalog_links WHERE workspace_id=$1',
            [w],
          )
        ).rows;
        const scope = (
          await c.query(
            `SELECT e.id,e.title,e.quantity,e.unit,e.version,e.scope_status AS "scopeStatus",s.content AS specification,s.version AS "specificationVersion" FROM pre_project_brief_entries e LEFT JOIN LATERAL(SELECT content,version FROM pre_project_item_specifications WHERE workspace_id=e.workspace_id AND case_id=e.case_id AND entry_id=e.id ORDER BY version DESC LIMIT 1)s ON true WHERE e.workspace_id=$1 AND e.case_id=$2 AND NOT e.archived_at IS NOT NULL AND e.kind='requirement'`,
            [w, caseId],
          )
        ).rows;
        return {
          fetchedAt: new Date().toISOString(),
          case: { title: record.title, currency: record.currency },
          scope,
          quotations: data.quotes,
          paymentTemplates: (
            await c.query(
              "SELECT id,name,version,milestones FROM commercial_payment_templates WHERE workspace_id=$1",
              [w],
            )
          ).rows,
          catalogs: catalogs.rows,
          links,
          totalCatalogRecords: catalogs.rowCount,
        };
      },
    );
  }
  async command(
    actor: RequestActor,
    workspaceId: string,
    caseId: string,
    input: unknown,
  ) {
    const b = object(input),
      action = text(b.action, 50, true);
    const permission = [
      "approve",
      "decide_owner_review",
      "execute_agreement",
      "verify_payment",
      "verify_credit",
    ].includes(action)
      ? "commercial.approve"
      : action === "release"
        ? "commercial.release"
        : "pre_projects.edit";
    return this.access.withPermissions(
      actor,
      workspaceId,
      ["pre_projects.view", permission],
      async (client, user) => {
        const record = await this.caseRecord(client, workspaceId, caseId, true);
        if (!["active", "released"].includes(record.status))
          throw new ConflictException("This case is not editable.");
        const data = await this.load(client, workspaceId, caseId);
        if (number(b.revision) !== data.revision)
          throw new ConflictException(
            "Someone updated this case. Reload to see the latest changes.",
          );
        let q = b.quoteId
          ? data.quotes.find((q) => q.id === b.quoteId)
          : undefined;
        const now = new Date().toISOString();
        if (["create", "revise", "variation"].includes(action)) {
          if (
            data.quotes.some((q) =>
              ["draft", "internal_review", "internal_approved"].includes(
                q.status,
              ),
            )
          )
            throw new ConflictException(
              "Finish or return to the existing working version first.",
            );
          if (action === "revise" && (!q || q.status === "accepted"))
            throw new ConflictException(
              "Accepted quotations require a variation.",
            );
          if (
            action === "variation" &&
            (!q || q.status !== "accepted" || q.kind !== "quotation")
          )
            throw new ConflictException(
              "Accept the base quotation before creating a variation.",
            );
          const kind =
            action === "variation" ? "variation" : (q?.kind ?? "quotation");
          if (action === "create" && data.quotes.length)
            throw new ConflictException(
              "Use Create revision for the existing quotation.",
            );
          q = {
            id: randomUUID(),
            number: Math.max(0, ...data.quotes.map((q) => q.number)) + 1,
            kind,
            direction: action === "variation" ? "addition" : q?.direction,
            familyId: action === "revise" ? (q?.familyId ?? q?.id) : undefined,
            baselineId: action === "variation" ? q?.id : q?.baselineId,
            status: "draft",
            title:
              action === "variation"
                ? "Additional work"
                : (q?.title ?? record.title),
            cover: q?.cover ?? {
              preparedFor: record.customerName,
              location: "",
              subtitle: "Interior design & fit-out proposal",
            },
            inclusions: q?.inclusions ?? "",
            currency: q?.currency ?? record.currency ?? "AED",
            validUntil: new Date(Date.now() + 30 * 86400000)
              .toISOString()
              .slice(0, 10),
            discount: action === "variation" ? 0 : (q?.discount ?? 0),
            taxRate: q?.taxRate ?? 0,
            terms:
              q?.terms ??
              "Payment terms and delivery dates are subject to the agreed contract.",
            exclusions: q?.exclusions ?? "",
            lines:
              action === "variation" ? [] : structuredClone(q?.lines ?? []),
            requestIds: [],
            paymentTerms: structuredClone(q?.paymentTerms ?? []),
            paymentTemplate: q?.paymentTemplate,
            rooms:
              action === "variation" ? [] : structuredClone(q?.rooms ?? []),
            createdAt: now,
            total: 0,
          };
          if (action === "create") {
            await this.importIncludedScope(client, workspaceId, caseId, q);
            await this.seedPreparationRooms(client, workspaceId, caseId, q);
          }
          data.quotes.push(q);
        } else if (action === "import_scope") {
          if (!q) throw new NotFoundException("Quotation not found.");
          editable(q);
          const count = await this.importIncludedScope(
            client,
            workspaceId,
            caseId,
            q,
            b.refreshExisting === true,
          );
          if (!count)
            throw new ConflictException(
              "Mark scope items Included in Preparation before importing. You can also add rooms and items from your catalogs.",
            );
        } else if (action === "save") {
          if (!q) throw new NotFoundException("Quotation not found.");
          editable(q);
          const v = object(b.quote);
          const lines = parseLines(v.lines);
          const rooms: NonNullable<Quote["rooms"]> = [];
          if (v.rooms !== undefined) {
            if (!Array.isArray(v.rooms) || v.rooms.length > 100)
              throw new BadRequestException("Use up to 100 rooms.");
            for (const input of v.rooms) {
              const r = object(input),
                room: NonNullable<Quote["rooms"]>[number] = {
                  id: text(r.id, 80, true),
                  name: text(r.name, 120, true),
                };
              if (
                rooms.some(
                  (x) =>
                    x.id === room.id ||
                    x.name.toLowerCase() === room.name.toLowerCase(),
                )
              )
                throw new BadRequestException("Give each room a unique name.");
              if (r.catalog) {
                const ref = object(r.catalog),
                  recordId = text(ref.recordId, 80, true),
                  version = number(ref.version, 1e8, 1),
                  old = q.rooms?.find((x) => x.id === room.id)?.catalog;
                if (old?.recordId === recordId && old.version === version)
                  room.catalog = old;
                else {
                  const selected = (
                    await client.query(
                      `SELECT r.id,r.name,r.code,r.kind,r.version,r.catalog_id AS "catalogId",c.name AS "catalogName",CASE WHEN r.kind='unit' THEN coalesce(r.content->'configuration','{}'::jsonb)||jsonb_build_object('symbol',coalesce(r.content->'configuration'->>'symbol',r.content->'aliases'->>0,r.code)) ELSE r.content->'configuration' END AS configuration FROM workspace_catalog_records r JOIN workspace_catalog_records c ON c.workspace_id=r.workspace_id AND c.id=r.catalog_id WHERE r.workspace_id=$1 AND r.id=$2 AND r.kind='room' AND NOT r.archived AND NOT c.archived`,
                      [workspaceId, recordId],
                    )
                  ).rows[0];
                  if (!selected || selected.version !== version)
                    throw new ConflictException(
                      "The room catalog changed. Choose its current version.",
                    );
                  room.catalog = {
                    role: "room",
                    recordId,
                    version,
                    snapshot: selected,
                  };
                }
              }
              rooms.push(room);
            }
          }

          for (const l of lines) {
            for (const selection of l.catalogLinks ?? []) {
              const old = q.lines
                .find((row) => row.id === l.id)
                ?.catalogLinks?.find(
                  (c) =>
                    c.recordId === selection.recordId &&
                    c.role === selection.role &&
                    c.version === selection.version,
                );
              if (old) {
                selection.snapshot = old.snapshot;
                continue;
              }
              const selected = (
                await client.query(
                  `SELECT r.id,r.name,r.code,r.kind,r.version,r.catalog_id AS "catalogId",c.name AS "catalogName",CASE WHEN r.kind='unit' THEN coalesce(r.content->'configuration','{}'::jsonb)||jsonb_build_object('symbol',coalesce(r.content->'configuration'->>'symbol',r.content->'aliases'->>0,r.code)) ELSE r.content->'configuration' END AS configuration FROM workspace_catalog_records r JOIN workspace_catalog_records c ON c.workspace_id=r.workspace_id AND c.id=r.catalog_id WHERE r.workspace_id=$1 AND r.id=$2 AND NOT r.archived AND NOT c.archived`,
                  [workspaceId, selection.recordId],
                )
              ).rows[0];
              if (
                !selected ||
                selected.version !== selection.version ||
                !(
                  selected.kind === selection.role ||
                  (selection.role === "material" &&
                    ["sku", "hardware", "consumable"].includes(selected.kind))
                )
              )
                throw new ConflictException(
                  "A catalog selection changed or is unavailable. Select its current version.",
                );
              selection.snapshot = selected;
            }
          }
          for (const line of lines) {
            const work = line.catalogLinks?.find((c) => c.role === "work"),
              variant = line.catalogLinks?.find((c) => c.role === "variant");
            if (!variant) continue;
            if (!work)
              throw new BadRequestException(
                "Choose the catalog item before selecting its variant.",
              );
            const previous = q.lines.find((l) => l.id === line.id);
            if (
              previous?.catalogLinks?.some(
                (c) =>
                  c.role === "work" &&
                  c.recordId === work.recordId &&
                  c.version === work.version,
              ) &&
              previous.catalogLinks.some(
                (c) =>
                  c.role === "variant" &&
                  c.recordId === variant.recordId &&
                  c.version === variant.version,
              )
            )
              continue;
            const linked = await client.query(
              `SELECT target_id FROM workspace_catalog_links WHERE workspace_id=$1 AND record_id=$2 AND relation='work'`,
              [workspaceId, variant.recordId],
            );
            if (
              linked.rowCount &&
              !linked.rows.some((r) => r.target_id === work.recordId)
            )
              throw new BadRequestException(
                "This variant belongs to another catalog item. Choose a matching variant.",
              );
          }
          const known = new Map(q.lines.map((l) => [l.id, l]));
          for (const l of lines) {
            const old = known.get(l.id);
            delete l.scopeId;
            delete l.scopeVersion;
            delete l.specificationVersion;
            if (old?.scopeId)
              Object.assign(l, {
                scopeId: old.scopeId,
                scopeVersion: old.scopeVersion,
                specificationVersion: old.specificationVersion,
              });
          }
          const currency = text(v.currency, 3, true).toUpperCase();
          if (
            !["AED", "INR", "USD", "EUR", "GBP", "SAR", "QAR"].includes(
              currency,
            )
          )
            throw new BadRequestException("Choose a supported currency.");
          const requestIds = Array.isArray(v.requestIds)
            ? v.requestIds.map((id) => text(id, 80, true))
            : [];
          if (
            requestIds.some(
              (id) =>
                !data.requests.some(
                  (r) =>
                    r.id === id &&
                    !["resolved", "declined", "withdrawn"].includes(r.status),
                ),
            )
          )
            throw new ConflictException("Choose open change requests.");
          Object.assign(q, {
            title: text(v.title, 240, true),
            ...(v.cover ? { cover: parseCover(v.cover) } : {}),
            inclusions: text(v.inclusions ?? "", 6000),
            currency,
            validUntil: date(v.validUntil),
            discount: roundAmount(v.discount),
            taxRate: number(v.taxRate, 100),
            terms: text(v.terms, 10000),
            exclusions: text(v.exclusions, 6000),
            lines,
            rooms: v.rooms === undefined ? q.rooms : rooms,
            requestIds,
            direction:
              q.kind === "variation" && v.direction === "deduction"
                ? "deduction"
                : "addition",
            paymentTerms:
              q.kind === "variation" && v.direction === "deduction"
                ? []
                : parsePaymentTerms(v.paymentTerms ?? []),
          });
          for (const request of data.requests) {
            if (requestIds.includes(request.id)) request.quoteId = q.id;
            else if (request.quoteId === q.id) delete request.quoteId;
          }
          if (
            v.paymentTemplate &&
            !(
              q.paymentTemplate &&
              object(v.paymentTemplate).id === q.paymentTemplate.id &&
              object(v.paymentTemplate).version === q.paymentTemplate.version
            )
          ) {
            const template = object(v.paymentTemplate);
            const t = (
              await client.query(
                "SELECT id,name,version FROM commercial_payment_templates WHERE workspace_id=$1 AND id=$2",
                [workspaceId, text(template.id, 80, true)],
              )
            ).rows[0];
            if (!t)
              throw new BadRequestException("Payment template not found.");
            q.paymentTemplate = { id: t.id, name: t.name, version: t.version };
          } else if (!v.paymentTemplate) delete q.paymentTemplate;
          q.total = totals(q).total;
        } else if (
          ["submit", "approve", "return", "issue", "withdraw"].includes(action)
        ) {
          if (!q) throw new NotFoundException("Quotation not found.");
          if (action === "submit") {
            editable(q);
            if (q.direction !== "deduction")
              parsePaymentTerms(q.paymentTerms, true);
            validateDeduction(data, q);
            if (!q.lines.length || q.lines.some((l) => l.rate <= 0))
              throw new ConflictException(
                "Add items and selling rates before submitting for review.",
              );
            if (q.kind === "quotation") {
              const linked = q.lines.filter((line) => line.scopeId);
              const sitePlan = await client.query(
                `SELECT 1 FROM pre_project_brief_entries e JOIN pre_project_entry_assets a ON a.workspace_id=e.workspace_id AND a.case_id=e.case_id AND a.entry_id=e.id WHERE e.workspace_id=$1 AND e.case_id=$2 AND e.kind='file' AND e.archived_at IS NULL LIMIT 1`,
                [workspaceId, caseId],
              );
              if (!sitePlan.rowCount)
                throw new ConflictException(
                  "Add the current site plan before submitting the quotation for review.",
                );
              for (const line of linked) {
                const measurement = await client.query(
                  `SELECT 1 FROM pre_project_site_records WHERE workspace_id=$1 AND case_id=$2 AND kind='measurement' AND entry_id=$3 AND status='verified' LIMIT 1`,
                  [workspaceId, caseId, line.scopeId],
                );
                if (!measurement.rowCount)
                  throw new ConflictException(
                    `Verify the site measurements for ${line.title} before quotation review.`,
                  );
                const design = await client.query(
                  `SELECT count(*)::int AS total,count(*) FILTER (WHERE v.status='approved' AND NOT EXISTS(SELECT 1 FROM pre_project_design_threads t WHERE t.workspace_id=v.workspace_id AND t.version_id=v.id AND t.blocking AND t.status='open'))::int AS approved FROM pre_project_item_design_refs r JOIN pre_project_design_versions v ON v.workspace_id=r.workspace_id AND v.id=r.design_version_id WHERE r.workspace_id=$1 AND r.case_id=$2 AND r.entry_id=$3 AND r.version=$4`,
                  [
                    workspaceId,
                    caseId,
                    line.scopeId,
                    line.specificationVersion ?? 0,
                  ],
                );
                const readiness = design.rows[0] as {
                  total: number;
                  approved: number;
                };
                if (!readiness.total || readiness.approved !== readiness.total)
                  throw new ConflictException(
                    `Approve the linked design revision for ${line.title} before quotation review.`,
                  );
              }
            }
            q.total = totals(q).total;
            q.status = "internal_review";
          }
          if (action === "approve") {
            if (q.status !== "internal_review")
              throw new ConflictException(
                "Submit this version for review first.",
              );
            q.status = "internal_approved";
            q.approvedBy = user.displayName;
          }
          if (action === "return") {
            if (!["internal_review", "internal_approved"].includes(q.status))
              throw new ConflictException(
                "This version cannot return to draft.",
              );
            q.status = "draft";
            delete q.approvedBy;
          }
          if (action === "withdraw") {
            if (q.status !== "issued")
              throw new ConflictException(
                "Only a pending quotation can be withdrawn.",
              );
            q.status = "withdrawn";
          }
          if (action === "issue") {
            if (q.status !== "internal_approved")
              throw new ConflictException(
                "Internal approval is required before issue.",
              );
            if (
              data.quotes.some(
                (other) =>
                  other.id !== q!.id &&
                  other.status === "accepted" &&
                  sameOffer(other, q!),
              )
            )
              throw new ConflictException(
                "An offer was accepted. Create an approved variation instead.",
              );
            const settings = (
              await client.query(
                "SELECT * FROM client_portal_settings WHERE workspace_id=$1 AND enabled=true",
                [workspaceId],
              )
            ).rows[0];
            if (!settings)
              throw new ConflictException(
                "Enable the client portal in Workspace settings first.",
              );
            const grant = (
              await client.query(
                `SELECT id FROM client_portal_grants WHERE workspace_id=$1 AND case_id=$2 AND id=$3 AND active=true AND role='approver'`,
                [workspaceId, caseId, text(b.approverId, 80, true)],
              )
            ).rows[0];
            if (!grant)
              throw new ConflictException("Choose an active client approver.");
            if (q.validUntil < now.slice(0, 10))
              throw new ConflictException(
                "Update the quotation validity before issue.",
              );
            for (const previous of data.quotes)
              if (previous.status === "issued" && sameOffer(previous, q))
                previous.status = "superseded";
            validateDeduction(data, q);
            q.status = "issued";
            q.issuedAt = now;
            q.approverId = grant.id;
            q.brand = settings.brand;
            q.hash = freezeHash(q);
            for (const id of q.requestIds) {
              const request = data.requests.find((r) => r.id === id);
              if (request) request.status = "awaiting_decision";
            }
          }
        } else if (action === "submit_owner_review") {
          const accepted = data.quotes.find(
            (quote) =>
              quote.kind === "quotation" && quote.status === "accepted",
          );
          if (!accepted)
            throw new ConflictException(
              "Client acceptance is required before owner review.",
            );
          if (
            data.agreement?.status !== "executed" ||
            data.agreement?.quoteId !== accepted.id
          )
            throw new ConflictException(
              "Verify the signed agreement before owner review.",
            );
          if (
            data.ownerReview?.status === "approved" &&
            data.ownerReview.quoteId === accepted.id
          )
            throw new ConflictException(
              "This deal already has owner approval.",
            );
          const checklistInput = object(b.checklist),
            checklist = {
              agreement: checklistInput.agreement === true,
              boq: checklistInput.boq === true,
              documents: checklistInput.documents === true,
              margin: checklistInput.margin === true,
              materials: checklistInput.materials === true,
              payment: checklistInput.payment === true,
            };
          data.ownerReview = {
            id:
              data.ownerReview?.quoteId === accepted.id
                ? data.ownerReview.id
                : randomUUID(),
            quoteId: accepted.id,
            quoteHash: accepted.hash ?? freezeHash(accepted),
            status: "submitted",
            commission: roundAmount(b.commission ?? 0),
            checklist,
            submissionNote: text(b.note, 3000, true),
            submittedAt: now,
            submittedBy: user.displayName,
            submittedById: user.userId,
          };
          data.dealFile = null;
        } else if (action === "decide_owner_review") {
          const review = data.ownerReview,
            decision = text(b.decision, 20, true);
          if (!review || review.status !== "submitted")
            throw new ConflictException("Submit the owner review first.");
          if (!["approve", "return", "reject"].includes(decision))
            throw new BadRequestException("Choose approve, return or reject.");
          if (review.submittedById === user.userId)
            throw new ForbiddenException(
              "Another authorized owner must review this submission.",
            );
          const decisionNote = text(b.note ?? "", 3000, decision !== "approve");
          const accepted = data.quotes.find(
            (quote) =>
              quote.id === review.quoteId && quote.status === "accepted",
          );
          if (
            !accepted ||
            (accepted.hash ?? freezeHash(accepted)) !== review.quoteHash
          )
            throw new ConflictException(
              "The accepted quotation changed. Submit a new owner review.",
            );
          if (decision === "approve") {
            const agreement = data.agreement;
            if (Object.values(review.checklist).some((checked) => !checked))
              throw new ConflictException(
                "Complete every owner review check before approval.",
              );
            if (
              !agreementIsOperational(agreement) ||
              agreement?.quoteId !== accepted.id ||
              data.payments.some(
                (payment) =>
                  payment.requiredForRelease &&
                  !releasePaymentIsOperational(payment),
              )
            )
              throw new ConflictException(
                "Verify the agreement and release payments before owner approval.",
              );
            const snapshot = totals(accepted);
            review.status = "approved";
            review.decisionNote = decisionNote;
            review.decidedAt = now;
            review.decidedBy = user.displayName;
            review.decidedById = user.userId;
            data.dealFile = {
              id: randomUUID(),
              reference: `DF-${now.slice(0, 4)}-${caseId.slice(0, 8).toUpperCase()}`,
              revision: 1,
              ownerReviewId: review.id,
              quoteId: accepted.id,
              quoteNumber: accepted.number,
              quoteHash: review.quoteHash,
              agreementReference: agreement!.reference,
              paymentIds: data.payments
                .filter((payment) => payment.requiredForRelease)
                .map((payment) => payment.id),
              value: accepted.total,
              cost: snapshot.cost,
              margin: snapshot.margin,
              commission: review.commission,
              status: "active",
              approvedAt: now,
              approvedBy: user.displayName,
            };
          } else {
            review.status = decision === "return" ? "returned" : "rejected";
            review.decisionNote = decisionNote;
            review.decidedAt = now;
            review.decidedBy = user.displayName;
            review.decidedById = user.userId;
            data.dealFile = null;
          }
        } else if (action === "sync_material_approvals") {
          const accepted = data.quotes.find(
            (quote) =>
              quote.kind === "quotation" && quote.status === "accepted",
          );
          if (!accepted)
            throw new ConflictException(
              "Accept the quotation before preparing material approvals.",
            );
          const approvals =
            data.materialApprovals ?? (data.materialApprovals = []);
          for (const source of quotationApprovalSources(accepted)) {
            if (
              approvals.some(
                (approval) =>
                  approval.quoteId === accepted.id &&
                  approval.lineId === source.lineId &&
                  approval.materialRowId === source.materialRowId,
              )
            )
              continue;
            approvals.push({
              id: randomUUID(),
              quoteId: accepted.id,
              lineId: source.lineId,
              materialRowId: source.materialRowId,
              revision: 1,
              room: source.room,
              item: source.item,
              name: source.name,
              code: source.code,
              brand: source.brand,
              specification: source.specification,
              note: "",
              status: "proposed",
            });
          }
        } else if (action === "save_material_approval") {
          const approval = data.materialApprovals?.find(
            (item) => item.id === b.materialApprovalId,
          );
          if (!approval)
            throw new NotFoundException("Material selection not found.");
          if (!["proposed", "rejected"].includes(approval.status))
            throw new ConflictException(
              "Only proposed or rejected selections can be edited.",
            );
          approval.name = text(b.name, 240, true);
          approval.code = text(b.code ?? "", 80);
          approval.brand = text(b.brand ?? "", 160);
          approval.specification = text(b.specification ?? "", 3000, true);
          approval.note = text(b.note ?? "", 3000);
          if (b.photo !== undefined) {
            const photo = text(b.photo, 250000);
            if (
              photo &&
              !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
                photo,
              )
            )
              throw new BadRequestException(
                "Use a PNG, JPEG or WebP material photo.",
              );
            approval.photo = photo || undefined;
          }
          if (approval.status === "rejected") {
            approval.revision++;
            approval.status = "proposed";
            delete approval.approverId;
            delete approval.submittedAt;
            delete approval.decidedAt;
            delete approval.decidedBy;
            delete approval.decisionNote;
            delete approval.decisionChallengeId;
          }
        } else if (action === "submit_material_approval") {
          const approval = data.materialApprovals?.find(
            (item) => item.id === b.materialApprovalId,
          );
          if (!approval || approval.status !== "proposed")
            throw new ConflictException(
              "Prepare the material selection before sending it.",
            );
          const grant = (
            await client.query(
              `SELECT id FROM client_portal_grants WHERE workspace_id=$1 AND case_id=$2 AND id=$3 AND active=true AND role='approver'`,
              [workspaceId, caseId, text(b.approverId, 80, true)],
            )
          ).rows[0];
          if (!grant)
            throw new ConflictException("Choose an active client approver.");
          approval.status = "client_review";
          approval.approverId = grant.id;
          approval.submittedAt = now;
        } else if (action === "verify_credit") {
          if (
            !(await this.access.hasPermission(
              client,
              workspaceId,
              user.userId,
              "commercial.approve",
            ))
          )
            throw new ForbiddenException("Commercial approval is required.");
          const credit = data.credits?.find((c) => c.id === b.creditId);
          if (!credit) throw new NotFoundException("Client credit not found.");
          if (credit.status === "verified")
            throw new ConflictException(
              "This client credit was already verified.",
            );
          credit.reference = text(b.reference, 500, true);
          credit.evidence = text(b.evidence, 3000, true);
          credit.verifiedBy = user.displayName;
          credit.verifiedAt = now;
          credit.status = "verified";
        } else if (action === "request") {
          newRequest(
            data,
            text(b.title, 240, true),
            text(b.detail, 6000, true),
            q?.id,
          );
        } else if (action === "update_request") {
          const r = data.requests.find((r) => r.id === b.requestId);
          if (!r) throw new NotFoundException("Request not found.");
          r.owner = text(b.owner, 160);
          r.dueDate = b.dueDate ? date(b.dueDate) : "";
          const status = text(b.status, 30, true);
          if (
            ![
              "open",
              "under_review",
              "declined",
              "withdrawn",
              "resolved",
            ].includes(status) &&
            !(
              status === "awaiting_decision" && r.status === "awaiting_decision"
            )
          )
            throw new BadRequestException("Invalid request status.");
          const resolution = text(b.resolution, 3000);
          if (
            ["resolved", "declined", "withdrawn"].includes(status) &&
            !resolution
          )
            throw new BadRequestException("Add a closure reason.");
          if (
            status === "resolved" &&
            r.quoteId &&
            !data.quotes.some(
              (q) => q.status === "accepted" && q.requestIds.includes(r.id),
            )
          )
            throw new ConflictException(
              "Accept the linked revised quotation before resolving this change.",
            );
          r.status = status as typeof r.status;
          r.resolution = resolution;
        } else if (action === "comment") {
          const r = data.requests.find((r) => r.id === b.requestId);
          if (!r) throw new NotFoundException("Request not found.");
          r.comments.push({
            id: randomUUID(),
            at: now,
            author: user.displayName,
            text: text(b.text, 6000, true),
            visibility: b.visibility === "internal" ? "internal" : "client",
          });
        } else if (action === "agreement") {
          const quote = data.quotes.find(
            (q) =>
              q.id === b.quoteId &&
              q.status === "accepted" &&
              q.kind === "quotation",
          );
          if (!quote)
            throw new ConflictException("Select the accepted base quotation.");
          if (data.agreement?.status === "executed")
            throw new ConflictException(
              "Executed agreement evidence is locked. A separate amendment is required.",
            );
          if (!data.payments.length) {
            let allocated = 0;
            data.payments = (quote.paymentTerms ?? []).map((term, index) => {
              const amount =
                index === quote.paymentTerms.length - 1
                  ? Math.round((quote.total - allocated) * 100) / 100
                  : Math.round(quote.total * term.percent) / 100;
              allocated += amount;
              return {
                id: randomUUID(),
                sourceQuoteId: quote.id,
                title: term.title,
                amount,
                dueDate: "",
                trigger: term.trigger,
                requiredForRelease: term.requiredForRelease,
                status: "pending" as const,
                proof: "",
                reference: "",
              };
            });
          }
          data.agreement = {
            quoteId: quote.id,
            reference: text(b.reference, 200, true),
            terms: text(b.terms, 10000, true),
            evidence: text(b.evidence, 3000),
            evidenceKind:
              b.evidenceKind === "demonstration"
                ? "demonstration"
                : "operational",
            status: "draft",
          };
        } else if (action === "execute_agreement") {
          if (
            !data.agreement?.evidence ||
            !isOperationalEvidence(data.agreement)
          )
            throw new ConflictException(
              "Record operational signed-agreement evidence first. Demonstration evidence cannot execute a live agreement.",
            );
          data.agreement.status = "executed";
          data.agreement.executedBy = user.displayName;
          data.agreement.executedAt = now;
        } else if (action === "payment") {
          if (!data.agreement)
            throw new ConflictException("Record the agreement first.");
          const existing = data.payments.find((p) => p.id === b.paymentId);
          if (existing?.invoice && roundAmount(b.amount) !== existing.amount)
            throw new ConflictException(
              "A linked invoice fixes the milestone amount. Resolve its commercial correction first.",
            );
          if (existing && existing.status !== "pending")
            throw new ConflictException(
              "Submitted or verified payment records cannot be edited.",
            );
          if (!existing && data.payments.some((p) => p.sourceQuoteId))
            throw new ConflictException(
              "This schedule comes from the accepted quotation. Use an approved variation for extra payments.",
            );
          if (
            existing?.sourceQuoteId &&
            (roundAmount(b.amount) !== existing.amount ||
              text(b.title, 160, true) !== existing.title ||
              b.requiredForRelease !== existing.requiredForRelease)
          )
            throw new ConflictException(
              "The accepted milestone amount and conditions are fixed. Update only its due date and accounting reference.",
            );
          const value = {
            id: existing?.id ?? randomUUID(),
            title: text(b.title, 160, true),
            amount: roundAmount(b.amount),
            dueDate: date(b.dueDate),
            requiredForRelease: b.requiredForRelease === true,
            status: "pending" as const,
            proof: "",
            reference: text(b.reference ?? "", 240),
            evidenceKind:
              b.evidenceKind === "demonstration"
                ? ("demonstration" as const)
                : ("operational" as const),
          };
          if (value.amount <= 0)
            throw new BadRequestException("Enter a payment amount.");
          if (existing)
            Object.assign(existing, {
              ...value,
              sourceQuoteId: existing.sourceQuoteId,
              trigger: existing.trigger,
            });
          else data.payments.push(value);
        } else if (action === "verify_payment") {
          const payment = data.payments.find((p) => p.id === b.paymentId);
          if (!payment) throw new NotFoundException("Payment not found.");
          if (payment.status === "verified")
            throw new ConflictException("Payment already verified.");
          if (payment.invoice)
            throw new ConflictException(
              "Refresh the linked accounting invoice to verify settlement. A manual reference cannot override its balance.",
            );
          payment.reference = text(b.reference, 240, true);
          payment.evidenceKind =
            b.evidenceKind === "demonstration"
              ? "demonstration"
              : "operational";
          if (!releasePaymentIsOperational({ ...payment, status: "verified" }))
            throw new ConflictException(
              "Demonstration payment evidence cannot verify a live milestone.",
            );
          payment.status = "verified";
          payment.verifiedAt = now;
          payment.verifiedBy = user.displayName;
        } else if (action === "release") {
          if (data.release)
            throw new ConflictException(
              "Execution readiness already recorded.",
            );
          const accepted = data.quotes.find(
            (q) => q.kind === "quotation" && q.status === "accepted",
          );
          const designReadiness = await this.designReadiness(
            client,
            workspaceId,
            caseId,
            accepted,
          );
          if (
            accepted &&
            (designReadiness.designsRequired === 0 ||
              designReadiness.designsApproved !==
                designReadiness.designsRequired)
          )
            throw new ConflictException(
              "Approve every linked design revision before execution release.",
            );
          if (
            !accepted ||
            !agreementIsOperational(data.agreement) ||
            data.agreement?.quoteId !== accepted.id
          )
            throw new ConflictException(
              "Accept the quotation and verify the signed agreement first.",
            );
          if (
            !data.dealFile ||
            data.dealFile.quoteId !== accepted.id ||
            data.ownerReview?.status !== "approved"
          )
            throw new ConflictException(
              "Owner approval and an active Deal File are required before release.",
            );
          if (!materialApprovalsComplete(accepted, data.materialApprovals))
            throw new ConflictException(
              "Complete the client material approvals before release.",
            );
          if (
            data.payments.some(
              (p) => p.requiredForRelease && !releasePaymentIsOperational(p),
            )
          )
            throw new ConflictException(
              "Verify the payments required for release.",
            );
          if (
            data.requests.some(
              (r) => !["resolved", "declined", "withdrawn"].includes(r.status),
            )
          )
            throw new ConflictException(
              "Resolve or explicitly decline pending change requests.",
            );
          data.release = {
            id: randomUUID(),
            at: now,
            by: user.displayName,
            quoteId: accepted.id,
            dealFileId: data.dealFile.id,
            note: text(b.note, 3000, true),
          };
          const project = await releaseDeliveryProject(
            client,
            workspaceId,
            caseId,
            user.userId,
            data,
          );
          data.release.projectId = project.id;
        } else throw new BadRequestException("Unknown commercial action.");
        await this.persist(
          client,
          workspaceId,
          caseId,
          data,
          user.displayName,
          action,
          q?.id,
        );
        return { data };
      },
    );
  }
}
function roundAmount(value: unknown) {
  return Math.round(number(value) * 100) / 100;
}
