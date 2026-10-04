"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Pencil, Plus } from "lucide-react";
import {
  Avatar, Button, ConfirmationDialog, EmptyState, ErrorState, IconMenuButton, MenuButton, NoAccessState, PageHeader, TypeChip,
  formatDate, formatNumber, useDesignSystem, useToast,
} from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import type { FlowSummary, FlowUse } from "@/lib/flows/flow-model";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { NewFlowDialog } from "./new-flow-dialog";
import styles from "./flows.module.css";

export { NewFlowDialog, STARTERS } from "./new-flow-dialog";

/** An enquiry type with the flow it follows; `assigned` false means it names no flow and runs the basic one. */
type TypeRow = FlowUse & { flowId: string; assigned: boolean };
type Move = { row: TypeRow; flowId: string };

/** Flows (plan §5a, F3): one card per flow with the enquiry types it is used for; a way to start a new one. */
export function FlowsListPage({ canManage, flows: initial, loadError = false, workspaceId }: { canManage: boolean; flows: FlowSummary[]; loadError?: boolean; workspaceId: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const { locale, timeZone } = useDesignSystem();
  const [flows, setFlows] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Move | null>(null);
  const types = useMemo<TypeRow[]>(() => flows.flatMap((flow) => flow.usedBy.map((use) => ({ ...use, flowId: flow.id, assigned: use.assigned !== false })))
    .sort((a, b) => a.label.localeCompare(b.label, locale)), [flows, locale]);
  const targets = flows.filter((flow) => flow.status === "active");
  const nameOf = (flowId: string) => flows.find((flow) => flow.id === flowId)?.name ?? "";
  const unassigned = types.filter((row) => !row.assigned);

  if (!canManage) return <NoAccessState area={t("Flows")} />;

  async function move({ row, flowId }: Move) {
    if (flowId === row.flowId && row.assigned) return;
    setSaving(row.id);
    try {
      const updated = await crmRequest<{ version: number }>(workspaceId, `flows/${flowId}/enquiry-types/${row.id}`, "PUT", { version: row.version });
      setFlows((current) => current.map((flow) => ({
        ...flow,
        usedBy: [...flow.usedBy.filter((use) => use.id !== row.id),
          ...(flow.id === flowId ? [{ id: row.id, code: row.code, label: row.label, version: updated.version, assigned: true }] : [])],
      })));
      toast.push({ tone: "success", title: t("Saved"), message: t("{type} now follows {flow}", { type: row.label, flow: nameOf(flowId) }) });
    } catch (error) {
      toast.push({ tone: "danger", title: t("Not saved"), message: translateKnown(t, error instanceof Error ? error.message : t("Please try again.")) });
    } finally {
      setSaving(null);
      setConfirming(null);
    }
  }

  /** The "Move to …" menu on a chip: every other active flow. */
  const moveMenu = (row: TypeRow) => <IconMenuButton
    ariaLabel={t("Move {type}", { type: row.label })} icon={<ChevronDown aria-hidden="true" size={14} />}
    items={targets.filter((flow) => flow.id !== row.flowId || !row.assigned).map((flow) => ({ id: flow.id, label: t("Move to {name}", { name: flow.name }), isDisabled: saving === row.id }))}
    onAction={(flowId) => void move({ row, flowId })} />;
  const chip = (row: TypeRow) => <li className={styles.typeChip} key={row.id}><TypeChip typeKey={row.code}>{row.label}</TypeChip>{moveMenu(row)}</li>;

  const action = <Button onPress={() => setCreating(true)} variant="primary"><Plus aria-hidden="true" size={16} />{t("New flow")}</Button>;
  return <div className={styles.page}>
    <PageHeader actions={loadError ? undefined : action} title={t("Flows")} />
    {loadError ? <ErrorState onRetry={() => router.refresh()} />
      : !flows.length ? <EmptyState action={action} title={t("No flows yet")} />
      : <ul aria-label={t("Flows")} className={styles.flowCards}>{flows.map((flow) => {
        const steps = flow.latest?.steps ?? [];
        const used = types.filter((row) => row.flowId === flow.id && row.assigned);
        const addable = types.filter((row) => !(row.flowId === flow.id && row.assigned));
        return <li className={styles.flowCard} key={flow.id}>
          <Link className={styles.flowHead} href={`/workspace/flows/${flow.id}`}>
            <h2 className={styles.flowTitle}>{flow.name}</h2>
            {steps.length ? <span className={styles.summary}>
              <span>{t("{count} steps", { count: steps.length })}</span><span aria-hidden="true">·</span>
              <span>{steps[0]}</span>{steps.length > 1 ? <><ArrowRight aria-label={t("to")} size={12} /><span>{steps.at(-1)}</span></> : null}
            </span> : null}
          </Link>
          <p className={styles.meta}>
            <span>{t("{count} running jobs", { count: formatNumber(flow.runningJobs ?? 0, { locale }) })}</span>
            {flow.latest ? <>
              <span className={styles.version}>{t("v{version}", { version: flow.latest.version })}</span>
              <span className={styles.published}>
                {flow.latest.publishedBy ? <Avatar name={flow.latest.publishedBy} seed={flow.latest.publishedBy} size="sm" /> : null}
                {flow.latest.source === "starter" ? t("Starter") : formatDate(flow.latest.publishedAt, { locale, timeZone })}
              </span>
            </> : null}
          </p>
          <section aria-label={t("Used for")} className={styles.usedFor}>
            <h3 className={styles.usedForTitle}>{t("Used for")}</h3>
            <ul className={styles.chips}>
              {used.map(chip)}
              {addable.length && flow.status === "active" ? <li><MenuButton
                items={addable.map((row) => ({ id: row.id, label: row.assigned ? t("{type} (in {flow})", { type: row.label, flow: nameOf(row.flowId) }) : row.label, isDisabled: saving === row.id }))}
                label={<><Plus aria-hidden="true" size={14} />{t("Add enquiry type")}</>} size="compact"
                onAction={(id) => {
                  const row = addable.find((item) => item.id === id);
                  if (!row) return;
                  if (row.assigned) setConfirming({ row, flowId: flow.id });
                  else void move({ row, flowId: flow.id });
                }} /></li> : null}
            </ul>
          </section>
          <div className={styles.flowActions}>
            <Link className={`wd-button ${styles.editLink}`} data-size="compact" data-variant="quiet" href={`/workspace/flows/${flow.id}`}><Pencil aria-hidden="true" size={14} />{t("Edit flow")}</Link>
          </div>
        </li>;
      })}</ul>}
    {!loadError && unassigned.length ? <section aria-label={t("Not in a flow yet")} className={styles.strip}>
      <h2 className={styles.usedForTitle}>{t("Not in a flow yet")}</h2>
      <ul className={styles.chips}>{unassigned.map(chip)}</ul>
    </section> : null}
    {confirming ? <ConfirmationDialog
      body={t("New {type} enquiries will follow {to} instead of {from}.", { type: confirming.row.label, to: nameOf(confirming.flowId), from: nameOf(confirming.row.flowId) })}
      confirmLabel={t("Move")} confirmVariant="primary" isConfirming={saving === confirming.row.id} isOpen
      onConfirm={() => void move(confirming)} onOpenChange={(open) => { if (!open) setConfirming(null); }}
      title={t("Move {type} to {flow}?", { type: confirming.row.label, flow: nameOf(confirming.flowId) })} /> : null}
    {creating ? <NewFlowDialog flows={flows} onClose={() => setCreating(false)} workspaceId={workspaceId} /> : null}
  </div>;
}
