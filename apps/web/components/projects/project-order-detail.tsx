"use client";
import Link from "next/link";
import { ArrowRight, PackageCheck, Truck, MessageSquare } from "lucide-react";
import { label, type ProjectState, type Order } from "@/lib/projects/execution";
import { money } from "@/lib/commercial/client";
import theme from "../crm/crm-workspace-colors.module.css";
import f from "./project-flow.module.css";
import s from "./project-workspace.module.css";
export function ProjectOrderDetail({
  state,
  order: o,
  busy,
  onEdit,
  onVendor,
  onStep,
  onComments,
}: {
  state: ProjectState;
  order: Order;
  busy: boolean;
  onEdit: () => void;
  onVendor: () => void;
  onStep: () => void;
  onComments: () => void;
}) {
  const material = state.data.materials.find((m) => m.id === o.materialId),
    task = state.data.tasks.find((t) => t.id === o.taskId),
    accepted = o.receipts.reduce((n, r) => n + r.accepted, 0),
    rejected = o.receipts.reduce((n, r) => n + r.rejected, 0),
    pending = Math.max(0, o.quantity - accepted),
    step = [
      "enquiry",
      "draft",
      "submitted",
      "approved",
      "acknowledged",
      "closed",
    ].indexOf(o.status),
    next =
      o.status === "enquiry"
        ? "Compare vendor offer"
        : o.status === "draft"
          ? "Submit for approval"
          : o.status === "submitted"
            ? "Approve order"
            : o.status === "approved"
              ? "Review vendor confirmation"
              : pending
                ? "Verify delivery"
                : "Close completed order";
  return (
    <div className={`${theme.theme} ${f.orderDetail}`}>
      <header className={f.orderHero}>
        <div>
          <span className={f.route}>
            {o.number} ·{" "}
            {o.kind === "factory" ? "Outside factory" : label(o.kind)}
          </span>
          <h2>{o.title}</h2>
          <p>{o.vendor}</p>
        </div>
        <span className={s.status} data-state={o.status}>
          {label(o.status)}
        </span>
      </header>
      <div className={f.flowSteps}>
        {["Offer", "Approval", "Vendor confirmation", "Delivery"].map(
          (x, i) => (
            <div key={x} data-done={step >= [1, 3, 4, 5][i]}>
              <span>{i + 1}</span>
              <strong>{x}</strong>
            </div>
          ),
        )}
      </div>
      <div className={f.orderFacts}>
        <div>
          <small>Order value</small>
          <strong>{money(o.quantity * o.unitCost, o.currency)}</strong>
        </div>
        <div>
          <small>Required quantity</small>
          <strong>
            {o.quantity} {o.unit}
          </strong>
        </div>
        <div>
          <small>Promised delivery</small>
          <strong>{o.promisedDate}</strong>
        </div>
      </div>
      <section className={f.nextAction}>
        <PackageCheck size={22} />
        <div>
          <h3>
            {["closed", "cancelled"].includes(o.status)
              ? label(o.status)
              : next}
          </h3>
          <p>
            {o.status === "approved"
              ? "Check the vendor’s dates and scope before accepting their confirmation."
              : o.status === "acknowledged"
                ? `${accepted} accepted · ${rejected} rejected · ${pending} ${o.unit} still due.`
                : o.status === "submitted"
                  ? `Review ${money(o.quantity * o.unitCost, o.currency)} against the approved project budget.`
                  : o.status === "draft"
                    ? "Confirm the scope, quantity, vendor and agreed rate."
                    : o.status === "enquiry"
                      ? "Review the vendor’s offer alongside the other offers for this scope."
                      : "The order history remains available below."}
          </p>
        </div>
        {state.canBuy && !["closed", "cancelled"].includes(o.status) && (
          <button
            className={s.primary}
            disabled={busy || (o.status === "submitted" && !state.canReview)}
            onClick={onStep}
          >
            {next}
            <ArrowRight size={14} />
          </button>
        )}
      </section>
      <div className={f.orderColumns}>
        <section>
          <h3>What this order supplies</h3>
          {material ? (
            <>
              <strong>{material.title}</strong>
              <p>{material.specification}</p>
              <Link
                className={s.link}
                href={`/workspace/projects/${state.id}/material-planning`}
              >
                Material requirement <ArrowRight size={13} />
              </Link>
            </>
          ) : (
            <p>
              {o.kind === "material"
                ? "Link a material requirement before approval."
                : task?.description || o.title}
            </p>
          )}
          {task && (
            <Link
              className={f.connectedTask}
              href={`/workspace/projects/${state.id}/${task.location === "factory" ? "production" : "site-work"}?record=${task.id}`}
            >
              <strong>{task.title}</strong>
              <small>
                {task.area} ·{" "}
                {state.members.find((m) => m.id === task.ownerId)?.name ??
                  "Owner needed"}
              </small>
              <ArrowRight size={15} />
            </Link>
          )}
        </section>
        <section>
          <h3>
            <Truck size={15} />
            Receipts & inspection
          </h3>
          {o.receipts.length ? (
            o.receipts.map((r) => (
              <div className={f.receipt} key={r.id}>
                <strong>
                  {r.accepted} accepted · {r.rejected} rejected
                </strong>
                <p>{r.evidence}</p>
                <small>{new Date(r.at).toLocaleString()}</small>
              </div>
            ))
          ) : (
            <p>
              Procurement records accepted and rejected quantities when the
              delivery arrives.
            </p>
          )}
          {o.acknowledgement && (
            <p>
              <strong>Confirmed:</strong> {o.acknowledgement}
            </p>
          )}
        </section>
      </div>
      <section>
        <div className={f.sectionHeader}>
          <h3>Vendor updates</h3>
          {state.canBuy && !["closed", "cancelled"].includes(o.status) && (
            <button className={s.button} onClick={onVendor}>
              Open vendor workspace <ArrowRight size={13} />
            </button>
          )}
        </div>
        {o.vendorUpdates?.length ? (
          <ol className={f.updateTimeline}>
            {[...o.vendorUpdates].reverse().map((u) => (
              <li key={u.id}>
                <span className={f.timelineDot} />
                <div>
                  <strong>
                    {label(u.kind)} · {u.date}
                  </strong>
                  <p>{u.note}</p>
                  {u.evidence && <p>{u.evidence}</p>}
                  <small>
                    {u.quantity} {o.unit}
                    {u.unitCost !== undefined
                      ? ` · ${money(u.quantity * u.unitCost, o.currency)}`
                      : ""}{" "}
                    · Received {new Date(u.at).toLocaleString()}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className={f.caption}>
            Share the secure order link to collect an offer, confirmed dates and
            delivery updates.
          </p>
        )}
      </section>
      <footer className={f.detailActions}>
        <button className={s.button} onClick={onComments}>
          <MessageSquare size={14} />
          Comments
        </button>
        {state.canBuy && ["draft", "enquiry"].includes(o.status) && (
          <button className={s.button} onClick={onEdit}>
            Edit {o.status === "enquiry" ? "enquiry" : "draft order"}
          </button>
        )}
        <Link
          className={s.button}
          href={`/workspace/projects/${state.id}/commercial`}
        >
          Commercial & accounting <ArrowRight size={13} />
        </Link>
      </footer>
    </div>
  );
}
