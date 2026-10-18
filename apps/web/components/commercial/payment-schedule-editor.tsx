"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type Translate } from "@/lib/i18n/keys";
import { useEffect, useState } from "react";
import { Archive, History, Plus, RotateCcw } from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  ConfirmationDialog,
  ControlledModalDialog,
  EmptyState,
  formatDate,
  InspectorSheet,
  TextInput,
  useDesignSystem,
} from "@/design-system";
import type { PaymentTerm, PaymentTemplate, Quote } from "@/lib/commercial/types";
import { commercialPath, jsonRequest, quoteTotals } from "@/lib/commercial/client";
import type { WorkspaceConfigurationRevision } from "@/lib/workspace/company-profile";
import { PaymentMilestonesEditor } from "./payment-milestones-editor";
import s from "./commercial.module.css";

function starterTemplate(t: Translate): PaymentTemplate {
  const milestone = (title: string, percent: number, trigger: string, requiredForRelease = false): PaymentTerm => ({
    id: crypto.randomUUID(),
    title,
    percent,
    trigger,
    requiredForRelease,
    requiredForProduction: false,
  });
  return {
    id: crypto.randomUUID(),
    name: "",
    version: 0,
    milestones: [
      milestone(t("Advance"), 50, t(tKey("On signing the agreement")), true),
      milestone(t("Before installation"), 40, t(tKey("Before site installation"))),
      milestone(t("Handover"), 10, t(tKey("On completed handover"))),
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
  const region = useDesignSystem();
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
      setError(failure instanceof Error ? failure.message : t(tKey("Payment schedules could not be loaded.")));
    }
  }

  useEffect(() => {
    let active = true;
    jsonRequest<{ items: PaymentTemplate[] }>(commercialPath(workspaceId, "payment-templates"))
      .then((result) => {
        if (active) setTemplates(result.items);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : t(tKey("Payment schedules could not be loaded.")));
      });
    return () => {
      active = false;
    };
  }, [workspaceId, t]);

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
      setHistoryError(failure instanceof Error ? failure.message : t(tKey("Schedule history could not be loaded.")));
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
      setError(failure instanceof Error ? failure.message : t(tKey("Schedule could not be archived.")));
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
      setHistoryError(failure instanceof Error ? failure.message : t(tKey("Schedule revision could not be restored.")));
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
          <Button onPress={() => { void load(); setEdit(null); setTemplateName(""); setLibrary(true); }}>{t("Choose schedule")}</Button>
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

      <PaymentMilestonesEditor
        ariaLabel={t("Payment schedule")}
        currency={quote.currency}
        emptyDescription={t("Choose a reusable schedule or add milestones. Percentages must total 100% before review.")}
        milestones={terms}
        onChange={(rows) => onChange({ ...quote, paymentTerms: rows })}
        readOnly={readOnly}
        total={total}
      />

      <ControlledModalDialog
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

          <Button onPress={() => { setEdit(starterTemplate(t)); setTemplateName(""); }}>
            <Plus aria-hidden="true" size={14} />{t("Create schedule")}</Button>

          {edit ? (
            <div className={s.section}>
              <TextInput
                label={t("Schedule name")}
                onChange={setTemplateName}
                placeholder={t("e.g. Residential · 50 / 40 / 10")}
                value={templateName}
              />
              <PaymentMilestonesEditor
                ariaLabel={t("Payment schedule")}
                milestones={edit.milestones}
                onChange={(rows) => setEdit({ ...edit, milestones: rows })}
                readOnly={false}
              />
              <div className={s.actions}>
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
                      setError(failure instanceof Error ? failure.message : t("The schedule could not be saved."));
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
        title={historyTemplate ? t("{name} history", { name: historyTemplate.name }) : t(tKey("Schedule history"))}
      >
        {historyError ? <Callout title={t("Schedule history unavailable")} tone="danger">{historyError}</Callout> : null}
        {!historyError && !revisions.length ? <EmptyState illustration={null} title={t("No saved changes yet.")} /> : null}
        {revisions.length ? (
          <ol className={s.history}>
            {revisions.map((revision, index) => (
              <li key={revision.id}>
                <div className={s.header}>
                  <div>
                    <strong>{t("Revision {number}", { number: revision.revisionNumber })}</strong>
                    <p className={s.muted}>
                      {formatDate(revision.createdAt, region, { dateStyle: "medium", timeStyle: "short" })}
                      {" · "}
                      {t(revision.changes.length === 1 ? "{count} changed field" : "{count} changed fields", { count: revision.changes.length })}
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
        body={t(tKey("It will stop appearing in schedule selection. Existing quotations and revision history stay unchanged."))}
        confirmLabel={busy ? t("Archiving…") : t(tKey("Archive schedule"))}
        isOpen={Boolean(archiveTarget)}
        onConfirm={() => void archiveTemplate()}
        onOpenChange={(open) => { if (!open && !busy) setArchiveTarget(null); }}
        title={t("Archive this payment schedule?")}
      />
      <ConfirmationDialog
        body={t(tKey("The selected milestones become the current schedule. The current version remains in history."))}
        confirmLabel={busy ? t("Restoring…") : t("Restore revision")}
        isOpen={Boolean(rollbackTarget)}
        onConfirm={() => void rollback()}
        onOpenChange={(open) => { if (!open && !busy) setRollbackTarget(null); }}
        title={t("Restore this payment schedule revision?")}
      />
    </section>
  );
}
