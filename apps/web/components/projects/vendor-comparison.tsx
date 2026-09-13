"use client";
import type { Order, ProjectState } from "@/lib/projects/execution";
import { money } from "@/lib/commercial/client";
import s from "./project-workspace.module.css";
export function VendorComparison({
  state,
  onChoose,
  onForm,
  onEdit,
}: {
  state: ProjectState;
  onChoose: (order: Order) => void;
  onForm: (id: string) => void;
  onEdit: (order: Order) => void;
}) {
  const groups = Map.groupBy(
    state.data.orders.filter((o) => o.status === "enquiry" || o.sourceEnquiry),
    (o) => o.materialId || o.taskId || o.title,
  );
  return (
    <div className={s.form}>
      <p className={s.muted}>
        Compare the same scope, quantities, specifications and delivery dates.
        Choosing an offer creates a draft order; budget approval and vendor
        acknowledgement still follow.
      </p>
      {!groups.size && (
        <p>
          No enquiries yet. Create one per vendor, linked to the same material
          requirement or task.
        </p>
      )}
      {Array.from(groups, ([key, orders]) => (
        <section key={key}>
          <h2>
            {state.data.materials.find((m) => m.id === key)?.title ??
              state.data.tasks.find((t) => t.id === key)?.title ??
              key}
          </h2>
          <div className={s.scroll}>
            <table data-record-table="" className={s.table}>
              <thead>
                <tr>
                  <th>Vendor / scope</th>
                  <th>Quantity</th>
                  <th>Latest offer</th>
                  <th>Promised</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const offer = order.vendorUpdates
                    ?.filter((u) => u.kind === "quotation")
                    .at(-1);
                  return (
                    <tr key={order.id}>
                      <td>
                        <strong>{order.vendor}</strong>
                        <span className={s.detail}>
                          {order.title} · {order.sourceEnquiry ?? order.number}
                        </span>
                      </td>
                      <td>
                        {order.quantity} {order.unit}
                        {offer && offer.quantity !== order.quantity && (
                          <span className={s.detail}>
                            Vendor offered {offer.quantity}; review scope
                          </span>
                        )}
                      </td>
                      <td>
                        {offer?.unitCost !== undefined
                          ? money(
                              offer.unitCost * offer.quantity,
                              order.currency,
                            )
                          : "Awaiting quotation"}
                        {offer && (
                          <span className={s.detail}>{offer.note}</span>
                        )}
                      </td>
                      <td>{offer?.date || order.promisedDate}</td>
                      <td>
                        {order.status !== "enquiry" ? (
                          <span className={s.status}>
                            Selected · {order.number}
                          </span>
                        ) : (
                          state.canBuy && (
                            <div className={s.actions}>
                              <button
                                className={s.button}
                                onClick={() => onForm(order.id)}
                              >
                                Vendor form
                              </button>
                              <button
                                className={s.button}
                                onClick={() => onEdit(order)}
                              >
                                Edit enquiry
                              </button>
                              <button
                                className={s.button}
                                onClick={() => onChoose(order)}
                              >
                                Choose offer
                              </button>
                            </div>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
