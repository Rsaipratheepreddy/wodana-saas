"use client";
import { useState, useEffect } from "react";
import { Plus, ArrowRight, ClipboardCheck } from "lucide-react";
import { ControlledModalDialog } from "@/design-system";
import type { ProjectState } from "@/lib/projects/execution";
import { label } from "@/lib/projects/execution";
import { money } from "@/lib/commercial/client";
import s from "./project-workspace.module.css";
export type ControlKind =
  | "dispatch"
  | "commissioning"
  | "technical_query"
  | "transmittal"
  | "retention"
  | "supplier_return";
type Value = Record<string, unknown>;
type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select" | "multi";
  options?: { value: string; label: string }[];
  optional?: boolean;
};
const titles: Record<ControlKind, string> = {
  dispatch: "Dispatches",
  commissioning: "Commissioning",
  technical_query: "Technical queries",
  transmittal: "Transmittals",
  retention: "Retention",
  supplier_return: "Supplier returns & credits",
};
const singular: Record<ControlKind, string> = {
  dispatch: "dispatch",
  commissioning: "commissioning check",
  technical_query: "technical query",
  transmittal: "transmittal",
  retention: "retention",
  supplier_return: "supplier return",
};
const guidance: Record<ControlKind, string> = {
  dispatch: "Factory output → quality approval → dispatch → site receipt.",
  commissioning: "Record measured results, then request an independent review.",
  technical_query:
    "Resolve design and site questions against the approved revisions.",
  transmittal:
    "Keep a fixed record of the revisions shared and their acknowledgement.",
  retention:
    "Track held amounts, release conditions and verified accounting settlement.",
  supplier_return:
    "Return accepted stock with approval, then reconcile the supplier credit.",
};
export function ProjectControls({
  state,
  kind,
  run,
  busy,
  search = "",
  onOpenRecord,
  serverError,
  initialValues,
  taskId,
}: {
  state: ProjectState;
  kind: ControlKind;
  run: (action: string, input?: Value) => Promise<boolean>;
  busy: boolean;
  search?: string;
  onOpenRecord?: (id: string) => void;
  serverError?: string;
  initialValues?: Value;
  taskId?: string;
}) {
  const d = state.data;
  const [editor, setEditor] = useState<{
      title: string;
      action: string;
      fields: Field[];
      value: Value;
      stage?: string;
      id?: string;
    } | null>(null),
    [inspected, setInspected] = useState<Value | null>(null),
    [error, setError] = useState("");
  const rows = (({
    dispatch: d.dispatches,
    commissioning: d.commissioning,
    technical_query: d.technicalQueries,
    transmittal: d.transmittals,
    retention: d.retentions,
    supplier_return: d.supplierReturns,
  }[kind] ?? []) as unknown as Value[]).filter(row=>!taskId||row.taskId===taskId);
  const tasks = d.tasks
    .filter((t) => t.status !== "cancelled")
    .map((t) => ({ value: t.id, label: `${t.title} · ${t.area}` }));
  const people = state.members.map((m) => ({ value: m.id, label: m.name }));
  const docs = d.documents
    .filter((r) => r.status === "approved")
    .map((r) => ({ value: r.id, label: `${r.title} · ${r.revision}` }));
  const f = (
    key: string,
    label: string,
    type: Field["type"] = "text",
    options?: Field["options"],
    optional = false,
  ): Field => ({ key, label, type, options, optional });
  const canAdd =
    kind === "supplier_return"
      ? state.canBuy
      : kind === "retention"
        ? state.canReview
        : kind === "commissioning" || kind === "technical_query"
          ? state.canManage || state.canReport
          : state.canManage;
  const fields: Record<ControlKind, Field[]> = {
    dispatch: [
      f("title", "Dispatch title"),
      f(
        "taskId",
        "Factory operation",
        "select",
        tasks.filter(
          (x) => d.tasks.find((t) => t.id === x.value)?.location === "factory",
        ),
      ),
      f("quantity", "Quantity", "number"),
      f("factoryLotId", "Passed production lot", "select", d.tasks.flatMap(task=>(task.factoryLots??[]).filter(lot=>lot.status==='passed').map(lot=>({value:lot.id,label:`${task.title} · ${lot.title} · ${lot.quantity} ${lot.unit}`}))), true),
      f(
        "receivingTaskId",
        "Receiving site task (if applicable)",
        "select",
        tasks.filter((option) => {
          const task = d.tasks.find(
            (candidate) => candidate.id === option.value,
          );
          return (
            task?.location === "site" &&
            task.predecessors.some((id) =>
              d.tasks.some(
                (candidate) => candidate.id === id && candidate.location === "factory",
              ),
            )
          );
        }),
        true,
      ),
      f("destination", "Delivery destination"),
      f("dueDate", "Expected arrival", "date"),
      f("carrier", "Carrier / driver", "text", undefined, true),
      f("reference", "Delivery note", "text", undefined, true),
    ],
    commissioning: [
      f("title", "Check title"),
      f(
        "taskId",
        "Site task",
        "select",
        tasks.filter(
          (x) => d.tasks.find((t) => t.id === x.value)?.location === "site",
        ),
      ),
      f("system", "System / equipment"),
      f("ownerId", "Responsible person", "select", people),
      f("dueDate", "Test date", "date"),
      f(
        "evidence",
        "Test sheet / evidence reference",
        "textarea",
        undefined,
        true,
      ),
    ],
    technical_query: [
      f("title", "Subject"),
      f("taskIds", "Affected tasks", "multi", tasks),
      f("ownerId", "Response owner", "select", people),
      f("dueDate", "Response due", "date"),
      f("question", "Question and site impact", "textarea"),
    ],
    transmittal: [
      f("title", "Subject"),
      f("recipient", "Recipient / organisation"),
      f("dueDate", "Acknowledgement due", "date"),
      f("documentIds", "Approved revisions", "multi", docs),
      f("purpose", "Purpose / instructions", "textarea"),
    ],
    retention: [
      f("title", "Retention milestone"),
      f("amount", `Amount · ${d.scope?.currency ?? "AED"}`, "number"),
      f("dueDate", "Release due", "date"),
      f(
        "handoverId",
        "Linked handover",
        "select",
        d.handovers.map((h) => ({ value: h.id, label: h.title })),
        true,
      ),
      f("condition", "Contract condition for release", "textarea"),
    ],
    supplier_return: [
      f(
        "orderId",
        "Received order",
        "select",
        d.orders
          .filter((o) => o.materialId && o.receipts.some((r) => r.accepted > 0))
          .map((o) => ({ value: o.id, label: `${o.number} · ${o.vendor}` })),
      ),
      f("quantity", "Quantity to return", "number"),
      f(
        "creditAmount",
        `Expected credit · ${d.scope?.currency ?? "AED"}`,
        "number",
      ),
      f("reason", "Return reason", "textarea"),
    ],
  };
  useEffect(() => {
    if (!initialValues || !state.canManage) return;
    const frame = window.requestAnimationFrame(() => {
      setEditor({
        title: `Add ${singular[kind]}`,
        action: kind,
        fields: fields[kind],
        value: initialValues,
      });
    });
    return () => window.cancelAnimationFrame(frame);
    // Opening a linked action uses a stable parent payload; subsequent edits stay local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues, kind]);
  function edit(r?: Value) {
    setError("");
    setEditor({
      title: `${r ? "Edit" : "Add"} ${singular[kind]}`,
      action: kind,
      fields: fields[kind],
      value: r
        ? {
            ...r,
            documentIds: Array.isArray(r.documents)
              ? (r.documents as { id: string }[]).map((x) => x.id)
              : r.documentIds,
          }
        : {
            ownerId: state.memberId,
            readings: [{ name: "", value: 0, unit: "", min: 0, max: 0 }],
          },
    });
  }
  function transition(r: Value, status: string) {
    setError("");
    let fields: Field[] = [];
    if (kind === "dispatch" && status === "return_factory")
      fields=[f("quantity","Total quantity returned to factory","number"),f("evidence","Factory receipt evidence","textarea")];
    else if (kind === "dispatch" && status === "dispatched")
      fields = [
        f("carrier", "Carrier / driver"),
        f("reference", "Delivery note reference"),
      ];
    else if (kind === "dispatch" && status === "received")
      fields = [
        f("accepted", "Accepted quantity", "number"),
        f("rejected", "Rejected quantity", "number"),
        f("evidence", "Signed receipt / rejection evidence", "textarea"),
      ];
    else if (kind === "technical_query" && status === "answered")
      fields = [
        f("response", "Technical response", "textarea"),
        f("documentIds", "Approved supporting revisions", "multi", docs, true),
      ];
    else if (
      kind === "transmittal" &&
      ["issued", "acknowledged"].includes(status)
    )
      fields = [
        f(
          "evidence",
          status === "issued"
            ? "Sharing reference / delivery evidence"
            : "Recipient acknowledgement",
          "textarea",
        ),
      ];
    else if (kind === "retention")
      fields =
        status === "released"
          ? [
              f(
                "evidence",
                "Condition fulfilled / release approval",
                "textarea",
              ),
            ]
          : [
              f("reference", "Verified accounting receipt reference"),
              f("evidence", "Settlement evidence", "textarea"),
            ];
    else if (kind === "supplier_return" && status === "dispatched")
      fields = [
        f("reference", "Supplier return note"),
        f("evidence", "Collection / dispatch evidence", "textarea"),
      ];
    else if (kind === "supplier_return" && status === "credited")
      fields = [
        f("reference", "Accounting credit note reference"),
        f("creditAmount", "Verified credit amount", "number"),
        f("evidence", "Accounting reconciliation evidence", "textarea"),
      ];
    else fields = [f("note", "Review note / evidence", "textarea")];
    setEditor({
      title: `${label(status)} · ${String(r.title ?? "Supplier return")}`,
      action: status==="return_factory"?"dispatch_return":`${kind}_status`,
      stage: status,
      id: String(r.id),
      fields,
      value: {
        quantity:r.rejected,
        accepted: r.quantity,
        rejected: 0,
        carrier: r.carrier,
        reference: r.reference,
        creditAmount: r.creditAmount,
      },
    });
  }
  function actions(r: Value): { title: string; status: string }[] {
    const status = String(r.status);
    if (kind === "dispatch")
      return status === "draft" && state.canReview
        ? [{ title: "Approve for dispatch", status: "ready" }]
        : status === "ready" && state.canManage
          ? [{ title: "Record dispatch", status: "dispatched" }]
          : status === "dispatched" && state.canReview
            ? [{ title: "Receive at site", status: "received" }]
            : status === "received" && state.canManage && Number(r.rejected)>Number(r.returnedToFactory??0)
              ? [{title:"Return rejected output",status:"return_factory"}] : [];
    if (kind === "commissioning")
      return status === "draft" && canAdd
        ? [{ title: "Submit check", status: "submitted" }]
        : status === "submitted" && state.canReview
          ? [
              { title: "Pass", status: "passed" },
              { title: "Return", status: "returned" },
            ]
          : [];
    if (kind === "technical_query")
      return status === "open" &&
        (state.canManage || r.ownerId === state.memberId)
        ? [{ title: "Respond", status: "answered" }]
        : status === "answered" && state.canReview
          ? [{ title: "Close query", status: "closed" }]
          : [];
    if (kind === "transmittal" && state.canManage)
      return status === "draft"
        ? [{ title: "Record issue", status: "issued" }]
        : status === "issued"
          ? [{ title: "Acknowledge", status: "acknowledged" }]
          : [];
    if (kind === "retention" && state.canReview)
      return status === "held"
        ? [{ title: "Release", status: "released" }]
        : status === "released"
          ? [{ title: "Verify settlement", status: "verified" }]
          : [];
    if (kind === "supplier_return")
      return status === "draft" && state.canReview
        ? [{ title: "Approve return", status: "approved" }]
        : status === "approved" && state.canBuy
          ? [{ title: "Record dispatch", status: "dispatched" }]
          : status === "dispatched" && state.canReview
            ? [{ title: "Verify credit", status: "credited" }]
            : [];
    return [];
  }
  return (
    <div className={s.form}>
      <div className={s.row}>
        <div>
          <h2>{titles[kind]}</h2>
          <p className={s.muted}>{guidance[kind]}</p>
        </div>
        {canAdd && (
          <button className={s.primary} disabled={busy} onClick={() => edit()}>
            <Plus size={15} />
            Add {singular[kind]}
          </button>
        )}
      </div>
      <div className={s.scroll}>
        <table data-record-table="" className={s.table}>
          <thead>
            <tr>
              <th>Record / scope</th>
              <th>Responsibility / quantity</th>
              <th>Due date</th>
              <th>Status</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) =>
                JSON.stringify(r).toLowerCase().includes(search.toLowerCase()),
              )
              .map((r) => {
                const order = d.orders.find((o) => o.id === r.orderId),
                  task = d.tasks.find((t) => t.id === r.taskId);
                return (
                  <tr key={String(r.id)}>
                    <td>
                      <button
                        className={s.link}
                        onClick={() => setInspected(r)}
                      >
                        {String(r.title ?? order?.number ?? "Supplier return")}
                      </button>
                      <span className={s.detail}>
                        {String(
                          r.number ??
                            task?.title ??
                            order?.vendor ??
                            r.purpose ??
                            "",
                        )}
                      </span>
                    </td>
                    <td>
                      {String(
                        r.destination ??
                          r.recipient ??
                          state.members.find((m) => m.id === r.ownerId)?.name ??
                          order?.vendor ??
                          "—",
                      )}
                      <span className={s.detail}>
                        {r.amount !== undefined
                          ? money(Number(r.amount), d.scope?.currency ?? "AED")
                          : r.quantity !== undefined
                            ? `${r.quantity} ${r.unit ?? order?.unit ?? ""}`
                            : r.system
                              ? String(r.system)
                              : ""}
                        {r.creditAmount !== undefined
                          ? ` · ${money(Number(r.creditAmount), d.scope?.currency ?? "AED")} credit`
                          : ""}
                      </span>
                    </td>
                    <td>{String(r.dueDate ?? "—")}</td>
                    <td>
                      <span
                        className={s.status}
                        data-state={
                          [
                            "passed",
                            "verified",
                            "credited",
                            "received",
                            "acknowledged",
                            "closed",
                          ].includes(String(r.status))
                            ? "completed"
                            : r.status === "returned"
                              ? "blocked"
                              : String(r.status)
                        }
                      >
                        {label(String(r.status))}
                      </span>
                    </td>
                    <td>
                      <div className={s.actions}>
                        {onOpenRecord && (
                          <button
                            className={s.button}
                            onClick={() => onOpenRecord(String(r.id))}
                          >
                            Comments & files
                          </button>
                        )}
                        {canAdd &&
                          ["draft", "returned", "held"].includes(
                            String(r.status),
                          ) && (
                            <button
                              className={s.button}
                              disabled={busy}
                              onClick={() => edit(r)}
                            >
                              Edit
                            </button>
                          )}
                        {actions(r).map((a) => (
                          <button
                            className={s.button}
                            disabled={busy}
                            key={a.status}
                            onClick={() => transition(r, a.status)}
                          >
                            {a.title}
                            <ArrowRight size={13} />
                          </button>
                        ))}
                        {!actions(r).length &&
                          !["draft", "returned", "held"].includes(
                            String(r.status),
                          ) && <span className={s.muted}>Recorded</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {!rows.length && (
          <div className={s.empty}>
            <ClipboardCheck size={24} />
            <h3>No {titles[kind].toLowerCase()} yet</h3>
            <p>{guidance[kind]}</p>
          </div>
        )}
      </div>
      <ControlledModalDialog
        isOpen={Boolean(editor)}
        onOpenChange={(v) => !v && setEditor(null)}
        title={editor?.title ?? ""}
      >
        {editor && (
          <form
            className={s.form}
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              const record = { ...editor.value };
              for (const field of editor.fields)
                if (field.type === "number")
                  record[field.key] = Number(record[field.key] ?? 0);
              if (kind === "commissioning" && !editor.stage)
                record.readings = ((record.readings ?? []) as Value[]).map(
                  (r) => ({
                    ...r,
                    value: Number(r.value),
                    min: Number(r.min),
                    max: Number(r.max),
                  }),
                );
              const payload = editor.stage
                ? { ...record, id: editor.id, status: editor.stage }
                : { record };
              if (await run(editor.action, payload)) setEditor(null);
              else
                setError(
                  "This action could not be completed. Review the project message above and the current record.",
                );
            }}
          >
            {error && (
              <p className={s.error} role="alert">
                {serverError || error}
              </p>
            )}
            <div className={s.grid}>
              {editor.fields.map((field) => (
                <div key={field.key} className={s.field}>
                  <span>{field.label}</span>
                  {field.optional && (
                    <span className={s.muted}> · optional</span>
                  )}
                  {field.type === "multi" ? (
                    <div className={s.checkList}>
                      {field.options?.map((o) => (
                        <label key={o.value}>
                          <input
                            type="checkbox"
                            checked={(
                              (editor.value[field.key] ?? []) as string[]
                            ).includes(o.value)}
                            onChange={(e) =>
                              setEditor({
                                ...editor,
                                value: {
                                  ...editor.value,
                                  [field.key]: e.target.checked
                                    ? [
                                        ...((editor.value[field.key] ??
                                          []) as string[]),
                                        o.value,
                                      ]
                                    : (
                                        (editor.value[field.key] ??
                                          []) as string[]
                                      ).filter((v) => v !== o.value),
                                },
                              })
                            }
                          />
                          {o.label}
                        </label>
                      ))}
                    </div>
                  ) : field.type === "select" ? (
                    <select
                      aria-label={field.label}
                      required={!field.optional}
                      value={String(editor.value[field.key] ?? "")}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          value: {
                            ...editor.value,
                            [field.key]: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="">Choose…</option>
                      {field.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      aria-label={field.label}
                      required={!field.optional}
                      rows={3}
                      value={String(editor.value[field.key] ?? "")}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          value: {
                            ...editor.value,
                            [field.key]: e.target.value,
                          },
                        })
                      }
                    />
                  ) : (
                    <input
                      aria-label={field.label}
                      required={!field.optional}
                      type={field.type ?? "text"}
                      min={field.type === "number" ? 0 : undefined}
                      step={field.type === "number" ? "any" : undefined}
                      value={String(editor.value[field.key] ?? "")}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          value: {
                            ...editor.value,
                            [field.key]: e.target.value,
                          },
                        })
                      }
                    />
                  )}
                </div>
              ))}
            </div>
            {kind === "commissioning" && !editor.stage && (
              <div className={s.form}>
                <div className={s.row}>
                  <h3>Measured readings</h3>
                  <button
                    type="button"
                    className={s.button}
                    onClick={() =>
                      setEditor({
                        ...editor,
                        value: {
                          ...editor.value,
                          readings: [
                            ...((editor.value.readings ?? []) as Value[]),
                            { name: "", value: 0, unit: "", min: 0, max: 0 },
                          ],
                        },
                      })
                    }
                  >
                    Add reading
                  </button>
                </div>
                {((editor.value.readings ?? []) as Value[]).map((r, index) => (
                  <div className={s.reading} key={index}>
                    {(["name", "value", "unit", "min", "max"] as const).map(
                      (key) => (
                        <label key={key}>
                          {
                            {
                              name: "Test point",
                              value: "Reading",
                              unit: "Unit",
                              min: "Min",
                              max: "Max",
                            }[key]
                          }
                          <input
                            required
                            aria-label={`${key} ${index + 1}`}
                            type={
                              ["value", "min", "max"].includes(key)
                                ? "number"
                                : "text"
                            }
                            step="any"
                            value={String(r[key] ?? "")}
                            onChange={(e) => {
                              const readings = [
                                ...(editor.value.readings as Value[]),
                              ];
                              readings[index] = { ...r, [key]: e.target.value };
                              setEditor({
                                ...editor,
                                value: { ...editor.value, readings },
                              });
                            }}
                          />
                        </label>
                      ),
                    )}
                    <button
                      type="button"
                      className={s.button}
                      aria-label={`Remove reading ${index + 1}`}
                      onClick={() =>
                        setEditor({
                          ...editor,
                          value: {
                            ...editor.value,
                            readings: (editor.value.readings as Value[]).filter(
                              (_, n) => n !== index,
                            ),
                          },
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className={s.actions}>
              <button
                type="button"
                className={s.button}
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button className={s.primary} disabled={busy}>
                {busy ? "Saving…" : editor.stage ? "Confirm" : "Save draft"}
              </button>
            </div>
          </form>
        )}
      </ControlledModalDialog>
      <ControlledModalDialog
        isOpen={Boolean(inspected)}
        onOpenChange={(v) => !v && setInspected(null)}
        title={String(inspected?.title ?? "Record details")}
      >
        {inspected && (
          <div className={s.form}>
            {Object.entries(inspected)
              .filter(
                ([key, value]) =>
                  ![
                    "id",
                    "authorId",
                    "preparedBy",
                    "reviewedBy",
                    "approvedBy",
                    "verifiedBy",
                    "ownerId",
                    "taskId",
                    "orderId",
                    "materialId",
                    "taskIds",
                    "handoverId",
                  ].includes(key) &&
                  value !== "" &&
                  value !== undefined,
              )
              .map(([key, value]) => (
                <div key={key}>
                  <strong>{label(key.replace(/([A-Z])/g, " $1"))}</strong>
                  {Array.isArray(value) ? (
                    value.map((v, n) => (
                      <p key={n} className={s.muted}>
                        {typeof v === "object"
                          ? Object.values(v).join(" · ")
                          : String(v)}
                      </p>
                    ))
                  ) : (
                    <p className={s.muted}>{String(value)}</p>
                  )}
                </div>
              ))}
          </div>
        )}
      </ControlledModalDialog>
    </div>
  );
}
