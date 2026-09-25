"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Checkbox, DataGrid, ControlledModalDialog } from "@/design-system";
import { caseRequest, type CaseContent } from "@/lib/pre-project/content";
import type { Quote } from "@/lib/commercial/types";
import s from "./commercial.module.css";
export function ScopeImport({
  workspaceId,
  caseId,
  quote,
  open,
  onClose,
  busy,
  run,
}: {
  workspaceId: string;
  caseId: string;
  quote: Quote;
  open: boolean;
  onClose: () => void;
  busy: boolean;
  run: (action: string, b: Record<string, unknown>) => Promise<boolean>;
}) {
  const [content, setContent] = useState<CaseContent | null>(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(false);
  const [selected,setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    setContent(null);setError('');setSelected([]);setRefresh(false);
    let live = true;
    caseRequest<CaseContent>(workspaceId, caseId, "brief")
      .then((c) => {
        if (live) {
          setContent(c);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [open, workspaceId, caseId]);
  const included =
    content?.entries.filter(
      (e) =>
        e.kind === "requirement" &&
        e.scopeStatus === "included" &&
        !e.archivedAt,
    ) ?? [];
  return (
    <ControlledModalDialog
      size="lg"
      isOpen={open}
      onOpenChange={(v) => !v && onClose()}
      title="Import requirements"
    >
      <div className={s.form}>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <p className={s.muted}>
          Choose the requirements to add. Existing prices stay unchanged; set quantities and prices before review.
        </p>
        {!content && !error && <p>Loading requirements…</p>}
        {included.length > 0 && <DataGrid compactToolbar rowNumbers={false} ariaLabel="Requirement import" data={included} getRowId={row=>row.id} searchLabel="Search requirement import" exportFileName="requirement-import.csv" selectable={false} columns={[{id:"include",header:"Include",size:80,cell:({row:{original:e}})=><Checkbox aria-label={`Include ${e.title}`} isDisabled={busy} isSelected={selected.includes(e.id)} onChange={checked=>setSelected(ids=>checked?[...ids,e.id]:ids.filter(id=>id!==e.id))}/>},{id:"title",header:"Room / item",size:320,accessorFn:(e)=>`${e.roomName ?? "General"} ${e.title}`,cell:({row:{original:e}})=>{return <>
                      <strong>{e.title}</strong>
                      <small className={s.detail}>
                        {e.roomName ?? "General"}
                      </small>
                    </>;}},
{id:"quantity",header:"Quantity",size:130,accessorFn:(e)=>e.quantity ?? 1,cell:({row:{original:e}})=>{return <>
                      {e.quantity ?? 1} {e.unit || "nos"}
                    </>;}},
{id:"status",header:"In this quotation",size:200,accessorFn:(e)=>!quote.lines.some(l=>l.scopeId===e.id)?"New item":quote.lines.some(l=>l.scopeId===e.id&&(l.scopeVersion!==e.version||l.specificationVersion!==e.specification?.version))?"Source updated":"Already included",cell:({row:{original:e}})=>{const prior=quote.lines.find(l=>l.scopeId===e.id);return <>
                      <span className={s.status}>
                        {!prior
                          ? "New item"
                          : prior.scopeVersion !== e.version ||
                              prior.specificationVersion !==
                                e.specification?.version
                            ? "Source updated"
                            : "Already included"}
                      </span>
                    </>;}}]}/>}
        {content && !included.length && (
          <p className={s.notice}>
            No included requirements yet. Mark the intended items Included in{" "}
            <Link href={`/workspace/pre-projects/cases/${caseId}/requirements`}>
              Requirements
            </Link>
            .
          </p>
        )}
        {quote.lines.some(line => line.scopeId) && <Checkbox isSelected={refresh} onChange={setRefresh}>
          Update existing imported items, keeping their rates and costs
        </Checkbox>}
        {quote.lines.some(line => line.scopeId) && <p className={s.muted}>
          Existing quotation items are retained if they were removed from
          Requirements; review those items before issuing.
        </p>}
        <Button
          variant="primary"
          isDisabled={busy || !selected.length}
          isLoading={busy}
          onPress={async () => {
            if (await run("import_scope", { refreshExisting: refresh, entryIds: selected }))
              onClose();
            else
              setError(
                "Scope could not be imported. Close this dialog to review the error, refresh, and try again.",
              );
          }}
        >
          Import selected requirements{selected.length ? ` (${selected.length})` : ""}
        </Button>
      </div>
    </ControlledModalDialog>
  );
}
