"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Checkbox, DataGrid, ControlledModalDialog, InlineNotice, Skeleton } from "@/design-system";
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
  const t = useT();
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
      title={t("Import requirements")}
      footer={
        <div className="wd-dialog-actions">
          <Button isDisabled={busy} onPress={onClose}>{t("Cancel")}</Button>
          <Button
            variant="primary"
            isDisabled={busy || !selected.length}
            isLoading={busy}
            onPress={async () => {
              if (await run("import_scope", { refreshExisting: refresh, entryIds: selected }))
                onClose();
              else
                setError(
                  t("Scope could not be imported. Close this dialog to review the error, refresh, and try again."),
                );
            }}
          >
            {selected.length ? t("Import selected requirements ({count})", { count: selected.length }) : t("Import selected requirements")}
          </Button>
        </div>
      }
    >
      <div className={s.form}>
        {error && (
          <InlineNotice tone="error" message={translateKnown(t, error)} />
        )}
        {!content && !error && <Skeleton lines={5} />}
        {included.length > 0 && <DataGrid compactToolbar rowNumbers={false} ariaLabel={t("Requirement import")} data={included} getRowId={row=>row.id} searchLabel={t("Search requirement import")} exportFileName="requirement-import.csv" selectable={false} columns={[{id:"include",header:t("Include"),size:80,cell:({row:{original:e}})=><Checkbox aria-label={t("Include {title}", { title: e.title })} isDisabled={busy} isSelected={selected.includes(e.id)} onChange={checked=>setSelected(ids=>checked?[...ids,e.id]:ids.filter(id=>id!==e.id))}/>},{id:"title",header:t("Room / item"),size:320,accessorFn:(e)=>`${e.roomName ?? t("General")} ${e.title}`,cell:({row:{original:e}})=>{return <>
                      <strong>{e.title}</strong>
                      <small className={s.detail}>
                        {e.roomName ?? t("General")}
                      </small>
                    </>;}},
{id:"quantity",header:t("Quantity"),size:130,accessorFn:(e)=>e.quantity ?? 1,cell:({row:{original:e}})=>{return <>
                      {e.quantity ?? 1} {e.unit || "nos"}
                    </>;}},
{id:"status",header:t("In this quotation"),size:200,accessorFn:(e)=>!quote.lines.some(l=>l.scopeId===e.id)?t("New item"):quote.lines.some(l=>l.scopeId===e.id&&(l.scopeVersion!==e.version||l.specificationVersion!==e.specification?.version))?t("Source updated"):t("Already included"),cell:({row:{original:e}})=>{const prior=quote.lines.find(l=>l.scopeId===e.id);return <>
                      {!prior
                        ? <Badge tone="info">{t("New item")}</Badge>
                        : prior.scopeVersion !== e.version ||
                            prior.specificationVersion !==
                              e.specification?.version
                          ? <Badge tone="warning">{t("Source updated")}</Badge>
                          : <Badge tone="success">{t("Already included")}</Badge>}
                    </>;}}]}/>}
        {content && !included.length && (
          <p className={s.notice}>
            {(() => {
              // One sentence for translators; {link} marks where the Requirements link goes.
              const [before, after = ""] = t("No included requirements yet. Mark the intended items Included in {link}.").split("{link}");
              return <>{before}<Link href={`/workspace/pre-projects/cases/${caseId}/requirements`}>{t("Requirements")}</Link>{after}</>;
            })()}
          </p>
        )}
        {quote.lines.some(line => line.scopeId) && <Checkbox isSelected={refresh} onChange={setRefresh}>
          {t("Update existing imported items, keeping their rates and costs")}</Checkbox>}
        {quote.lines.some(line => line.scopeId) && <p className={s.muted}>
          {t("Existing quotation items are retained if they were removed from Requirements; review those items before issuing.")}</p>}
      </div>
    </ControlledModalDialog>
  );
}
