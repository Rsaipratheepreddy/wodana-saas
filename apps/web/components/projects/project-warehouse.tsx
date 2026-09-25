"use client";
import { useEffect, useRef, useState } from "react";
import { ControlledModalDialog } from "@/design-system";
import { jsonRequest } from "@/lib/commercial/client";
import {
  projectPath,
  type ProjectState,
  label,
} from "@/lib/projects/execution";
import type {
  StockState,
  StockEndpoint,
  StockTransfer,
} from "../../../../services/business-core/src/projects/project-stock.types";
import s from "./project-workspace.module.css";
type Values = Record<string, string>;
export function ProjectWarehouse({
  state,
  onRefresh,
  materialId,
}: {
  state: ProjectState;
  onRefresh: () => Promise<void>;
  materialId?: string;
}) {
  const [data, setData] = useState<StockState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editor, setEditor] = useState<{
      action: string;
      title: string;
      record?: StockTransfer;
    } | null>(null),
    [value, setValue] = useState<Values>({});
  const retry = useRef<{ body: string; id: string } | null>(null);
  const path = projectPath(state.workspaceId, `${state.id}/stock`);
  useEffect(() => {
    let alive = true;
    jsonRequest<StockState>(path)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [path]);
  const selectedMaterial=state.data.materials.find(m=>m.id===materialId);
  const matches=(item:{catalogId:string;catalogVersion:number;unit:string})=>!selectedMaterial||(Boolean(selectedMaterial.catalogId)&&item.catalogId===selectedMaterial.catalogId&&item.catalogVersion===selectedMaterial.catalogVersion&&item.unit===selectedMaterial.unit);
  const locations = [
    ...(data?.stock ?? []).filter(matches).map((s) => ({
      key: `warehouse:${s.id}`,
      label: `${s.location} · ${s.title} (${s.quantity - s.reserved} ${s.unit} available)`,
      endpoint: { kind: "warehouse", id: s.id } as StockEndpoint,
    })),
    ...(data?.projectMaterials ?? []).filter(matches).map((m) => ({
      key: `project:${m.projectId}:${m.id}`,
      label: `${m.projectName} · ${m.title} (${m.available} ${m.unit} available)`,
      endpoint: {
        kind: "project",
        id: m.projectId,
        materialId: m.id,
      } as StockEndpoint,
    })),
  ];
  function open(action: string, title: string, record?: StockTransfer) {
    setError("");
    setValue(
      record
        ? {
            accepted: String(record.quantity),
            rejected: "0",
            disposition: "return_to_source",
          }
        : action==='request_transfer'&&selectedMaterial ? {title:`${selectedMaterial.title} · transfer`,destination:`project:${state.id}:${selectedMaterial.id}`,dueDate:selectedMaterial.needBy} : {},
    );
    setEditor({ action, title, record });
  }
  async function submit() {
    if (!editor || busy) return;
    const payload: Record<string, unknown> = {
      action: editor.action,
      ...value,
    };
    if (editor.record) payload.id = editor.record.id;
    if (editor.action === "opening_stock") {
      const material = data?.projectMaterials.find(
        (m) => m.id === value.materialId && m.projectId === state.id,
      );
      if (!material) {
        setError("Choose a catalog-linked company material in this project.");
        return;
      }
      Object.assign(payload, {
        catalogId: material.catalogId,
        catalogVersion: material.catalogVersion,
        unit: material.unit,
        quantity: Number(value.quantity),
      });
    }
    if (editor.action === "request_transfer")
      Object.assign(payload, {
        source: locations.find((l) => l.key === value.source)?.endpoint,
        destination: locations.find((l) => l.key === value.destination)
          ?.endpoint,
        quantity: Number(value.quantity),
      });
    if (editor.action === "receive_transfer")
      Object.assign(payload, {
        accepted: Number(value.accepted),
        rejected: Number(value.rejected),
      });
    const body = JSON.stringify(payload);
    if (retry.current?.body !== body)
      retry.current = { body, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      setData(
        await jsonRequest<StockState>(path, "POST", {
          ...payload,
          requestId: retry.current.id,
        }),
      );
      retry.current = null;
      setEditor(null);
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const input = (key: string, title: string, type = "text") => (
    <label className={s.field}>
      {title}
      <input
        required
        type={type}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "any" : undefined}
        value={value[key] ?? ""}
        onChange={(e) => setValue({ ...value, [key]: e.target.value })}
      />
    </label>
  );
  const select = (
    key: string,
    title: string,
    options: { key: string; label: string }[],
  ) => (
    <label className={s.field}>
      {title}
      <select
        required
        value={value[key] ?? ""}
        onChange={(e) => setValue({ ...value, [key]: e.target.value })}
      >
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className={s.form}>
      {error && !editor && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div className={s.row}>
        <div>
          <h2>{selectedMaterial?selectedMaterial.title:"Warehouse & transfers"}</h2>
          <p className={s.muted}>
            Reserve stock before dispatch. Only accepted receipts become
            available at the destination.
          </p>
        </div>
        <div className={s.actions}>
          {state.canBuy && state.canReview && (
            <button
              className={s.button}
              disabled={busy}
              onClick={() =>
                open("opening_stock", "Record verified opening stock")
              }
            >
              Opening stock
            </button>
          )}
          {state.canBuy && (
            <button
              className={s.primary}
              disabled={!data || busy || Boolean(selectedMaterial&&!selectedMaterial.catalogId)}
              onClick={() => open("request_transfer", "Request stock transfer")}
            >
              Request transfer
            </button>
          )}
        </div>
      </div>
      {selectedMaterial&&!selectedMaterial.catalogId&&<p role="status">Link this material to a catalog item before transferring matching stock.</p>}
      {!data && !error && <p className={s.muted}>Loading stock…</p>}
      <div className={s.scroll}>
        <table data-record-table="" className={s.table}>
          <thead>
            <tr>
              <th>Warehouse / material</th>
              <th>On hand</th>
              <th>Reserved</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            {data?.stock.filter(matches).map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.title}</strong>
                  <span className={s.detail}>
                    {item.location} · catalog v{item.catalogVersion}
                  </span>
                </td>
                <td>
                  {item.quantity} {item.unit}
                </td>
                <td>
                  {item.reserved} {item.unit}
                </td>
                <td>
                  {item.quantity - item.reserved} {item.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.stock.length && (
          <p className={s.muted}>
            No warehouse stock recorded. A stock reviewer can enter the verified
            opening balance.
          </p>
        )}
      </div>
      <h3>Transfer register</h3>
      <div className={s.scroll}>
        <table data-record-table="" className={s.table}>
          <thead>
            <tr>
              <th>Transfer</th>
              <th>Route</th>
              <th>Quantity / receipt</th>
              <th>Status</th>
              <th>Next action</th>
            </tr>
          </thead>
          <tbody>
            {data?.transfers.filter(t=>!selectedMaterial||(t.destination.kind==="project"&&t.destination.id===state.id&&t.destination.materialId===selectedMaterial.id)||(t.source.kind==="project"&&t.source.id===state.id&&t.source.materialId===selectedMaterial.id)).map((t) => {
              const name = (e: StockEndpoint) =>
                locations
                  .find((l) => JSON.stringify(l.endpoint) === JSON.stringify(e))
                  ?.label.split(" (")[0] ?? e.kind;
              return (
                <tr key={t.id}>
                  <td>
                    <strong>{t.title}</strong>
                    <span className={s.detail}>
                      {t.dueDate} · {t.reference}
                    </span>
                  </td>
                  <td>
                    {name(t.source)}
                    <span className={s.detail}>→ {name(t.destination)}</span>
                  </td>
                  <td>
                    {t.quantity} {t.unit}
                    {t.status === "received" && (
                      <span className={s.detail}>
                        {t.accepted} accepted · {t.rejected} rejected
                        {t.rejectionResolved ? " · resolved" : ""}
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={s.status}
                      data-state={
                        t.status === "received" && t.rejectionResolved
                          ? "completed"
                          : t.status
                      }
                    >
                      {label(t.status)}
                    </span>
                  </td>
                  <td>
                    <div className={s.actions}>
                      {t.status === "requested" && state.canReview && (
                        <button
                          className={s.button}
                          onClick={() =>
                            open(
                              "approve_transfer",
                              "Approve & reserve stock",
                              t,
                            )
                          }
                        >
                          Approve & reserve
                        </button>
                      )}
                      {t.status === "approved" && state.canBuy && (
                        <button
                          className={s.button}
                          onClick={() =>
                            open(
                              "dispatch_transfer",
                              "Record transfer dispatch",
                              t,
                            )
                          }
                        >
                          Dispatch
                        </button>
                      )}
                      {t.status === "dispatched" && state.canReview && (
                        <button
                          className={s.button}
                          onClick={() =>
                            open(
                              "receive_transfer",
                              "Receive stock transfer",
                              t,
                            )
                          }
                        >
                          Receive
                        </button>
                      )}
                      {t.status === "received" &&
                        !t.rejectionResolved &&
                        state.canReview && (
                          <button
                            className={s.button}
                            onClick={() =>
                              open(
                                "resolve_rejection",
                                "Resolve rejected stock",
                                t,
                              )
                            }
                          >
                            Resolve rejection
                          </button>
                        )}
                      {["requested", "approved"].includes(t.status) &&
                        state.canBuy && (
                          <button
                            className={s.button}
                            onClick={() =>
                              open(
                                "cancel_transfer",
                                "Cancel stock transfer",
                                t,
                              )
                            }
                          >
                            Cancel
                          </button>
                        )}
                    </div>
                    <details>
                      <summary>History</summary>
                      {t.history.map((h, n) => (
                        <p className={s.detail} key={n}>
                          {label(h.action)} · {new Date(h.at).toLocaleString()}{" "}
                          · {h.reference}
                        </p>
                      ))}
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ControlledModalDialog
        isOpen={Boolean(editor)}
        onOpenChange={(v) => !v && setEditor(null)}
        title={editor?.title ?? ""}
      >
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          {editor?.action === "opening_stock" ? (
            <>
              {input("location", "Warehouse / stock location")}
              {select(
                "materialId",
                "Project catalog material",
                (data?.projectMaterials ?? [])
                  .filter((m) => m.projectId === state.id)
                  .map((m) => ({ key: m.id, label: m.title })),
              )}
              {input("quantity", "Verified opening quantity", "number")}
            </>
          ) : editor?.action === "request_transfer" ? (
            <>
              {input("title", "Transfer title")}
              {select("source", "From", locations)}
              {select("destination", "To", locations)}
              <div className={s.grid}>
                {input("quantity", "Quantity", "number")}
                {input("dueDate", "Required date", "date")}
              </div>
              <p className={s.muted}>
                Source and destination must use the same catalog material,
                version and unit.
              </p>
            </>
          ) : editor?.action === "receive_transfer" ? (
            <div className={s.grid}>
              {input("accepted", "Accepted quantity", "number")}
              {input("rejected", "Rejected / quarantined quantity", "number")}
            </div>
          ) : editor?.action === "resolve_rejection" ? (
            select("disposition", "Disposition", [
              { key: "return_to_source", label: "Return to source stock" },
              {
                key: "accept_after_inspection",
                label: "Accept after quality inspection",
              },
            ])
          ) : null}
          {input(
            "reference",
            editor?.action === "opening_stock"
              ? "Stock count / verified accounting reference"
              : "Evidence / reference",
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
              {busy ? "Saving…" : "Confirm"}
            </button>
          </div>
        </form>
      </ControlledModalDialog>
    </div>
  );
}
