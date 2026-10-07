"use client";

import { useState } from "react";
import {
  Badge, Button, FormDialog, FormRow, InlineNotice, RecordTable, SelectField, SettingsRow, SettingsSection, Switch, TextInput, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { AccountView, BooksSettingsApi, LedgerSettingsView } from "@/lib/books/settings-client";
import { ACCOUNT_TYPE_LABELS, L, ROLE_LABELS } from "./ledger-labels";
import styles from "./ledger-settings.module.css";

type Editing = { account: AccountView | null } | null;

/** Accounts: the chart (add, rename, regroup, archive; never deleted), then which account each posting role uses. */
export function AccountsTab({ api, view, onChange }: { api: BooksSettingsApi; view: LedgerSettingsView; onChange: (view: LedgerSettingsView) => void }) {
  const t = useT();
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState("");
  const name = (account: AccountView) => `${account.code} · ${account.name}`;
  const columns: DataGridColumn<AccountView>[] = [
    { id: "code", header: t(L.code), accessorFn: (row) => row.code, meta: { primary: true }, cell: ({ row }: { row: { original: AccountView } }) => <span className={styles.code}>{row.original.code}</span> },
    { id: "name", header: t(L.name), accessorFn: (row) => row.name, cell: ({ row }: { row: { original: AccountView } }) => <span className={styles.value}>{row.original.name}</span> },
    { id: "type", header: t(L.type), accessorFn: (row) => row.type, cell: ({ row }: { row: { original: AccountView } }) => <span>{t(ACCOUNT_TYPE_LABELS[row.original.type])}</span> },
    { id: "roles", header: t(L.roles), accessorFn: (row) => row.roles.join(" "), meta: { priority: "low" }, cell: ({ row }: { row: { original: AccountView } }) =>
      <span className={styles.muted}>{row.original.roles.map((role) => t(ROLE_LABELS[role])).join(", ")}</span> },
    { id: "status", header: t(L.status), accessorFn: (row) => `${row.archived} ${row.isControl}`, cell: ({ row }: { row: { original: AccountView } }) => <span className={styles.badges}>
      {row.original.isControl ? <Badge tone="info">{t(L.control)}</Badge> : null}{row.original.archived ? <Badge>{t(L.archived)}</Badge> : null}</span> },
  ];
  const open = view.accounts.filter((account) => !account.archived);
  const mapRole = async (role: string, accountId: string, version: number) => {
    setError("");
    try { onChange(await api.command(view.company.id, "map_role", { role, accountId, version })); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); }
  };
  return <>
    <SettingsSection id="ledger-accounts" title={t(L.accounts)} actions={view.canManage ? <Button variant="primary" size="compact" onPress={() => setEditing({ account: null })}>{t(L.addAccount)}</Button> : undefined}>
      <RecordTable ariaLabel={t(L.accounts)} data={view.accounts} columns={columns} getRowId={(row) => row.id} selectable={false} rowNumbers={false} wrapText
        onRowAction={view.canManage ? (row) => setEditing({ account: row }) : undefined} />
    </SettingsSection>
    <SettingsSection id="ledger-roles" title={t(L.postingRoles)}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {view.roles.map((mapping) => <SettingsRow key={mapping.role} label={t(ROLE_LABELS[mapping.role])}>
        <SelectField aria-label={t(ROLE_LABELS[mapping.role])} label={null} isDisabled={!view.canManage} selectedKey={mapping.accountId}
          onSelectionChange={(key) => key && key !== mapping.accountId && void mapRole(mapping.role, String(key), mapping.version)}
          items={open.map((account) => ({ id: account.id, label: name(account) }))} />
      </SettingsRow>)}
    </SettingsSection>
    {editing ? <AccountDialog api={api} view={view} account={editing.account} onClose={() => setEditing(null)} onSaved={(next) => { onChange(next); setEditing(null); }} /> : null}
  </>;
}

/** Add or change one account; archive or restore it from the dialog's footer. */
function AccountDialog({ api, view, account, onClose, onSaved }: { api: BooksSettingsApi; view: LedgerSettingsView; account: AccountView | null; onClose: () => void; onSaved: (view: LedgerSettingsView) => void }) {
  const t = useT();
  const [draft, setDraft] = useState({
    code: account?.code ?? "", name: account?.name ?? "", type: account?.type ?? "expense", subtype: account?.subtype ?? "", parentId: account?.parentId ?? null as string | null,
    isControl: account?.isControl ?? false, allowManual: account?.allowManual ?? true,
  });
  const [busy, setBusy] = useState(false);
  const used = Boolean(account?.used);
  const parents = view.accounts.filter((item) => !item.archived && item.type === draft.type && item.id !== account?.id);
  const archive = async () => {
    if (!account) return;
    setBusy(true);
    try { onSaved(await api.command(view.company.id, account.archived ? "restore_account" : "archive_account", { accountId: account.id, version: account.version })); } finally { setBusy(false); }
  };
  return <FormDialog title={account ? t(L.editAccount) : t(L.addAccount)} submitLabel={t(L.save)} onClose={onClose} isSubmitting={busy}
    isDirty={JSON.stringify(draft) !== JSON.stringify({ code: account?.code ?? "", name: account?.name ?? "", type: account?.type ?? "expense", subtype: account?.subtype ?? "",
      parentId: account?.parentId ?? null, isControl: account?.isControl ?? false, allowManual: account?.allowManual ?? true })}
    secondaryAction={account ? <Button variant="quiet" onPress={() => void archive()}>{account.archived ? t(L.restore) : t(L.archive)}</Button> : undefined}
    onSubmit={async () => {
      const input = { ...draft, allowManual: draft.isControl ? false : draft.allowManual };
      onSaved(account ? await api.command(view.company.id, "update_account", { accountId: account.id, version: account.version, ...input })
        : await api.command(view.company.id, "add_account", input));
    }}>
    {used ? <InlineNotice tone="info" message={t(L.usedHint)} /> : null}
    <FormRow>
      <TextInput label={t(L.code)} isRequired isDisabled={used} value={draft.code} onChange={(value) => setDraft({ ...draft, code: value })} />
      <SelectField label={t(L.type)} isDisabled={used} selectedKey={draft.type} onSelectionChange={(key) => key && setDraft({ ...draft, type: String(key) as AccountView["type"], parentId: null })}
        items={Object.entries(ACCOUNT_TYPE_LABELS).map(([id, label]) => ({ id, label: t(label) }))} />
    </FormRow>
    <TextInput label={t(L.name)} isRequired value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
    <FormRow>
      <TextInput label={t(L.group)} value={draft.subtype} onChange={(value) => setDraft({ ...draft, subtype: value })} />
      <SelectField label={t(L.parent)} placeholder={t(L.none)} selectedKey={draft.parentId} onSelectionChange={(key) => setDraft({ ...draft, parentId: key ? String(key) : null })}
        items={parents.map((item) => ({ id: item.id, label: `${item.code} · ${item.name}` }))} />
    </FormRow>
    <Switch isDisabled={used} isSelected={draft.isControl} onChange={(value) => setDraft({ ...draft, isControl: value, allowManual: value ? false : draft.allowManual })}>{t(L.control)}</Switch>
    <p className={styles.muted}>{t(L.controlHint)}</p>
    <Switch isDisabled={draft.isControl} isSelected={draft.isControl ? false : draft.allowManual} onChange={(value) => setDraft({ ...draft, allowManual: value })}>{t(L.manualEntries)}</Switch>
  </FormDialog>;
}
