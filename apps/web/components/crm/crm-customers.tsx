"use client";

import { useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Badge, Button, Callout, DataGrid, EmptyState, IconButton, ControlledModalDialog, ListTabs, NoResultsState, RecordName, type DataGridColumn } from "@/design-system";
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
  { accessorKey: "displayName", header: t("Customer"), size: 265, meta: { primary: true, renderCell: (record) => <RecordName title={String(record.displayName ?? t("Unnamed customer"))} detail={record.type === "organization" ? t("Company") : t("Person")} /> } },
  { id: "phone", accessorFn: (record) => contact(record, "phone") ?? "", header: t("Phone"), size: 165, cell: ({ row }) => contact(row.original, "phone") ?? <span className={styles.muted}>{t("Not added")}</span> },
  { id: "email", accessorFn: (record) => contact(record, "email") ?? "", header: t("Email"), size: 235, meta: { priority: "medium" }, cell: ({ row }) => contact(row.original, "email") ?? <span className={styles.muted}>{t("Not added")}</span> },
  { accessorKey: "lifecycle", header: t("Relationship"), size: 130, meta: { priority: "low" }, cell: ({ row }) => lifecycle(row.original.lifecycle, t) },
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
  const [search, setSearch] = useState("");

  const visible = useMemo(() => items.filter((record) => {
    if (view === "archived") return record.status === "archived";
    if (record.status === "archived") return false;
    return view === "all" || record.type === view;
  }), [items, view]);

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

  const add = () => setCreating(true);
  return <CrmProductShell title={t("Clients")} canView={initialData.canView} useWorkspaceColors
    actions={<Button variant="primary" onPress={add}><Plus aria-hidden="true" size={15} />{t("Add client")}</Button>}
    tabs={<ListTabs label={t("Client lists")} value={view} onChange={setView} items={[
      { id: "all", label: t("All") }, { id: "person", label: t("People") }, { id: "organization", label: t("Companies") }, { id: "archived", label: t("Archived") },
    ]} />}>
    {failure ? <Callout title={t("Could not refresh customers")} tone="warning">{failure}</Callout> : null}
    <DataGrid
      gridKey="crm.customers"
      ariaLabel={t("Customer records")}
      columns={columns}
      data={visible}
      emptyContent={search.trim() || view !== "all" ? <NoResultsState onClear={() => { setSearch(""); setView("all"); }} />
        : <EmptyState title={t("No clients yet")} description={t("Customers are created from enquiries or added here before commercial work begins.")} action={<Button variant="primary" onPress={add}>{t("Add client")}</Button>} />}
      exportFileName="wodana-customers.csv"
      footerActions={<>{nextCursor ? <Button size="compact" isLoading={busy} onPress={() => void reload(true)}>{t("Load more customers")}</Button> : null}<IconButton aria-label={t("Refresh")} isDisabled={busy} isLoading={busy} size="compact" onPress={() => void reload()}><RefreshCw size={15} /></IconButton></>}
      getRowId={(record) => record.id}
      hasMoreRows={Boolean(nextCursor)}
      onRowAction={(record) => setSelected(record.id)}
      onSearchChange={setSearch}
      pageSize={25}
      persistKey="crm-customers"
      rowNumbers={false}
      searchLabel={t("Search customers")}
      searchValue={search}
      selectable={false}
    />
    {creating ? <CrmCreateDialog id="customers" workspaceId={initialData.workspaceId} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await reload(); }} /> : null}
    {selected ? <ControlledModalDialog isOpen title={t("Customer details")} hideTitle size="xl" className={styles.customerModal} onOpenChange={(open) => { if (!open) setSelected(undefined); }}><LinkedRecordWorkbench id="customers" workspaceId={initialData.workspaceId} recordId={selected} onChanged={reload} /></ControlledModalDialog> : null}
  </CrmProductShell>;
}
