"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Send, Sparkles } from "lucide-react";
import {
  Button, EmptyState, FormDialog, FormSection, ErrorState, GroupedTable, InspectorSheet, MultiSelectField, SegmentedControl, SelectField, Skeleton, Switch, TextAreaField, TextInput,
  type GroupedTableColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { MaterialItem, MaterialsState, ScopeLine } from "@/lib/project-core/types";
import { LineStatusLabel } from "../purchasing/order-labels";
import { useProjectFormat } from "./format";
import styles from "./project-core.module.css";

type Run = (action: string, input?: Record<string, unknown>, options?: { inDialog?: boolean }) => Promise<boolean>;
const METHODS = [["signed_document", "Signed copy"], ["email", "Email"], ["in_person", "In person"], ["phone", "Phone"], ["message", "Message"]] as const;

/**
 * The material list the client signs off before anything is ordered: each material or finish, the
 * items it's for, and what the client decided. A sent revision is frozen until their decision is recorded.
 */
export function ProjectMaterials({ workspaceId, projectId, version, run, lines }: { workspaceId: string; projectId: string; version: number; run: Run; lines: ScopeLine[] }) {
  const t = useT();
  const format = useProjectFormat();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [data, setData] = useState<MaterialsState | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<MaterialItem | "new" | null>(null);
  const [deciding, setDeciding] = useState(false);
  // What "Suggest from the scope" did: materials added, or that the scope had nothing new.
  const [suggested, setSuggested] = useState("");
  const load = useCallback(async () => {
    try { setData(await api.materials(projectId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The material list didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, version]);

  if (error && !data) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!data) return <Skeleton lines={5} shape="rows" />;
  const latest = data.revisions[0];
  // How long the list has been with the client, in days.
  const waitingText = (sentAt: string, number: number) => {
    const days = Math.max(0, Math.round((Date.parse(format.today()) - Date.parse(format.dayOf(sentAt))) / 86_400_000));
    if (!days) return t("R{number} is with the client since {date}", { number, date: format.when(sentAt) });
    return days === 1 ? t("R{number} with the client for 1 day", { number }) : t("R{number} with the client for {count} days", { number, count: days });
  };
  const status = data.state === "draft" ? t("Not sent to the client yet")
    : data.state === "sent" ? waitingText(latest.sentAt, latest.number)
    : data.state === "signed_off" ? t("Signed off R{number} by {name} on {date}", { number: latest.number, name: latest.decidedBy ?? "", date: format.when(latest.decidedAt) })
    : data.state === "changes_requested" ? t("The client asked for changes to R{number}", { number: latest.number })
    : t("Changed since R{number} was signed off", { number: latest.number });
  const locked = data.state === "sent";
  const suggest = async () => {
    const before = data.items.length;
    setSuggested("");
    if (!(await run("suggest_materials"))) return;
    try {
      const next = await api.materials(projectId);
      setData(next);
      const added = next.items.length - before;
      setSuggested(added <= 0 ? t("Nothing new to suggest from the scope.") : added === 1 ? t("1 material added from the scope.") : t("{count} materials added from the scope.", { count: added }));
    } catch { /* The list reloads with the project version. */ }
  };
  const columns: GroupedTableColumn<MaterialItem>[] = [
    { id: "name", label: t("Material"), width: "26%", render: (item) => <span className={styles.lineCell}><span>{item.name}</span>{item.code || item.supplier ? <small>{[item.code, item.supplier].filter(Boolean).join(" · ")}</small> : null}
      {/* PLM-055: product details for the technical team. */}
      {item.teamNote ? <small>{t("For the technical team: {details}", { details: item.teamNote })}</small> : null}</span> },
    { id: "spec", label: t("Finish"), width: "20%", mobileHidden: true, render: (item) => <span className={styles.muted}>{item.specification}</span> },
    { id: "used", label: t("For"), width: "22%", mobileHidden: true, render: (item) => <span className={styles.muted}>{item.usedIn.map((line) => line.title).join(", ")}</span> },
    { id: "decision", label: t("Client"), width: "18%", render: (item) => !item.clientChoice ? <span className={styles.muted}>{t("No client choice")}</span> : item.decision
      ? <span className={styles.lineCell}><span className={styles.status} data-tone={item.decision.decision === "approved" ? "ok" : "off"}>{item.decision.decision === "approved" ? t("Approved") : t("Rejected")}</span>
          {item.decision.note ? <small>{item.decision.note}</small> : null}</span>
      : <span className={styles.muted}>{locked ? t("Waiting") : "—"}</span> },
    // PLM-072: where each material has got to, as Purchasing works it out from orders, deliveries and site reports.
    { id: "status", label: t("Status"), width: "14%", render: (item) => item.status ? <LineStatusLabel status={item.status} /> : <span className={styles.muted}>—</span> },
  ];

  return <div className={styles.changes}>
    <div className={styles.scopeToolbar}>
      <span className={styles.materialStatus} data-state={data.state}>{status}</span>
      {data.canEdit ? <div className={styles.toolbarActions}>
        {!locked ? <>
          {suggested ? <span className={styles.muted} role="status">{suggested}</span> : null}
          <Button size="compact" onPress={() => void suggest()}><Sparkles aria-hidden="true" size={14} />{t("Suggest from the scope")}</Button>
          <Button size="compact" onPress={() => setEditing("new")}><Plus aria-hidden="true" size={14} />{t("Add material")}</Button>
          {data.items.length && data.state !== "signed_off" ? <Button size="compact" variant="primary" onPress={() => void run("send_materials")}><Send aria-hidden="true" size={14} />{t("Send to the client")}</Button> : null}
        </> : <>
          {/* With the client for a while: a nudge to their decision-makers (at most once a day). */}
          <Button size="compact" onPress={() => void run("remind_materials")}>{t("Remind")}</Button>
          <Button size="compact" variant="primary" onPress={() => setDeciding(true)}>{t("Record the client's decision")}</Button>
        </>}
      </div> : null}
    </div>
    {data.items.length
      ? <GroupedTable<MaterialItem> ariaLabel={t("Material list")} columns={columns} selectable={false} getRowId={(item) => item.id} getRowLabel={(item) => item.name}
          sections={[{ id: "all", label: t("{count} materials", { count: data.items.length }), rows: data.items, emptyMessage: "" }]}
          onRowAction={data.canEdit ? setEditing : undefined} />
      : <EmptyState illustration={null} title={t("No materials yet")} description={t("List every material and finish the client signs off before ordering.")} />}
    {editing ? <MaterialSheet item={editing === "new" ? null : editing} lines={lines} run={run} locked={locked} onClose={() => setEditing(null)} /> : null}
    {deciding ? <DecisionDialog data={data} run={run} onClose={() => setDeciding(false)} /> : null}
  </div>;
}

/**
 * A material: what it is, who supplies it, what it's for. While the list is with the client it reads only; the team's
 * product details for the technical team (PLM-055) can be added at any time and never undo a sign-off.
 */
function MaterialSheet({ item, lines, run, locked, onClose }: { item: MaterialItem | null; lines: ScopeLine[]; run: Run; locked: boolean; onClose: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [form, setForm] = useState({ name: item?.name ?? "", code: item?.code ?? "", specification: item?.specification ?? "", supplier: item?.supplier ?? "",
    quantity: item?.quantity ? String(Number(item.quantity)) : "", unit: item?.unit ?? "", note: item?.note ?? "" });
  const [clientChoice, setClientChoice] = useState(item?.clientChoice ?? true);
  const [used, setUsed] = useState<Set<string>>(new Set(item?.boqLineIds ?? []));
  const [details, setDetails] = useState(item?.teamNote ?? "");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm({ ...form, [key]: value });
  const original = { name: item?.name ?? "", code: item?.code ?? "", specification: item?.specification ?? "", supplier: item?.supplier ?? "",
    quantity: item?.quantity ? String(Number(item.quantity)) : "", unit: item?.unit ?? "", note: item?.note ?? "" };
  const changed = !item || JSON.stringify(form) !== JSON.stringify(original) || clientChoice !== item.clientChoice
    || JSON.stringify([...used].sort()) !== JSON.stringify([...item.boqLineIds].sort());
  const save = async () => {
    setBusy(true);
    let saved = locked || !changed || await run("save_material", { id: item?.id, ...form, quantity: form.quantity || null, boqLineIds: [...used], clientChoice });
    if (saved && item && details.trim() !== (item.teamNote ?? "")) saved = await run("set_material_details", { itemId: item.id, note: details.trim() });
    if (saved) onClose();
    setBusy(false);
  };
  return <InspectorSheet isOpen size="md" title={item ? item.name : t("New material")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions">
      {item && !locked ? <Button variant="quiet" onPress={async () => { if (await run("delete_material", { itemId: item.id })) onClose(); }}>{t("Delete")}</Button> : null}
      <span className={styles.spacer} />
      <Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!form.name.trim()} onPress={() => void save()}>{t("Save")}</Button>
    </div>}>
    <div className={styles.sheetBody}>
      <FormSection>
        <TextInput label={t("Name")} isRequired isReadOnly={locked} value={form.name} onChange={set("name")} />
        <TextInput label={t("Finish or specification")} isReadOnly={locked} value={form.specification} onChange={set("specification")} />
        <TextInput label={t("Code")} isReadOnly={locked} value={form.code} onChange={set("code")} />
      </FormSection>
      <FormSection title={t("Supply")}>
        <TextInput label={t("Supplier")} isReadOnly={locked} value={form.supplier} onChange={set("supplier")} />
        <div className={styles.quantityUnit}>
          <TextInput label={t("Quantity")} inputMode="decimal" isReadOnly={locked} value={form.quantity} onChange={(value) => set("quantity")(value.replace(/[^\d.]/g, ""))} />
          <TextInput label={t("Unit")} isReadOnly={locked} value={form.unit} onChange={set("unit")} />
        </div>
      </FormSection>
      <FormSection title={t("Usage")}>
        <MultiSelectField label={t("For")} isDisabled={locked} selectedKeys={used} onSelectionChange={(keys) => setUsed(new Set([...keys].map(String)))}
          items={lines.filter((line) => line.status === "active").map((line) => ({ id: line.id, label: line.areaName ? `${line.title} · ${line.areaName}` : line.title }))} />
        <Switch isSelected={clientChoice} isDisabled={locked} onChange={setClientChoice}>{t("The client chooses it (needs their sign-off)")}</Switch>
        <TextAreaField label={t("Note")} isReadOnly={locked} value={form.note} onChange={set("note")} />
      </FormSection>
      {item ? <FormSection title={t("For the technical team")}>
        <TextAreaField label={t("Product details")} maxLength={2000} value={details} onChange={setDetails}
          description={item.teamNoteByName && item.teamNoteAt ? t("{name} · {date}", { name: item.teamNoteByName, date: format.when(item.teamNoteAt) }) : undefined} />
      </FormSection> : null}
    </div>
  </InspectorSheet>;
}

/** The client's decision on the revision they have: approve or reject each material (saying what they want instead). */
function DecisionDialog({ data, run, onClose }: { data: MaterialsState; run: Run; onClose: () => void }) {
  const t = useT();
  const [decisions, setDecisions] = useState<Record<string, { decision: "approved" | "rejected"; note: string }>>(
    () => Object.fromEntries(data.items.map((item) => [item.id, { decision: "approved" as const, note: "" }])));
  const [decidedBy, setDecidedBy] = useState("");
  const [method, setMethod] = useState<string>("signed_document");
  const [note, setNote] = useState("");
  const valid = decidedBy.trim() && Object.values(decisions).every((entry) => entry.decision === "approved" || entry.note.trim());
  return <FormDialog size="lg" title={t("Record the client's decision")} onClose={onClose} isDirty={Boolean(decidedBy.trim() || note.trim())} isSubmitDisabled={!valid} submitLabel={t("Save")}
    onSubmit={async () => {
      await run("record_materials_decision", { decidedBy: decidedBy.trim(), method, note: note.trim(),
        decisions: Object.entries(decisions).map(([itemId, entry]) => ({ itemId, decision: entry.decision, note: entry.note.trim() })) }, { inDialog: true });
      onClose();
    }}>
      <FormSection title={t("Materials")}>
        <ul className={styles.decisions} aria-label={t("Materials")}>
          {data.items.map((item) => <li key={item.id}>
            <span className={styles.lineCell}><span>{item.name}</span>{item.specification ? <small>{item.specification}</small> : null}</span>
            <SegmentedControl label={t("Decision for {name}", { name: item.name })} value={decisions[item.id].decision}
              onChange={(value) => setDecisions({ ...decisions, [item.id]: { ...decisions[item.id], decision: value as "approved" | "rejected" } })}
              options={[{ id: "approved", label: t("Approve") }, { id: "rejected", label: t("Reject") }]} />
            {decisions[item.id].decision === "rejected" ? <TextInput aria-label={t("What they want instead of {name}", { name: item.name })} label={null} placeholder={t("What they want instead")}
              value={decisions[item.id].note} onChange={(value) => setDecisions({ ...decisions, [item.id]: { ...decisions[item.id], note: value } })} /> : null}
          </li>)}
        </ul>
      </FormSection>
      <FormSection title={t("Client decision")}>
        <TextInput label={t("Decided by")} isRequired maxLength={160} value={decidedBy} onChange={setDecidedBy} />
        <SelectField label={t("How")} isRequired selectedKey={method} onSelectionChange={(key) => setMethod(String(key))} items={METHODS.map(([id, label]) => ({ id, label: t(label as never) }))} />
        <TextAreaField label={t("Note")} value={note} onChange={setNote} />
      </FormSection>
  </FormDialog>;
}
