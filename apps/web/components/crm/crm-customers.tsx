"use client";

import { useMemo, useState } from "react";
import { Building2, Plus, RefreshCw, UserRound } from "lucide-react";
import { Badge, Button, Callout, DataGrid, IconButton, ControlledModalDialog, ListTabs, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import type { CrmRecord, CrmScreenPageData } from "@/lib/crm/screens";
import { crmRequest, rows } from "@/lib/crm/client";
import { CrmCreateDialog, LinkedRecordWorkbench } from "./crm-record-workbench";
import { CrmProductShell } from "./crm-product-shell";
import styles from "./crm-customers.module.css";

type CustomerView = "all" | "person" | "organization" | "archived";
type PartyPage = { data?: CrmRecord[]; nextCursor?: string | null };

function contact(record: CrmRecord, type: "email" | "phone") {
  const contacts = Array.isArray(record.contacts) ? record.contacts as Array<Record<string, unknown>> : [];
  const found = contacts.find((item) => item.type === type && item.isPrimary) ?? contacts.find((item) => item.type === type);
  return typeof found?.rawValue === "string" ? found.rawValue : null;
}

function lifecycle(value: unknown, t: Translate) {
  if (typeof value !== "string" || !value) return t("Not set");
  if (value === "lead") return t("Enquiry");
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const customerColumns = (t: Translate): DataGridColumn<CrmRecord>[] => [
  { accessorKey: "displayName", header: t("Customer"), size: 265, meta: { primary: true }, cell: ({ row }) => {
    const record = row.original;
    const Icon = record.type === "organization" ? Building2 : UserRound;
    return <span className={styles.identity}><span className={styles.icon}><Icon aria-hidden="true" size={16} /></span><span><strong>{String(record.displayName ?? t("Unnamed customer"))}</strong><small>{record.type === "organization" ? t("Company") : t("Person")}</small></span></span>;
  } },
  { id: "email", accessorFn: (record) => contact(record, "email") ?? "", header: t("Email"), size: 235, cell: ({ row }) => contact(row.original, "email") ?? <span className={styles.muted}>{t("Not added")}</span> },
  { id: "phone", accessorFn: (record) => contact(record, "phone") ?? "", header: t("Phone"), size: 165, cell: ({ row }) => contact(row.original, "phone") ?? <span className={styles.muted}>{t("Not added")}</span> },
  { accessorKey: "lifecycle", header: t("Relationship"), size: 130, cell: ({ row }) => lifecycle(row.original.lifecycle, t) },
  { accessorKey: "status", header: t("Status"), size: 110, cell: ({ row }) => <Badge tone={row.original.status === "archived" ? "neutral" : "success"}>{row.original.status === "archived" ? t("Archived") : t("Active")}</Badge> },
];

export function CrmCustomers({ initialData, initialRecordId, initialView = "all" }: { initialData: CrmScreenPageData; initialRecordId?: string; initialView?: CustomerView }) {
  const t = useT();
  const columns = useMemo(() => customerColumns(t), [t]);
  const [items, setItems] = useState(initialData.items);
  const [nextCursor, setNextCursor] = useState(initialData.nextCursor);
  const [view, setView] = useState<CustomerView>(initialView);
  const [selected, setSelected] = useState<string | undefined>(initialRecordId);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const visible = useMemo(() => items.filter((record) => {
    if (view === "archived") return record.status === "archived";
    if (record.status === "archived") return false;
    return view === "all" || record.type === view;
  }), [items, view]);
  const counts = useMemo(() => ({ all: items.filter((record) => record.status !== "archived").length, person: items.filter((record) => record.status !== "archived" && record.type === "person").length, organization: items.filter((record) => record.status !== "archived" && record.type === "organization").length, archived: items.filter((record) => record.status === "archived").length }), [items]);

  const reload = async (more = false) => {
    if (busy || more && !nextCursor) return;
    setBusy(true);
    setFailure("");
    try {
      const path = `parties?limit=100&includeArchived=true${more ? `&cursor=${encodeURIComponent(nextCursor ?? "")}` : ""}`;
      const result = await crmRequest<PartyPage>(initialData.workspaceId, path);
      const incoming = rows(result) as CrmRecord[];
      setItems((current) => more ? [...current, ...incoming.filter((record) => !current.some((item) => item.id === record.id))] : incoming);
      setNextCursor(result.nextCursor ?? null);
    } catch (error) { setFailure(error instanceof Error ? error.message : t("Customers could not be refreshed.")); }
    finally { setBusy(false); }
  };

  return <CrmProductShell title={t("Customers")} description="" canView={initialData.canView} useWorkspaceColors>
    {failure ? <Callout title={t("Could not refresh customers")} tone="warning">{failure}</Callout> : null}
    <div data-sales-grid className={styles.clientsGrid}><DataGrid
      ariaLabel={t("Customer records")}
      columns={columns}
      data={visible}
      emptyTitle={view === "archived" ? t("No archived customers") : t("No customers in this view")}
      emptyDescription={t("Customers are created from enquiries or added here before commercial work begins.")}
      exportFileName="wodana-customers.csv"
      footerActions={nextCursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>{t("Load more customers")}</Button> : undefined}
      getRowId={(record) => record.id}
      hasMoreRows={Boolean(nextCursor)}
      onRowAction={(record) => setSelected(record.id)}
      pageSize={25}
      persistKey="crm-customers"
      rowNumbers={false}
      toolbarLeading={<ListTabs label={t("Client lists")} value={view} onChange={setView} items={[
        { id: "all", label: t("All"), count: counts.all },
        { id: "person", label: t("People"), count: counts.person },
        { id: "organization", label: t("Companies"), count: counts.organization },
        { id: "archived", label: t("Archived"), count: counts.archived },
      ]} />}
      toolbarActions={<><IconButton aria-label={t("Refresh")} isDisabled={busy} isLoading={busy} size="compact" onPress={() => void reload()}><RefreshCw size={15} /></IconButton><Button size="compact" variant="primary" onPress={() => setCreating(true)}><Plus aria-hidden="true" size={14} />{t("Add client")}</Button></>}
      searchLabel={t("Search customers")}
      selectable={false}
    /></div>
    {creating ? <CrmCreateDialog id="customers" workspaceId={initialData.workspaceId} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await reload(); }} /> : null}
    {selected ? <ControlledModalDialog isOpen title={t("Customer details")} hideTitle size="xl" className={styles.customerModal} onOpenChange={(open) => { if (!open) setSelected(undefined); }}><LinkedRecordWorkbench id="customers" workspaceId={initialData.workspaceId} recordId={selected} onChanged={reload} /></ControlledModalDialog> : null}
  </CrmProductShell>;
}
