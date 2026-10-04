"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  Avatar, Button, ControlledModalDialog, EmptyState, Form, NoAccessState, PageHeader, RecordTable, SelectField, TextInput, TypeChip,
  formatDate, formatNumber, useDesignSystem, useToast,
} from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import type { FlowSummary, FlowUse } from "@/lib/flows/flow-model";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import styles from "./flows.module.css";

/** The starter flows every workspace can begin from (plan §5a). */
export const STARTERS = [
  { code: "furniture", name: tKey("Furniture") },
  { code: "design", name: tKey("Design") },
  { code: "fit_out", name: tKey("Fit-out") },
  { code: "basic", name: tKey("Basic") },
];

type EnquiryTypeRow = FlowUse & { flowId: string };

/** Flows (plan §5a, F3): the firm's flows, which enquiry type follows which, and a way to start a new one. */
export function FlowsListPage({ canManage, flows: initial, workspaceId }: { canManage: boolean; flows: FlowSummary[]; workspaceId: string }) {
  const t = useT();
  const toast = useToast();
  const { locale, timeZone } = useDesignSystem();
  const [flows, setFlows] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const enquiryTypes = useMemo<EnquiryTypeRow[]>(() => flows.flatMap((flow) => flow.usedBy.map((use) => ({ ...use, flowId: flow.id })))
    .sort((a, b) => a.label.localeCompare(b.label, locale)), [flows, locale]);
  const flowItems = flows.filter((flow) => flow.status === "active").map((flow) => ({ id: flow.id, label: flow.name }));

  if (!canManage) return <NoAccessState area={t("Flows")} />;

  async function assign(row: EnquiryTypeRow, flowId: string) {
    if (flowId === row.flowId) return;
    setSaving(row.id);
    try {
      const updated = await crmRequest<{ version: number }>(workspaceId, `flows/${flowId}/enquiry-types/${row.id}`, "PUT", { version: row.version });
      setFlows((current) => current.map((flow) => ({
        ...flow,
        usedBy: flow.id === flowId ? [...flow.usedBy, { id: row.id, code: row.code, label: row.label, version: updated.version }]
          : flow.usedBy.filter((use) => use.id !== row.id),
      })));
      toast.push({ tone: "success", title: t("Saved"), message: t("{type} now follows {flow}", { type: row.label, flow: flows.find((flow) => flow.id === flowId)?.name ?? "" }) });
    } catch (error) {
      toast.push({ tone: "danger", title: t("Not saved"), message: translateKnown(t, error instanceof Error ? error.message : t("Please try again.")) });
    } finally {
      setSaving(null);
    }
  }

  const action = <Button onPress={() => setCreating(true)} variant="primary"><Plus aria-hidden="true" size={16} />{t("New flow")}</Button>;
  return <div className={styles.page}>
    <PageHeader actions={action} title={t("Flows")} />
    {!flows.length ? <EmptyState action={action} title={t("No flows yet")} /> : <RecordTable
      ariaLabel={t("Flows")} data={flows} getRowId={(flow) => flow.id} rowNumbers={false} selectable={false} showFooter={false} showToolbar={false} wrapText
      columns={[
        { id: "name", header: t("Flow"), size: 240, accessorFn: (flow) => flow.name, meta: { primary: true, interactive: true },
          cell: ({ row: { original: flow } }) => <Link className={styles.flowLink} href={`/workspace/flows/${flow.id}`}>{flow.name}</Link> },
        { id: "usedBy", header: t("Used by"), size: 300, accessorFn: (flow) => flow.usedBy.map((use) => use.label).join(", "),
          cell: ({ row: { original: flow } }) => flow.usedBy.length
            ? <span className={styles.chips}>{flow.usedBy.map((use) => <TypeChip key={use.id} typeKey={use.code}>{use.label}</TypeChip>)}</span>
            : <span className={styles.muted}>{t("Not used")}</span> },
        { id: "jobs", header: t("Running jobs"), size: 130, accessorFn: (flow) => flow.runningJobs ?? 0, meta: { align: "end", mobileHidden: true },
          cell: ({ row: { original: flow } }) => <span className={styles.number}>{formatNumber(flow.runningJobs ?? 0, { locale })}</span> },
        { id: "latest", header: t("Latest version"), size: 260, accessorFn: (flow) => flow.latest?.version ?? 0, meta: { mobileHidden: true },
          cell: ({ row: { original: flow } }) => flow.latest ? <span className={styles.version}>
            <span className={styles.versionNumber}>{t("v{version}", { version: flow.latest.version })}</span>
            {flow.latest.publishedBy ? <Avatar name={flow.latest.publishedBy} seed={flow.latest.publishedBy} size="sm" /> : null}
            <span className={styles.muted}>{flow.latest.source === "starter" ? t("Starter") : formatDate(flow.latest.publishedAt, { locale, timeZone })}</span>
          </span> : null },
      ]} />}
    {enquiryTypes.length ? <section aria-labelledby="flows-enquiry-types" className={styles.section}>
      <h2 className={styles.sectionTitle} id="flows-enquiry-types">{t("Enquiry types")}</h2>
      <RecordTable
        ariaLabel={t("Enquiry types")} data={enquiryTypes} getRowId={(row) => row.id} rowNumbers={false} selectable={false} showFooter={false} showToolbar={false} wrapText
        columns={[
          { id: "type", header: t("Enquiry type"), size: 240, accessorFn: (row) => row.label, meta: { primary: true },
            cell: ({ row: { original: row } }) => <TypeChip typeKey={row.code}>{row.label}</TypeChip> },
          { id: "flow", header: t("Follows"), size: 280, accessorFn: (row) => flows.find((flow) => flow.id === row.flowId)?.name ?? "", meta: { interactive: true },
            cell: ({ row: { original: row } }) => <span className={styles.selectCell}><SelectField
              accent="neutral" aria-label={t("Flow for {type}", { type: row.label })} isDisabled={saving === row.id} items={flowItems}
              label={<span className="wd-visually-hidden">{t("Flow for {type}", { type: row.label })}</span>}
              onSelectionChange={(key) => { if (key) void assign(row, String(key)); }} selectedKey={row.flowId} /></span> },
        ]} />
    </section> : null}
    {creating ? <NewFlowDialog flows={flows} onClose={() => setCreating(false)} workspaceId={workspaceId} /> : null}
  </div>;
}

/** A new flow starts from a starter or a copy of one of the firm's flows; it opens in the builder. */
export function NewFlowDialog({ flows, onClose, workspaceId }: { flows: FlowSummary[]; onClose: () => void; workspaceId: string }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [source, setSource] = useState<string>("starter:design");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sources = [
    ...STARTERS.map((starter) => ({ id: `starter:${starter.code}`, label: t("{name} (starter)", { name: t(starter.name) }) })),
    ...flows.filter((flow) => flow.status === "active").map((flow) => ({ id: `flow:${flow.id}`, label: t("Copy of {name}", { name: flow.name }) })),
  ];
  async function submit() {
    if (!name.trim()) { setError(t("Give the flow a name")); return; }
    setBusy(true);
    setError(null);
    const [kind, value] = source.split(":");
    try {
      const created = await crmRequest<{ id: string }>(workspaceId, "flows", "POST", kind === "starter" ? { name: name.trim(), starter: value } : { name: name.trim(), sourceFlowId: value });
      router.push(`/workspace/flows/${created.id}`);
    } catch (failure) {
      setError(translateKnown(t, failure instanceof Error ? failure.message : t("Please try again.")));
      setBusy(false);
    }
  }
  return <ControlledModalDialog
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button><Button isLoading={busy} onPress={() => void submit()} variant="primary">{t("Create flow")}</Button></div>}
    isDirty={Boolean(name.trim())} isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={t("New flow")}>
    <Form errorSummary={false} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <TextInput autoFocus errorMessage={error ?? undefined} isInvalid={Boolean(error)} isRequired label={t("Name")} onChange={setName} value={name} />
      <SelectField items={sources} label={t("Start from")} onSelectionChange={(key) => { if (key) setSource(String(key)); }} selectedKey={source} />
    </Form>
  </ControlledModalDialog>;
}
