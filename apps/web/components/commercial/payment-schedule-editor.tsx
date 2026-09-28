"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useEffect, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  GripVertical,
  History,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  ConfirmationDialog,
  ControlledModalDialog,
  DataGrid,
  type DataGridColumn,
  IconButton,
  InspectorSheet,
  NumericInput,
  TextInput,
  useDesignSystem,
  VisuallyHidden,
} from "@/design-system";
import type { PaymentTerm, PaymentTemplate, Quote } from "@/lib/commercial/types";
import {
  commercialPath,
  jsonRequest,
  money,
  paymentMilestoneAmounts,
  quoteTotals,
} from "@/lib/commercial/client";
import type { WorkspaceConfigurationRevision } from "@/lib/workspace/company-profile";
import s from "./commercial.module.css";

const newMilestone = (): PaymentTerm => ({
  id: crypto.randomUUID(),
  title: "New milestone",
  percent: 0,
  trigger: "",
  requiredForRelease: false,
  requiredForProduction: false,
});

function starterTemplate(): PaymentTemplate {
  return {
    id: crypto.randomUUID(),
    name: "",
    version: 0,
    milestones: [
      { ...newMilestone(), title: "Advance", percent: 50, trigger: "On signing the agreement", requiredForRelease: true },
      { ...newMilestone(), title: "Before installation", percent: 40, trigger: "Before site installation" },
      { ...newMilestone(), title: "Handover", percent: 10, trigger: "On completed handover" },
    ],
  };
}

export function PaymentScheduleEditor({
  quote,
  onChange,
  workspaceId,
  readOnly,
}: {
  quote: Quote;
  onChange: (quote: Quote) => void;
  workspaceId: string;
  readOnly: boolean;
}) {
  const t = useT();
  const [templates, setTemplates] = useState<PaymentTemplate[]>([]);
  const [library, setLibrary] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [edit, setEdit] = useState<PaymentTemplate | null>(null);
  const [historyTemplate, setHistoryTemplate] = useState<PaymentTemplate | null>(null);
  const [revisions, setRevisions] = useState<WorkspaceConfigurationRevision[]>([]);
  const [archiveTarget, setArchiveTarget] = useState<PaymentTemplate | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<WorkspaceConfigurationRevision | null>(null);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const terms = quote.paymentTerms ?? [];
  const total = quoteTotals(quote).total;

  async function load() {
    try {
      const result = await jsonRequest<{ items: PaymentTemplate[] }>(
        commercialPath(workspaceId, "payment-templates"),
      );
      setTemplates(result.items);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Payment schedules could not be loaded.");
    }
  }

  useEffect(() => {
    let active = true;
    jsonRequest<{ items: PaymentTemplate[] }>(commercialPath(workspaceId, "payment-templates"))
      .then((result) => {
        if (active) setTemplates(result.items);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : "Payment schedules could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const apply = (template: PaymentTemplate) => {
    onChange({
      ...quote,
      paymentTerms: structuredClone(template.milestones),
      paymentTemplate: { id: template.id, version: template.version, name: template.name },
    });
    setLibrary(false);
  };

  const openHistory = async (template: PaymentTemplate) => {
    setLibrary(false);
    setHistoryTemplate(template);
    setHistoryError("");
    setRevisions([]);
    try {
      setRevisions(
        await jsonRequest<WorkspaceConfigurationRevision[]>(
          commercialPath(workspaceId, `payment-templates/${template.id}/history`),
        ),
      );
    } catch (failure) {
      setHistoryError(failure instanceof Error ? failure.message : "Schedule history could not be loaded.");
    }
  };

  const archiveTemplate = async () => {
    if (!archiveTarget || busy) return;
    setBusy(true);
    setError("");
    try {
      await jsonRequest(
        commercialPath(workspaceId, `payment-templates/${archiveTarget.id}/archive`),
        "POST",
        { version: archiveTarget.version },
      );
      if (quote.paymentTemplate?.id === archiveTarget.id) onChange({ ...quote, paymentTemplate: undefined });
      setArchiveTarget(null);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Schedule could not be archived.");
      setArchiveTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    if (!historyTemplate || !rollbackTarget || busy) return;
    setBusy(true);
    setHistoryError("");
    try {
      const restored = await jsonRequest<PaymentTemplate>(
        commercialPath(workspaceId, `payment-templates/${historyTemplate.id}/rollback`),
        "POST",
        { version: historyTemplate.version, revisionId: rollbackTarget.id },
      );
      setRollbackTarget(null);
      setHistoryTemplate(null);
      await load();
      apply(restored);
    } catch (failure) {
      setHistoryError(failure instanceof Error ? failure.message : "Schedule revision could not be restored.");
      setRollbackTarget(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className={s.section}
      onDragOver={(event) => {
        if (!readOnly) event.preventDefault();
      }}
      onDrop={(event) => {
        if (readOnly) return;
        const id = event.dataTransfer.getData("application/wodana-payment-template");
        const template = templates.find((item) => item.id === id);
        if (template) {
          event.preventDefault();
          apply(template);
        }
      }}
    >
      <div className={s.header}>
        <div>
          <h2>{t("Payment schedule")}</h2>
          <p className={s.muted}>{t("Accepted milestones carry into the agreement and payment tracking.")}</p>
        </div>
        {!readOnly ? (
          <Button onPress={() => { void load(); setLibrary(true); }}>{t("Choose schedule")}</Button>
        ) : null}
      </div>

      {error ? <Callout title={t("Payment schedule unavailable")} tone="danger">{error}</Callout> : null}

      {!readOnly && templates.length ? (
        <section className={s.section}>
          <h3>{t("Saved schedules")}</h3>
          <div className={s.actions}>
            {templates.map((template) => (
              <span
                draggable
                key={template.id}
                onDragStart={(event) => event.dataTransfer.setData("application/wodana-payment-template", template.id)}
              >
                <Button onPress={() => apply(template)} size="compact">{template.name}</Button>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {quote.paymentTemplate ? (
        <p className={s.muted}>
          {t("{name} · template v{version} · editable for this quotation", { name: quote.paymentTemplate.name, version: quote.paymentTemplate.version })}
        </p>
      ) : null}

      {!terms.length ? (
        <p className={s.notice}>{t("Choose a reusable schedule or add milestones. Percentages must total 100% before review.")}</p>
      ) : (
        <MilestoneRows
          currency={quote.currency}
          onChange={(rows) => onChange({ ...quote, paymentTerms: rows })}
          readOnly={readOnly}
          rows={terms}
          total={total}
        />
      )}

      {!readOnly ? (
        <div className={s.actions}>
          <Button onPress={() => onChange({ ...quote, paymentTerms: [...terms, newMilestone()] })} size="compact">
            <Plus aria-hidden="true" size={14} />{t("Add milestone")}</Button>
        </div>
      ) : null}

      <ControlledModalDialog
        description={t("Reuse a saved schedule or create one. Issued quotations are never changed.")}
        isOpen={library}
        onOpenChange={setLibrary}
        size="lg"
        title={t("Payment schedules")}
      >
        <div className={s.form}>
          {templates.map((template) => (
            <div
              className={s.section}
              draggable
              key={template.id}
              onDragStart={(event) => event.dataTransfer.setData("application/wodana-payment-template", template.id)}
            >
              <div className={s.header}>
                <div>
                  <strong>{template.name}</strong>
                  <p className={s.muted}>
                    {template.milestones.map((milestone) => `${milestone.percent}% ${milestone.title}`).join(" · ")}
                  </p>
                </div>
                <div className={s.actions}>
                  <Button onPress={() => { setEdit(structuredClone(template)); setTemplateName(template.name); }} size="compact" variant="quiet">{t("Edit")}</Button>
                  <Button onPress={() => void openHistory(template)} size="compact" variant="quiet"><History aria-hidden="true" size={14} />{t("History")}</Button>
                  <Button onPress={() => setArchiveTarget(template)} size="compact" variant="quiet"><Archive aria-hidden="true" size={14} />{t("Archive")}</Button>
                  <Button onPress={() => apply(template)} size="compact" variant="primary">{t("Use schedule")}</Button>
                </div>
              </div>
            </div>
          ))}

          <Button onPress={() => { setEdit(starterTemplate()); setTemplateName(""); }}>
            <Plus aria-hidden="true" size={14} />{t("Create schedule")}</Button>

          {edit ? (
            <div className={s.section}>
              <TextInput
                label={t("Schedule name")}
                onChange={setTemplateName}
                placeholder={t("e.g. Residential · 50 / 40 / 10")}
                value={templateName}
              />
              <MilestoneRows onChange={(rows) => setEdit({ ...edit, milestones: rows })} readOnly={false} rows={edit.milestones} />
              <div className={s.actions}>
                <Button onPress={() => setEdit({ ...edit, milestones: [...edit.milestones, newMilestone()] })} size="compact">
                  <Plus aria-hidden="true" size={14} />{t("Add milestone")}</Button>
                <Button
                  isDisabled={busy || !templateName.trim()}
                  isLoading={busy}
                  onPress={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const saved = await jsonRequest<PaymentTemplate>(
                        commercialPath(workspaceId, "payment-templates"),
                        "PUT",
                        { ...edit, name: templateName.trim() },
                      );
                      await load();
                      apply(saved);
                      setEdit(null);
                    } catch (failure) {
                      setError(failure instanceof Error ? failure.message : "Schedule could not be saved.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  variant="primary"
                >
                  {t("Save and use")}</Button>
              </div>
            </div>
          ) : null}
        </div>
      </ControlledModalDialog>

      <InspectorSheet
        description={t("Every save is retained. Restoring creates a new revision and keeps later history.")}
        isOpen={Boolean(historyTemplate)}
        onOpenChange={(open) => { if (!open && !busy) setHistoryTemplate(null); }}
        size="sm"
        title={historyTemplate ? `${historyTemplate.name} history` : "Schedule history"}
      >
        {historyError ? <Callout title={t("Schedule history unavailable")} tone="danger">{historyError}</Callout> : null}
        {!historyError && !revisions.length ? <p className={s.muted}>{t("No saved changes yet.")}</p> : null}
        {revisions.length ? (
          <ol className={s.history}>
            {revisions.map((revision, index) => (
              <li key={revision.id}>
                <div className={s.header}>
                  <div>
                    <strong>{t("Revision")}{" "}{revision.revisionNumber}</strong>
                    <p className={s.muted}>
                      {new Date(revision.createdAt).toLocaleString()} · {revision.changes.length} {t("changed")}{" "}{revision.changes.length === 1 ? "field" : "fields"}
                    </p>
                  </div>
                  {index === 0 ? (
                    <Badge tone="neutral">{t("Current")}</Badge>
                  ) : (
                    <Button isDisabled={busy} onPress={() => setRollbackTarget(revision)} size="compact" variant="quiet">
                      <RotateCcw aria-hidden="true" size={14} />{t("Restore")}</Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </InspectorSheet>

      <ConfirmationDialog
        body="It will stop appearing in schedule selection. Existing quotations and revision history stay unchanged."
        confirmLabel={busy ? "Archiving…" : "Archive schedule"}
        isOpen={Boolean(archiveTarget)}
        onConfirm={() => void archiveTemplate()}
        onOpenChange={(open) => { if (!open && !busy) setArchiveTarget(null); }}
        title={t("Archive this payment schedule?")}
      />
      <ConfirmationDialog
        body="The selected milestones become the current schedule. The current version remains in history."
        confirmLabel={busy ? "Restoring…" : "Restore revision"}
        isOpen={Boolean(rollbackTarget)}
        onConfirm={() => void rollback()}
        onOpenChange={(open) => { if (!open && !busy) setRollbackTarget(null); }}
        title={t("Restore this payment schedule revision?")}
      />
    </section>
  );
}

function MilestoneRows({ rows, onChange, readOnly, total, currency }: {
  rows: PaymentTerm[];
  onChange: (rows: PaymentTerm[]) => void;
  readOnly: boolean;
  total?: number;
  currency?: string;
}) {
  const t = useT();
  const region = useDesignSystem();
  const [drag, setDrag] = useState<string | null>(null);

  function move(id: string, to: number) {
    const next = [...rows];
    const index = next.findIndex((row) => row.id === id);
    if (index < 0 || to < 0 || to >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item);
    onChange(next);
  }

  const patch = (id: string, value: Partial<PaymentTerm>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...value } : row)));

  const columns: DataGridColumn<PaymentTerm>[] = [
    ...(!readOnly ? [{
      id: "order",
      header: "Order",
      size: 130,
      enableSorting: false,
      enableColumnFilter: false,
      meta: { renderCell: (row: PaymentTerm) => {
        const index = rows.findIndex((item) => item.id === row.id);
        return <div className={s.rowAction}>
          <span
            draggable
            onDragEnd={() => setDrag(null)}
            onDragStart={(event) => { setDrag(row.id); event.dataTransfer.setData("text/plain", row.id); }}
            title={t("Drag to reorder")}
          ><GripVertical aria-hidden="true" size={16} /></span>
          <IconButton aria-label={t("Move {name} up", { name: row.title })} isDisabled={index === 0} onPress={() => move(row.id, index - 1)} size="compact"><ArrowUp aria-hidden="true" size={13} /></IconButton>
          <IconButton aria-label={t("Move {name} down", { name: row.title })} isDisabled={index === rows.length - 1} onPress={() => move(row.id, index + 1)} size="compact"><ArrowDown aria-hidden="true" size={13} /></IconButton>
        </div>;
      } },
    }] : []),
    {
      id: "title",
      header: "Milestone / trigger",
      size: 300,
      accessorFn: (row) => `${row.title} ${row.trigger}`,
      meta: { renderCell: (row: PaymentTerm) => {
        const index = rows.findIndex((item) => item.id === row.id);
        return readOnly ? <>{row.title}<small className={s.detail}>{row.trigger}</small></> : (
          <div className={s.paymentFields}>
            <TextInput label={<VisuallyHidden>{t("Milestone {number} title", { number: index + 1 })}</VisuallyHidden>} onChange={(value) => patch(row.id, { title: value })} value={row.title} />
            <TextInput label={<VisuallyHidden>{t("Milestone {number} trigger", { number: index + 1 })}</VisuallyHidden>} onChange={(value) => patch(row.id, { trigger: value })} placeholder={t("When is it due?")} value={row.trigger} />
          </div>
        );
      } },
    },
    {
      id: "percent",
      header: "Percentage",
      size: 140,
      accessorFn: (row) => row.percent,
      meta: { renderCell: (row: PaymentTerm) => {
        const index = rows.findIndex((item) => item.id === row.id);
        return readOnly ? `${row.percent}%` : (
          <NumericInput
            label={<VisuallyHidden>{t("Milestone {number} percentage", { number: index + 1 })}</VisuallyHidden>}
            maxValue={100}
            minValue={0.01}
            onChange={(value) => patch(row.id, { percent: value })}
            step={0.01}
            suffix="%"
            value={row.percent}
          />
        );
      } },
    },
    ...(total !== undefined ? [{
      id: "amount",
      header: "Amount",
      size: 160,
      accessorFn: (row: PaymentTerm) => paymentMilestoneAmounts(total, rows, currency ?? region.currency)[rows.findIndex((item) => item.id === row.id)],
      meta: { renderCell: (row: PaymentTerm) => {
        const index = rows.findIndex((item) => item.id === row.id);
        return money(paymentMilestoneAmounts(total, rows, currency ?? region.currency)[index], currency ?? region.currency, region.locale);
      } },
    }] : []),
    {
      id: "release",
      header: "Before release",
      size: 140,
      accessorFn: (row) => row.requiredForRelease ? "Required" : "Optional",
      meta: { renderCell: (row: PaymentTerm) => {
        const index = rows.findIndex((item) => item.id === row.id);
        return readOnly ? (row.requiredForRelease ? "Required" : "—") : (
          <Checkbox aria-label={`Milestone ${index + 1} required before release`} isSelected={row.requiredForRelease} onChange={(selected) => patch(row.id, { requiredForRelease: selected })} />
        );
      } },
    },
    {
      id: "production",
      header: "Before production",
      size: 165,
      accessorFn: (row) => row.requiredForProduction ? "Required" : "Optional",
      meta: { renderCell: (row: PaymentTerm) => {
        const index = rows.findIndex((item) => item.id === row.id);
        return readOnly ? (row.requiredForProduction ? "Required" : "—") : (
          <Checkbox aria-label={`Milestone ${index + 1} required before production`} isSelected={row.requiredForProduction === true} onChange={(selected) => patch(row.id, { requiredForProduction: selected })} />
        );
      } },
    },
    ...(!readOnly ? [{
      id: "action",
      header: "Action",
      size: 90,
      enableSorting: false,
      enableColumnFilter: false,
      meta: { renderCell: (row: PaymentTerm) => {
        const index = rows.findIndex((item) => item.id === row.id);
        return <IconButton aria-label={`Remove milestone ${index + 1}`} onPress={() => onChange(rows.filter((milestone) => milestone.id !== row.id))} size="compact"><Trash2 aria-hidden="true" size={14} /></IconButton>;
      } },
    }] : []),
  ];

  return <>
    <DataGrid
      ariaLabel="Payment schedule"
      columns={columns}
      data={rows}
      exportFileName="payment-schedule.csv"
      getRowDragHandlers={(row) => ({
        onDragOver: (event) => { if (drag) event.preventDefault(); },
        onDrop: (event) => {
          if (!drag) return;
          event.preventDefault();
          move(drag, rows.findIndex((item) => item.id === row.id));
          setDrag(null);
        },
      })}
      getRowId={(row) => row.id}
      pinFirstColumn={false}
      searchLabel="Search payment schedule"
      selectable={false}
    />
    <p className={s.muted}>
      {t("Total: {percent}% · Drag milestones or use the arrow buttons to reorder.", { percent: rows.reduce((sum, row) => sum + row.percent, 0).toFixed(2) })}
    </p>
  </>;
}
