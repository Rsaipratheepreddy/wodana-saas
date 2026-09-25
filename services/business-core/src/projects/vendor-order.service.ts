import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { HrmsAccessService } from "../hrms/hrms-access.service";
import { ExecutionService } from "./execution.service";
import type { RequestActor } from "../auth/actor";
import { obj, str, get, choice, num, day } from "./execution.domain";
import type { ProjectData } from "./execution.types";
import { acceptedOrderQuantity } from "./project-inventory";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
@Injectable()
export class VendorOrderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: HrmsAccessService,
    private readonly execution: ExecutionService,
  ) {}
  issue(actor: RequestActor, w: string, p: string, input: unknown) {
    return this.access.run(actor, w, async (ctx) => {
      this.access.require(ctx, "projects.buy");
      await this.execution.row(ctx, p, true);
      const b = obj(input),
        d = await this.execution.load(ctx, p),
        order = get(d.orders, b.orderId);
      await ctx.client.query(
        "UPDATE project_vendor_access SET revoked_at=now() WHERE workspace_id=$1 AND project_id=$2 AND order_id=$3 AND revoked_at IS NULL",
        [w, p, order.id],
      );
      if (b.revoke === true) return { revoked: true };
      if (["cancelled", "closed"].includes(order.status))
        throw new ConflictException("This order is closed.");
      const token = randomBytes(32).toString("base64url"),
        expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      await ctx.client.query(
        "INSERT INTO project_vendor_access(workspace_id,project_id,order_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)",
        [w, p, order.id, hash(token), expiresAt],
      );
      d.audit.push({
        id: randomUUID(),
        at: new Date().toISOString(),
        author: "Procurement",
        action: "vendor_access_created",
        recordId: order.id,
        note: "Restricted order link · expires in 7 days",
      });
      await this.execution.store(ctx, p, d);
      return { token, expiresAt };
    });
  }
  async handle(input: unknown) {
    const b = obj(input),
      token = str(b.token, 100, true);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new NotFoundException("This order link is invalid or expired.");
    const found = (
      await this.db.query(
        "SELECT workspace_id FROM project_vendor_access WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()",
        [hash(token)],
      )
    ).rows[0];
    if (!found)
      throw new NotFoundException("This order link is invalid or expired.");
    return this.db.tenantTransaction(
      found.workspace_id,
      "00000000-0000-4000-8000-000000000001",
      async (c) => {
        const grant = (
          await c.query(
            "SELECT * FROM project_vendor_access WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE",
            [hash(token)],
          )
        ).rows[0];
        if (!grant)
          throw new NotFoundException("This order link is invalid or expired.");
        if (
          Date.now() - new Date(grant.window_at).getTime() < 60000 &&
          grant.attempts >= 30
        )
          throw new ConflictException(
            "Too many requests. Try again in a minute.",
          );
        await c.query(
          "UPDATE project_vendor_access SET attempts=CASE WHEN window_at<now()-interval '1 minute' THEN 1 ELSE attempts+1 END,window_at=CASE WHEN window_at<now()-interval '1 minute' THEN now() ELSE window_at END WHERE id=$1",
          [grant.id],
        );
        await c.query(
          "SELECT id FROM delivery_projects WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [grant.workspace_id, grant.project_id],
        );
        const row = (
          await c.query(
            "SELECT content FROM project_execution WHERE workspace_id=$1 AND project_id=$2 FOR UPDATE",
            [grant.workspace_id, grant.project_id],
          )
        ).rows[0];
        if (!row) throw new NotFoundException("Order unavailable.");
        const d = row.content as ProjectData,
          o = get(d.orders, grant.order_id),
          brand = (
            await c.query(
              "SELECT brand FROM client_portal_settings WHERE workspace_id=$1",
              [grant.workspace_id],
            )
          ).rows[0]?.brand;
        if (b.action === "submit") {
          if (["closed", "cancelled"].includes(o.status))
            throw new ConflictException("This order is closed.");
          const requestId = str(b.requestId, 80, true);
          if (!o.vendorUpdates?.some((x) => x.id === requestId)) {
            const kind = choice(b.kind, [
              "quotation",
              "acknowledgement",
              "progress",
              "delivery",
            ]);
            if (
              kind === "quotation" &&
              (!["enquiry", "draft", "submitted"].includes(o.status) || Boolean(o.sourceEnquiry))
            )
              throw new ConflictException(
                "Quote selection is closed. Contact procurement about a revised offer.",
              );
            if (
              ["progress", "delivery"].includes(kind) &&
              !["approved", "acknowledged"].includes(o.status)
            )
              throw new ConflictException(
                "Wait for order approval before reporting work or delivery. You can submit an offer or availability confirmation now.",
              );
            const value = {
              id: requestId,
              at: new Date().toISOString(),
              kind,
              note: str(b.note, 3000, true),
              evidence: str(b.evidence, 2000),
              date: day(b.date, true),
              quantity: num(b.quantity ?? 0),
              unitCost: kind === "quotation" ? num(b.unitCost) : undefined,
            };
            if (value.quantity > o.quantity)
              throw new BadRequestException(
                "Quantity cannot exceed the order scope.",
              );
            if (kind === "quotation" && (!value.quantity || !value.unitCost))
              throw new BadRequestException("Enter a positive offered quantity and unit price.");
            o.vendorUpdates ??= [];
            o.vendorUpdates.push(value);
            d.revision++;
            d.audit.push({
              id: randomUUID(),
              at: value.at,
              author: `Vendor · ${o.vendor}`,
              action: "vendor_submission",
              recordId: o.id,
              note: `${kind} submitted for review`,
            });
            await c.query(
              "UPDATE project_execution SET content=$3,revision=$4,updated_at=now() WHERE workspace_id=$1 AND project_id=$2",
              [
                grant.workspace_id,
                grant.project_id,
                JSON.stringify(d),
                d.revision,
              ],
            );
          }
        } else if (b.action !== "read")
          throw new BadRequestException("Unknown vendor action.");
        return {
          brand: brand
            ? {
                name: brand.name,
                logo: brand.logo,
                primaryColor: brand.primaryColor,
                accentColor: brand.accentColor,
              }
            : null,
          order: {
            number: o.number,
            title: o.title,
            vendor: o.vendor,
            kind: o.kind,
            quantity: o.quantity,
            unit: o.unit,
            currency: o.currency,
            status: o.status,
            promisedDate: o.promisedDate,
            specification:
              o.rfqSnapshot?.specification ??
              d.materials.find((m) => m.id === o.materialId)?.specification ??
              d.tasks.find((t) => t.id === o.taskId)?.description ??
              "",
            workArea: o.rfqSnapshot?.workArea ?? d.tasks.find((t) => t.id === o.taskId)?.area ?? "",
            workTitle: o.rfqSnapshot?.workTitle ?? d.tasks.find((t) => t.id === o.taskId)?.title ?? "",
            accepted: acceptedOrderQuantity(d, o),
            rejected: o.receipts.reduce((n, r) => n + r.rejected, 0),
            acknowledgement: o.acknowledgement,
            updates: o.vendorUpdates ?? [],
          },
          expiresAt: grant.expires_at,
        };
      },
    );
  }
}
