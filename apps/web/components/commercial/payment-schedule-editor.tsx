"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { DataGrid, ControlledModalDialog } from "@/design-system";
import type {
  PaymentTerm,
  PaymentTemplate,
  Quote,
} from "@/lib/commercial/types";
import {
  commercialPath,
  jsonRequest,
  money,
  quoteTotals,
  paymentMilestoneAmounts,
} from "@/lib/commercial/client";
import s from "./commercial.module.css";
export function PaymentScheduleEditor({
  quote,
  onChange,
  workspaceId,
  readOnly,
}: {
  quote: Quote;
  onChange: (q: Quote) => void;
  workspaceId: string;
  readOnly: boolean;
}) {
  const [templates, setTemplates] = useState<PaymentTemplate[]>([]),
    [library, setLibrary] = useState(false),
    [templateName, setTemplateName] = useState(""),
    [edit, setEdit] = useState<PaymentTemplate | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const terms = quote.paymentTerms ?? [],
    total = quoteTotals(quote).total;
  async function load() {
    try {
      const result = await jsonRequest<{ items: PaymentTemplate[] }>(
        commercialPath(workspaceId, "payment-templates"),
      );
      setTemplates(result.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let active = true;
    jsonRequest<{ items: PaymentTemplate[] }>(
      commercialPath(workspaceId, "payment-templates"),
    )
      .then((result) => {
        if (active) setTemplates(result.items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);
  const apply = (t: PaymentTemplate) => {
    onChange({
      ...quote,
      paymentTerms: structuredClone(t.milestones),
      paymentTemplate: { id: t.id, version: t.version, name: t.name },
    });
    setLibrary(false);
  };
  const add = (): PaymentTerm => ({
    id: crypto.randomUUID(),
    title: "New milestone",
    percent: 0,
    trigger: "",
    requiredForRelease: false,
  });
  return (
    <section
      className={s.section}
      onDragOver={(e) => {
        if (!readOnly) e.preventDefault();
      }}
      onDrop={(e) => {
        if (readOnly) return;
        const id = e.dataTransfer.getData(
          "application/wodana-payment-template",
        );
        const t = templates.find((t) => t.id === id);
        if (t) {
          e.preventDefault();
          apply(t);
        }
      }}
    >
      <div className={s.header}>
        <div>
          <h2>Payment schedule</h2>
          <p className={s.muted}>
            Shown in this quotation. Accepted milestones carry into Agreement &
            payments.
          </p>
        </div>
        {!readOnly && (
          <button
            className={s.button}
            onClick={() => {
              void load();
              setLibrary(true);
            }}
          >
            Choose / create schedule
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {!readOnly && templates.length > 0 && (
        <details className={s.section}>
          <summary>
            Saved schedules · drag one onto this section, or click to use
          </summary>
          <div className={s.actions} style={{ paddingBlock: ".7rem" }}>
            {templates.map((t) => (
              <button
                key={t.id}
                className={s.button}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    "application/wodana-payment-template",
                    t.id,
                  )
                }
                onClick={() => apply(t)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </details>
      )}
      {quote.paymentTemplate && (
        <p className={s.muted}>
          {quote.paymentTemplate.name} · template v
          {quote.paymentTemplate.version} · editable copy for this quotation
        </p>
      )}
      {!terms.length ? (
        <p className={s.notice}>
          Choose a reusable schedule, or add milestones. Their percentages must
          total 100% before review.
        </p>
      ) : (
        <MilestoneRows
          rows={terms}
          onChange={(rows) => onChange({ ...quote, paymentTerms: rows })}
          readOnly={readOnly}
          total={total}
          currency={quote.currency}
        />
      )}
      {!readOnly && (
        <button
          className={s.button}
          style={{ marginTop: ".7rem" }}
          onClick={() =>
            onChange({ ...quote, paymentTerms: [...terms, add()] })
          }
        >
          <Plus size={14} />
          Add milestone
        </button>
      )}
      <ControlledModalDialog
        isOpen={library}
        onOpenChange={setLibrary}
        title="Payment schedules"
        size="lg"
      >
        <div className={s.form}>
          <p className={s.muted}>
            Use a saved schedule or create one for your team. Changes here never
            alter an issued quotation.
          </p>
          {templates.map((t) => (
            <div
              className={s.section}
              key={t.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/wodana-payment-template",
                  t.id,
                );
              }}
            >
              <div className={s.header}>
                <div>
                  <strong>{t.name}</strong>
                  <p className={s.muted}>
                    {t.milestones
                      .map((m) => `${m.percent}% ${m.title}`)
                      .join(" · ")}
                  </p>
                </div>
                <div className={s.actions}>
                  <button
                    className={s.button}
                    onClick={() => {
                      setEdit(structuredClone(t));
                      setTemplateName(t.name);
                    }}
                  >
                    Edit
                  </button>
                  <button className={s.primary} onClick={() => apply(t)}>
                    Use schedule
                  </button>
                </div>
              </div>
            </div>
          ))}
          <button
            className={s.button}
            onClick={() => {
              setEdit({
                id: crypto.randomUUID(),
                name: "",
                version: 0,
                milestones: [
                  {
                    ...add(),
                    title: "Advance",
                    percent: 50,
                    trigger: "On signing the agreement",
                    requiredForRelease: true,
                  },
                  {
                    ...add(),
                    title: "Before installation",
                    percent: 40,
                    trigger: "Before site installation",
                  },
                  {
                    ...add(),
                    title: "Handover",
                    percent: 10,
                    trigger: "On completed handover",
                  },
                ],
              });
              setTemplateName("");
            }}
          >
            <Plus size={14} />
            Create reusable schedule
          </button>
          {edit && (
            <>
              <label>
                Schedule name
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g. Residential · 50 / 40 / 10"
                />
              </label>
              <MilestoneRows
                rows={edit.milestones}
                onChange={(rows) => setEdit({ ...edit, milestones: rows })}
                readOnly={false}
              />
              <button
                className={s.button}
                onClick={() =>
                  setEdit({ ...edit, milestones: [...edit.milestones, add()] })
                }
              >
                Add milestone
              </button>
              {error && (
                <p role="alert" className={s.error}>
                  {error}
                </p>
              )}
              <button
                className={s.primary}
                disabled={busy || !templateName.trim()}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const saved = await jsonRequest<PaymentTemplate>(
                      commercialPath(workspaceId, "payment-templates"),
                      "PUT",
                      { ...edit, name: templateName },
                    );
                    await load();
                    apply(saved);
                    setEdit(null);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save & use schedule
              </button>
            </>
          )}
        </div>
      </ControlledModalDialog>
    </section>
  );
}
function MilestoneRows({
  rows,
  onChange,
  readOnly,
  total,
  currency,
}: {
  rows: PaymentTerm[];
  onChange: (rows: PaymentTerm[]) => void;
  readOnly: boolean;
  total?: number;
  currency?: string;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  function move(id: string, to: number) {
    const next = [...rows],
      index = next.findIndex((r) => r.id === id);
    if (index < 0 || to < 0 || to >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    onChange(next);
  }
  const patch = (id: string, v: Partial<PaymentTerm>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...v } : r)));
  return (
    <>
      <DataGrid ariaLabel="Payment schedule" data={rows} getRowId={r=>r.id} selectable={false} pinFirstColumn={false} searchLabel="Search payment schedule" exportFileName="payment-schedule.csv" getRowDragHandlers={r=>({onDragOver:e=>{if(drag)e.preventDefault();},onDrop:e=>{if(drag){e.preventDefault();move(drag,rows.findIndex(item=>item.id===r.id));setDrag(null);}}})} columns={[...(!readOnly?[{id:"order",header:"Order",size:130,enableSorting:false,enableColumnFilter:false,meta:{renderCell:(r:PaymentTerm)=>{const i=rows.findIndex(item=>item.id===r.id);return <>
                      <div className={s.rowAction}>
                        <span
                          draggable
                          onDragStart={(e) => {
                            setDrag(r.id);
                            e.dataTransfer.setData("text/plain", r.id);
                          }}
                          onDragEnd={() => setDrag(null)}
                          title="Drag to reorder"
                        >
                          <GripVertical size={16} />
                        </span>
                        <button
                          className={s.icon}
                          aria-label={`Move ${r.title} up`}
                          disabled={i === 0}
                          onClick={() => move(r.id, i - 1)}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          className={s.icon}
                          aria-label={`Move ${r.title} down`}
                          disabled={i === rows.length - 1}
                          onClick={() => move(r.id, i + 1)}
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                    </>;}}}]:[]),
{id:"title",header:"Milestone / trigger",size:300,accessorFn:(r:PaymentTerm)=>`${r.title} ${r.trigger}`,meta:{renderCell:(r:PaymentTerm)=>{const i=rows.findIndex(item=>item.id===r.id);return <>
                    {readOnly ? (
                      <>
                        {r.title}
                        <small className={s.detail}>{r.trigger}</small>
                      </>
                    ) : (
                      <>
                        <input
                          aria-label={`Milestone ${i + 1} title`}
                          value={r.title}
                          onChange={(e) =>
                            patch(r.id, { title: e.target.value })
                          }
                        />
                        <input
                          aria-label={`Milestone ${i + 1} trigger`}
                          placeholder="When is it due?"
                          value={r.trigger}
                          onChange={(e) =>
                            patch(r.id, { trigger: e.target.value })
                          }
                        />
                      </>
                    )}
                  </>;}}},
{id:"percent",header:"Percentage",size:120,accessorFn:(r:PaymentTerm)=>r.percent,meta:{renderCell:(r:PaymentTerm)=>{const i=rows.findIndex(item=>item.id===r.id);return <>
                    {readOnly ? (
                      `${r.percent}%`
                    ) : (
                      <input
                        aria-label={`Milestone ${i + 1} percentage`}
                        className={s.number}
                        type="number"
                        min=".01"
                        max={100}
                        step=".01"
                        value={r.percent}
                        onChange={(e) =>
                          patch(r.id, { percent: Number(e.target.value) })
                        }
                      />
                    )}
                  </>;}}},
...(total !== undefined?[{id:"amount",header:"Amount",size:160,accessorFn:(r:PaymentTerm)=>total === undefined ? 0 : paymentMilestoneAmounts(total, rows)[rows.findIndex(item=>item.id===r.id)],meta:{renderCell:(r:PaymentTerm)=>{const i=rows.findIndex(item=>item.id===r.id);const amount=total===undefined?0:paymentMilestoneAmounts(total, rows)[i];return <>{money(amount, currency)}</>;}}}]:[]),
{id:"release",header:"Before release",size:140,accessorFn:(r:PaymentTerm)=>r.requiredForRelease ? "Required" : "Optional",meta:{renderCell:(r:PaymentTerm)=>{const i=rows.findIndex(item=>item.id===r.id);return <>
                    {readOnly ? (
                      r.requiredForRelease ? (
                        "Required"
                      ) : (
                        "—"
                      )
                    ) : (
                      <input
                        style={{ width: "auto", minWidth: 0 }}
                        aria-label={`Milestone ${i + 1} required before release`}
                        type="checkbox"
                        checked={r.requiredForRelease}
                        onChange={(e) =>
                          patch(r.id, { requiredForRelease: e.target.checked })
                        }
                      />
                    )}
                  </>;}}},
...(!readOnly?[{id:"action",header:"Action",size:90,enableSorting:false,enableColumnFilter:false,meta:{renderCell:(r:PaymentTerm)=>{const i=rows.findIndex(item=>item.id===r.id);return <>
                      <button
                        className={s.icon}
                        aria-label={`Remove milestone ${i + 1}`}
                        onClick={() =>
                          onChange(rows.filter((m) => m.id !== r.id))
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </>;}}}]:[])]}/>
      <p className={s.muted}>
        Total: {rows.reduce((sum, r) => sum + r.percent, 0).toFixed(2)}% · Drag
        milestones or use the arrow buttons to reorder.
      </p>
    </>
  );
}
