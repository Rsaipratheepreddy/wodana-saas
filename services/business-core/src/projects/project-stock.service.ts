import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { RequestActor } from "../auth/actor";
import {
  HrmsAccessService,
  type HrmsContext,
} from "../hrms/hrms-access.service";
import { ExecutionService } from "./execution.service";
import { obj, str, num, day, get, choice } from "./execution.domain";
import type { Material, ProjectData } from "./execution.types";
import type {
  StockEndpoint,
  StockTransfer,
  StockState,
  WarehouseStock,
} from "./project-stock.types";
const uuid = (v: unknown) => {
  const id = str(v, 36, true);
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
    throw new BadRequestException("Choose a valid stock record.");
  return id;
};
const balance = (m: Material) =>
  m.movements.reduce(
    (s, x) =>
      s + (["receive", "return"].includes(x.kind) ? x.quantity : -x.quantity),
    0,
  ) - (m.reservations ?? []).reduce((s, x) => s + x.quantity, 0);
@Injectable()
export class ProjectStockService {
  constructor(
    private readonly access: HrmsAccessService,
    private readonly execution: ExecutionService,
  ) {}
  async stateIn(ctx: HrmsContext, p: string): Promise<StockState> {
    await this.execution.row(ctx, p);
    const stock = (
      await ctx.client.query(
        `SELECT id,location,catalog_id AS "catalogId",catalog_version AS "catalogVersion",title,unit,quantity::float,reserved::float FROM project_warehouse_stock WHERE workspace_id=$1 ORDER BY location,title`,
        [ctx.workspaceId],
      )
    ).rows;
    const transfers = (
      await ctx.client.query(
        `SELECT content FROM project_stock_transfers WHERE workspace_id=$1 AND (project_id=$2 OR content->'source'->>'id'=$2::text OR content->'destination'->>'id'=$2::text) ORDER BY id DESC`,
        [ctx.workspaceId, p],
      )
    ).rows.map((r) => r.content);
    const projects = (
      await ctx.client.query(
        `SELECT e.project_id AS id,p.name,e.content FROM project_execution e JOIN delivery_projects p ON p.id=e.project_id AND p.workspace_id=e.workspace_id WHERE e.workspace_id=$1 AND ( $3 OR EXISTS(SELECT 1 FROM project_assignments a WHERE a.workspace_id=e.workspace_id AND a.project_id=e.project_id AND a.membership_id=$2 AND a.active)) AND p.status<>'archived'`,
        [
          ctx.workspaceId,
          ctx.membershipId,
          ctx.permissions.has("projects.manage"),
        ],
      )
    ).rows;
    return {
      stock,
      transfers,
      projectMaterials: projects.flatMap((p) =>
        (p.content as ProjectData).materials
          .filter((m) => m.supply === "company" && m.catalogId)
          .map((m) => ({
            projectId: p.id,
            projectName: p.name,
            id: m.id,
            title: m.title,
            catalogId: m.catalogId,
            catalogVersion: m.catalogVersion,
            unit: m.unit,
            available: balance(m),
          })),
      ),
    };
  }
  state(a: RequestActor, w: string, p: string) {
    return this.access.run(a, w, async (ctx) => {
      this.access.require(ctx, "projects.buy", "projects.manage");
      return this.stateIn(ctx, p);
    });
  }
  command(a: RequestActor, w: string, p: string, input: unknown) {
    return this.access.run(a, w, async (ctx) => {
      this.access.require(ctx, "projects.buy");
      const b = obj(input),
        action = str(b.action, 50, true),
        retry = uuid(b.requestId),
        hash = createHash("sha256").update(JSON.stringify(b)).digest("hex");
      await ctx.client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`project-stock:${w}`],
      );
      const replay = (
        await ctx.client.query(
          "SELECT payload_hash FROM project_stock_commands WHERE workspace_id=$1 AND request_id=$2",
          [w, retry],
        )
      ).rows[0];
      if (replay) {
        if (replay.payload_hash !== hash)
          throw new ConflictException(
            "This request key was already used for different stock changes.",
          );
        return this.stateIn(ctx, p);
      }
      await this.execution.row(ctx, p, true);
      const checkReview = () => {
        if (!ctx.permissions.has("projects.review"))
          throw new ForbiddenException(
            "A stock reviewer must make this decision.",
          );
      };
      const stock = (
        await ctx.client.query(
          `SELECT id,location,catalog_id AS "catalogId",catalog_version AS "catalogVersion",title,unit,quantity::float,reserved::float FROM project_warehouse_stock WHERE workspace_id=$1 FOR UPDATE`,
          [w],
        )
      ).rows as WarehouseStock[];
      const projectCache = new Map<string, ProjectData>();
      const project = async (id: string) => {
        if (projectCache.has(id)) return projectCache.get(id)!;
        const row = await this.execution.row(ctx, id, true);
        if (!row.commercial?.release)
          throw new ConflictException(
            "Stock transfer requires released project scope.",
          );
        const data = await this.execution.load(ctx, id);
        if (data.phase === "completed")
          throw new ConflictException(
            "Reopen completed project stock before transfer.",
          );
        projectCache.set(id, data);
        return data;
      };
      const endpoint = async (value: unknown): Promise<StockEndpoint> => {
        const v = obj(value);
        if (v.kind === "warehouse") {
          get(stock, uuid(v.id));
          return { kind: "warehouse", id: uuid(v.id) };
        }
        if (v.kind !== "project")
          throw new BadRequestException(
            "Choose source and destination locations.",
          );
        const data = await project(uuid(v.id)),
          m = get(data.materials, str(v.materialId, 80, true));
        if (m.supply !== "company" || !m.catalogId)
          throw new ConflictException(
            "Choose company-supplied catalog materials.",
          );
        return { kind: "project", id: uuid(v.id), materialId: m.id };
      };
      const item = async (e: StockEndpoint) =>
        e.kind === "warehouse"
          ? get(stock, e.id)
          : get((await project(e.id)).materials, e.materialId);
      const reserve = async (e: StockEndpoint, q: number, t: StockTransfer) => {
        if (e.kind === "warehouse") {
          const s = get(stock, e.id);
          if (s.quantity - s.reserved < q)
            throw new ConflictException(
              "Insufficient available warehouse stock.",
            );
          s.reserved += q;
        } else {
          const m = get((await project(e.id)).materials, e.materialId);
          if (balance(m) < q)
            throw new ConflictException(
              "Release reservations or reduce the transfer quantity.",
            );
          m.reservations ??= [];
          m.reservations.push({
            taskId: `transfer:${t.id}`,
            quantity: q,
            reference: t.reference,
            at: new Date().toISOString(),
          });
        }
      };
      const unreserve = async (e: StockEndpoint, t: StockTransfer) => {
        if (e.kind === "warehouse") get(stock, e.id).reserved -= t.quantity;
        else {
          const m = get((await project(e.id)).materials, e.materialId);
          m.reservations = (m.reservations ?? []).filter(
            (r) => r.taskId !== `transfer:${t.id}`,
          );
        }
      };
      const movement = async (
        e: StockEndpoint,
        q: number,
        incoming: boolean,
        t: StockTransfer,
      ) => {
        if (e.kind === "warehouse") {
          get(stock, e.id).quantity += incoming ? q : -q;
        } else {
          const m = get((await project(e.id)).materials, e.materialId);
          m.movements.push({
            id: randomUUID(),
            kind: incoming ? "receive" : "transfer_out",
            quantity: q,
            reference: `Transfer ${t.id} · ${t.reference}`,
            at: new Date().toISOString(),
          });
        }
      };
      if (action === "opening_stock") {
        checkReview();
        const catalog = uuid(b.catalogId),
          selected = (
            await ctx.client.query(
              `SELECT name,version,kind FROM workspace_catalog_records WHERE workspace_id=$1 AND id=$2 AND NOT archived`,
              [w, catalog],
            )
          ).rows[0];
        if (
          !selected ||
          selected.version !== b.catalogVersion ||
          !["material", "sku", "hardware", "consumable"].includes(selected.kind)
        )
          throw new ConflictException(
            "Choose the current catalog material version.",
          );
        const quantity = num(b.quantity);
        if (!quantity)
          throw new BadRequestException("Enter verified opening quantity.");
        await ctx.client.query(
          `INSERT INTO project_warehouse_stock(workspace_id,location,catalog_id,catalog_version,title,unit,quantity,opening_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            w,
            str(b.location, 160, true),
            catalog,
            selected.version,
            selected.name,
            str(b.unit, 40, true),
            quantity,
            str(b.reference, 3000, true),
          ],
        );
      } else if (action === "request_transfer") {
        const source = await endpoint(b.source),
          destination = await endpoint(b.destination);
        if (JSON.stringify(source) === JSON.stringify(destination))
          throw new BadRequestException("Choose different stock locations.");
        if (source.id !== p && destination.id !== p)
          throw new BadRequestException("Link this project to the transfer.");
        const from = await item(source),
          to = await item(destination);
        if (
          from.catalogId !== to.catalogId ||
          from.catalogVersion !== to.catalogVersion ||
          from.unit !== to.unit
        )
          throw new ConflictException(
            "Transfer only matching material versions and units.",
          );
        const quantity = num(b.quantity);
        if (!quantity)
          throw new BadRequestException("Enter transfer quantity.");
        const id = randomUUID(),
          t: StockTransfer = {
            id,
            title: str(b.title, 240, true),
            source,
            destination,
            quantity,
            unit: from.unit,
            catalogId: from.catalogId,
            catalogVersion: from.catalogVersion,
            status: "requested",
            requestedBy: ctx.membershipId,
            accepted: 0,
            rejected: 0,
            rejectionResolved: false,
            reference: str(b.reference, 3000, true),
            dueDate: day(b.dueDate, true),
            history: [
              {
                at: new Date().toISOString(),
                by: ctx.membershipId,
                action,
                reference: str(b.reference, 3000, true),
              },
            ],
          };
        await ctx.client.query(
          "INSERT INTO project_stock_transfers(id,workspace_id,project_id,content) VALUES($1,$2,$3,$4)",
          [id, w, p, t],
        );
      } else {
        const result = await ctx.client.query(
          "SELECT content FROM project_stock_transfers WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [w, uuid(b.id)],
        );
        if (!result.rowCount)
          throw new NotFoundException("Transfer not found.");
        const t = result.rows[0].content as StockTransfer;
        if (t.source.id !== p && t.destination.id !== p)
          throw new ForbiddenException(
            "Open the project linked to this transfer.",
          );
        await endpoint(t.source);
        await endpoint(t.destination);
        t.reference = str(b.reference, 3000, true);
        if (action === "approve_transfer") {
          checkReview();
          if (ctx.membershipId === t.requestedBy)
            throw new ForbiddenException(
              "Another reviewer must approve this stock transfer.",
            );
          if (t.status !== "requested")
            throw new ConflictException("Approve a requested transfer.");
          await reserve(t.source, t.quantity, t);
          t.status = "approved";
          t.approvedBy = ctx.membershipId;
        } else if (action === "dispatch_transfer") {
          if (t.status !== "approved")
            throw new ConflictException("Approve and reserve stock first.");
          await unreserve(t.source, t);
          await movement(t.source, t.quantity, false, t);
          t.status = "dispatched";
        } else if (action === "receive_transfer") {
          checkReview();
          if (t.status !== "dispatched")
            throw new ConflictException("Receive a dispatched transfer.");
          t.accepted = num(b.accepted);
          t.rejected = num(b.rejected);
          if (Math.abs(t.accepted + t.rejected - t.quantity) > 0.0001)
            throw new ConflictException(
              "Account for all transferred units as accepted or rejected.",
            );
          if (t.accepted) await movement(t.destination, t.accepted, true, t);
          t.status = "received";
          t.rejectionResolved = t.rejected === 0;
        } else if (action === "resolve_rejection") {
          checkReview();
          if (t.status !== "received" || t.rejectionResolved || !t.rejected)
            throw new ConflictException(
              "Choose an unresolved rejected receipt.",
            );
          const disposition = choice(b.disposition, [
            "return_to_source",
            "accept_after_inspection",
          ]);
          await movement(
            disposition === "return_to_source" ? t.source : t.destination,
            t.rejected,
            true,
            t,
          );
          t.rejectionResolved = true;
          t.reference = `${disposition}: ${t.reference}`;
        } else if (action === "cancel_transfer") {
          if (!["requested", "approved"].includes(t.status))
            throw new ConflictException(
              "Dispatched stock needs receipt and rejection handling.",
            );
          if (t.status === "approved") await unreserve(t.source, t);
          t.status = "cancelled";
        } else throw new BadRequestException("Unknown stock action.");
        t.history.push({
          at: new Date().toISOString(),
          by: ctx.membershipId,
          action,
          reference: t.reference,
        });
        await ctx.client.query(
          "UPDATE project_stock_transfers SET content=$3,version=version+1 WHERE workspace_id=$1 AND id=$2",
          [w, t.id, t],
        );
      }
      for (const item of stock)
        await ctx.client.query(
          "UPDATE project_warehouse_stock SET quantity=$3,reserved=$4 WHERE workspace_id=$1 AND id=$2",
          [w, item.id, item.quantity, item.reserved],
        );
      for (const [id, d] of projectCache) {
        d.audit.push({
          id: randomUUID(),
          at: new Date().toISOString(),
          author: ctx.membershipId,
          action,
          recordId: str(b.id, 80),
          note: str(b.reference, 3000),
        });
        await this.execution.store(ctx, id, d);
      }
      await ctx.client.query(
        "INSERT INTO project_stock_commands(workspace_id,request_id,payload_hash) VALUES($1,$2,$3)",
        [w, retry, hash],
      );
      await this.access.audit(ctx, `stock_${action}`, p, {
        reference: str(b.reference, 3000),
      });
      return this.stateIn(ctx, p);
    });
  }
}
