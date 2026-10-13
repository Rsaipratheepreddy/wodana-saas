"use client";

import { ArrowUpRight, Copy, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button, Checkbox, EmailInput, EmptyState, ErrorState, IconMenuButton, InlineNotice, isNoAccessError, NoAccessState, PersonNameField, PhoneField, RecordTable, SegmentedControl, Skeleton,
  type DataGridColumn, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, staffPortalApi } from "@/lib/client-portal/client";
import type { PortalContact } from "@/lib/client-portal/types";
import { formatPhoneForDisplay, joinPhone, phoneCountry, splitPhone } from "@/lib/phone";
import styles from "./staff.module.css";

type Draft = { id?: string; version?: number; name: string; country: string; national: string; email: string; role: "approver" | "viewer"; active: boolean; testContact: boolean;
  /** An admin gives a demonstration: the contact signs in with the demo code, and no code is sent. */
  demoAccess?: boolean };

/** The code a demonstration contact signs in with. */
const DEMO_CODE = "123456";

/**
 * The client contacts of one project: who can sign in to the portal (by mobile number, with an email for
 * codes and notices when WhatsApp can't), who decides and who only reads, and signing someone out.
 */
export function ClientContacts({ workspaceId, caseId, portalUrl, portalEnabled, locale, onChanged }: {
  /** Where the portal opens: the full address, or a path on this site. */
  workspaceId: string; caseId: string; portalUrl: string | null; portalEnabled: boolean; locale?: string; onChanged?: () => void | Promise<unknown>;
}) {
  const t = useT();
  const api = useMemo(() => staffPortalApi(workspaceId, t), [workspaceId, t]);
  const [state, setState] = useState<{ contacts: PortalContact[]; canManage: boolean; demo: boolean } | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const country = phoneCountry(null, locale) ?? "";
  const load = useCallback(async () => {
    try { setState(await api.contacts(caseId)); setError(""); } catch (cause) { setError((cause as Error).message); }
  }, [api, caseId]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !state) return isNoAccessError(error) ? <NoAccessState area={t("Client access")} /> : <ErrorState description={error} onRetry={() => void load()} />;
  if (!state) return <Skeleton lines={3} shape="rows" />;
  const done = async (message: string, next: { contacts: PortalContact[]; canManage: boolean; demo: boolean }) => {
    setState(next); setEdit(null); setNotice(message); await onChanged?.();
  };
  const save = async () => {
    if (!edit) return;
    setBusy(true); setError("");
    try {
      const phone = joinPhone(edit.country, edit.national);
      const saved = await api.saveContact(caseId, { id: edit.id, version: edit.version, name: edit.name.trim(), phone,
        email: edit.email.trim() || null, role: edit.role, active: edit.active, testContact: edit.testContact });
      const added = edit.demoAccess ? saved.contacts.find((contact) => contact.phone === phone && !contact.demoCode) : undefined;
      await done(t("Saved."), added ? await api.demoCode(caseId, added.id, { commandId: commandId(), version: added.version, code: DEMO_CODE }) : saved);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const demo = async (contact: PortalContact, code: string | null) => {
    const name = contact.confirmedName ?? contact.name;
    try {
      await done(code ? t("{name} signs in with the demo code.", { name }) : t("The demo code was cleared."),
        await api.demoCode(caseId, contact.id, { commandId: commandId(), version: contact.version, code }));
    } catch (cause) { setError((cause as Error).message); }
  };
  const signOut = async (contact: PortalContact) => {
    try { await done(t("{name} was signed out everywhere.", { name: contact.confirmedName ?? contact.name }), await api.signOut(caseId, contact.id)); }
    catch (cause) { setError((cause as Error).message); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(new URL(portalUrl ?? "", location.origin).toString()); setNotice(t("Portal link copied.")); }
    catch { setError(t("Couldn't copy. Open the portal and copy its address.")); }
  };
  const open = (contact?: PortalContact) => {
    setError("");
    const phone = contact ? splitPhone(contact.phone, country) : { country, national: "" };
    setEdit(contact ? { id: contact.id, version: contact.version, name: contact.name, country: phone.country, national: phone.national, email: contact.email ?? "", role: contact.role,
      active: contact.active, testContact: contact.testContact } : { name: "", country, national: "", email: "", role: "approver", active: true, testContact: state.demo });
  };
  const columns: DataGridColumn<PortalContact>[] = [
    { id: "name", header: t("Client contact"), accessorFn: (row) => row.confirmedName ?? row.name, meta: { primary: true } },
    { id: "phone", header: t("Mobile"), accessorFn: (row) => formatPhoneForDisplay(row.phone), cell: ({ row }: { row: { original: PortalContact } }) => <bdi dir="ltr">{formatPhoneForDisplay(row.original.phone)}</bdi> },
    { id: "email", header: t("Email"), accessorFn: (row) => row.email ?? "", cell: ({ row }: { row: { original: PortalContact } }) => <bdi dir="ltr">{row.original.email ?? ""}</bdi> },
    { id: "role", header: t("Can"), accessorFn: (row) => (row.role === "approver" ? t("Decide") : t("Read")) },
    { id: "access", header: t("Access"), accessorFn: (row) => [!row.active ? t("Off") : row.signedIn ? t("Signed in") : row.lastSignedInAt ? t("Signed out") : t("Not yet"),
      row.demoCode ? t("Demo access") : ""].filter(Boolean).join(" · ") },
    ...(state.canManage ? [{ id: "actions", header: "", enableSorting: false, cell: ({ row }: { row: { original: PortalContact } }) =>
      <IconMenuButton ariaLabel={t("Actions for {name}", { name: row.original.name })} items={[{ id: "edit", label: t("Edit") },
        row.original.demoCode ? { id: "clear-demo", label: t("Clear demo code") } : { id: "demo", label: t("Set demo code") },
        ...(row.original.signedIn ? [{ id: "sign-out", label: t("Sign out everywhere") }] : [])]}
        onAction={(id) => (id === "edit" ? open(row.original) : id === "demo" ? void demo(row.original, DEMO_CODE) : id === "clear-demo" ? void demo(row.original, null) : void signOut(row.original))} /> } as DataGridColumn<PortalContact>] : []),
  ];
  return <div className={styles.stack}>
    <div className={styles.toolbar}>
      {portalUrl && portalEnabled ? <>
        <Button size="compact" variant="quiet" onPress={() => void copy()}><Copy aria-hidden="true" size={14} />{t("Copy portal link")}</Button>
        <a className={styles.link} href={portalUrl} rel="noreferrer" target="_blank">{t("Open the portal")}<ArrowUpRight aria-hidden="true" data-directional="true" size={14} /></a>
      </> : null}
      <span className={styles.spacer} />
      {state.canManage ? <Button size="compact" variant="primary" onPress={() => open()}><Plus aria-hidden="true" size={14} />{t("Add contact")}</Button> : null}
    </div>
    {!portalEnabled ? <InlineNotice tone="info" message={state.canManage ? <>{t("The portal is off.")} <Link href="/workspace/settings/client-portal">{t("Turn it on in Settings")}</Link></> : t("The portal is off.")} /> : null}
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {error && !edit ? <InlineNotice tone="error" message={error} /> : null}
    {state.contacts.length ? <RecordTable ariaLabel={t("Client contacts")} data={state.contacts} getRowId={(row) => row.id} columns={columns} showToolbar={false} wrapText />
      : <EmptyState title={t("No client contacts yet")} description={state.canManage ? t("Add the people who follow this project.") : t("People who manage the client portal add contacts here.")} action={state.canManage ? <Button variant="primary" onPress={() => open()}>{t("Add contact")}</Button> : undefined} />}
    {edit ? <FormDialog title={edit.id ? t("Edit contact") : t("Add contact")} onClose={() => { setEdit(null); }} error={error || undefined} isSubmitting={busy} isSubmitDisabled={!edit.name.trim() || !edit.national.trim()} submitLabel={t("Save")} onSubmit={() => save()}>
      <div className={styles.stack}>
        <PersonNameField label={t("Name")} value={edit.name} savedValue={state.contacts.find((contact) => contact.id === edit.id)?.name} onChange={(name) => setEdit({ ...edit, name })} maxLength={160} isRequired autoFocus />
        <PhoneField label={t("Mobile number")} value={edit.national} countryCode={edit.country} locale={locale} isRequired
          onChange={(national) => setEdit({ ...edit, national })} onCountryChange={(next) => setEdit({ ...edit, country: next })} description={t("They sign in with this number.")} />
        <EmailInput label={t("Email")} value={edit.email} onChange={(email) => setEdit({ ...edit, email })} maxLength={254} description={t("For codes and notices when WhatsApp can't.")} />
        <SegmentedControl label={t("Can")} value={edit.role} onChange={(role) => setEdit({ ...edit, role: role as Draft["role"] })}
          options={[{ id: "approver", label: t("Decide") }, { id: "viewer", label: t("Read") }]} />
        {edit.id ? <Checkbox isSelected={edit.active} onChange={(active) => setEdit({ ...edit, active })}>{t("Can sign in")}</Checkbox> : null}
        {state.demo ? <Checkbox isSelected={edit.testContact} onChange={(testContact) => setEdit({ ...edit, testContact })}>{t("Test contact (demo code)")}</Checkbox> : null}
        {!edit.id && !state.demo ? <Checkbox isSelected={edit.demoAccess === true} onChange={(demoAccess) => setEdit({ ...edit, demoAccess })}>{t("Demo access: signs in with {code}", { code: DEMO_CODE })}</Checkbox> : null}
      </div>
    </FormDialog> : null}
  </div>;
}
