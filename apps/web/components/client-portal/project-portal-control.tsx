"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Checkbox, ControlledModalDialog, IconMenuButton, InlineNotice, Switch, TextInput, formatDate, useDesignSystem, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { commandId, staffPortalApi } from "@/lib/client-portal/client";
import type { ClientAccess, PortalSection, ProjectPortal } from "@/lib/client-portal/types";
import { ClientContacts } from "./client-contacts";
import { usePortalLabels } from "./portal-labels";
import styles from "./staff.module.css";

type Notice = { tone: "success" | "error"; message: string };

/**
 * A project's place in the client portal: which of the workspace's sections this client sees, pausing it,
 * who can sign in, and the client's own access: invite them (an email with the portal address and how to
 * sign in), see whether they were invited or have been in, copy the portal link, take access away, and (a
 * workspace admin) set or clear a demonstration sign-in code for them. Shown on the project's Updates.
 */
export function ProjectPortalControl({ workspaceId, projectId, locale }: { workspaceId: string; projectId: string; locale?: string }) {
  const t = useT();
  const labels = usePortalLabels();
  const region = useDesignSystem();
  const api = useMemo(() => staffPortalApi(workspaceId, t), [workspaceId, t]);
  const [portal, setPortal] = useState<ProjectPortal | null>(null);
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<PortalSection[]>([]);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoCode, setDemoCode] = useState("");
  const load = useCallback(async () => {
    try { setPortal(await api.project(projectId)); } catch { setPortal(null); }
  }, [api, projectId]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (!portal) return null;
  const shown = portal.access.sections ?? portal.sections;
  const summary = !portal.enabled ? t("Off for the workspace") : portal.access.paused ? t("Paused") : shown.length ? shown.map((section) => labels.sections[section]).join(", ") : t("Nothing shared");
  const edit = () => { setSections(portal.access.sections ?? portal.sections); setPaused(portal.access.paused); setError(""); setOpen(true); };
  const save = async () => {
    setBusy(true); setError("");
    try {
      // Every workspace section chosen means "follow the workspace", so new sections appear for this client too.
      const all = portal.sections.every((section) => sections.includes(section));
      setPortal(await api.saveProject(projectId, { version: portal.access.version, sections: all ? null : sections, paused }));
      setOpen(false);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const contacts = portal.contacts.filter((contact) => contact.active).length;
  const client = portal.client;
  const name = client.name ?? "";
  const canInvite = portal.canManage && !client.blocked;
  const run = async (work: () => Promise<ProjectPortal>, done: (next: ProjectPortal) => Notice | null) => {
    setBusy(true); setNotice(null);
    try { const next = await work(); setPortal(next); setNotice(done(next)); }
    catch (cause) { setNotice({ tone: "error", message: (cause as Error).message }); }
    finally { setBusy(false); }
  };
  const invite = () => run(() => api.inviteClient(projectId, { commandId: commandId(), version: client.version }), (next) => (next.client.delivery === "sent"
    ? { tone: "success", message: t("Invite sent to {email}.", { email: next.client.email ?? "" }) }
    : { tone: "error", message: t("The invite was saved but the email didn't go out. Copy the portal link and send it to the client.") }));
  const revoke = () => run(() => api.revokeClient(projectId, { commandId: commandId(), version: client.version }), () => { setConfirmRevoke(false); return { tone: "success", message: t("{name} can't sign in any more.", { name }) }; });
  const copy = async () => {
    try { await navigator.clipboard.writeText(portal.portalUrl); setNotice({ tone: "success", message: t("Portal link copied.") }); }
    catch { setNotice({ tone: "error", message: t("Couldn't copy. Open the portal and copy its address.") }); }
  };
  // The demonstration code: set on this client's contact by a workspace admin, or cleared; then the project is read again.
  const demo = (code: string | null) => run(async () => {
    await api.demoCode(portal.caseId, client.grantId!, { commandId: commandId(), version: client.version, code });
    return api.project(projectId);
  }, () => { setDemoOpen(false); setDemoCode(""); return { tone: "success", message: code ? t("{name} signs in with the demo code.", { name }) : t("The demo code was cleared.") }; });
  const canDemo = portal.canSetDemoCode && Boolean(client.grantId) && client.status !== "revoked";
  const menu = [
    ...(portal.enabled ? [{ id: "copy", label: t("Copy portal link") }] : []),
    ...(canInvite && client.status === "active" ? [{ id: "resend", label: t("Resend invite") }] : []),
    ...(canDemo && !client.demoCode ? [{ id: "demo", label: t("Set demo code") }] : []),
    ...(canDemo && client.demoCode ? [{ id: "clear-demo", label: t("Clear demo code") }] : []),
    ...(portal.canManage && client.grantId && client.status !== "revoked" ? [{ id: "revoke", label: t("Revoke access") }] : []),
  ];
  return <div className={styles.control} data-tour="portal-control">
    <div className={styles.controlText}>
      <span className={styles.controlTitle}>{t("Client portal")}</span>
      <span className={styles.muted}>{summary} · {contacts === 1 ? t("1 contact") : t("{count} contacts", { count: contacts })}</span>
    </div>
    <div className={styles.controlActions}>
      {canInvite && (client.status === "not_invited" || client.status === "revoked")
        ? <Button size="compact" variant="primary" isLoading={busy} onPress={() => void invite()}>{t("Invite client")}</Button> : null}
      {canInvite && client.status === "invited"
        ? <Button size="compact" isLoading={busy} isDisabled={client.resendAfter > 0} onPress={() => void invite()}>{t("Resend invite")}</Button> : null}
      {menu.length ? <IconMenuButton ariaLabel={t("More client portal actions")} items={menu}
        onAction={(id) => (id === "copy" ? void copy() : id === "resend" ? void invite() : id === "demo" ? setDemoOpen(true) : id === "clear-demo" ? void demo(null) : setConfirmRevoke(true))} /> : null}
      <Button size="compact" data-tour="portal-manage" data-tour-safe onPress={edit}>{portal.canManage ? t("Manage") : t("View")}</Button>
    </div>
    <div className={styles.client}>
      <span className={styles.clientName}>{name || t("No client")}</span>
      <ClientStatus client={client} locale={region.locale} timeZone={region.timeZone} />
      {client.demoCode ? <Badge tone="warning">{t("Demo access")}</Badge> : null}
      {portal.enabled ? <Link className={styles.link} data-tour="portal-client-view" href={`/workspace/client-view/${portal.caseId}`}>{t("See it as the client")}</Link> : null}
    </div>
    {notice ? <InlineNotice className={styles.notice} tone={notice.tone} message={notice.message} /> : null}
    {open ? <ControlledModalDialog isOpen onOpenChange={setOpen} size="lg" title={t("Client portal")}
      footer={portal.canManage ? <div className="wd-dialog-actions"><Button onPress={() => setOpen(false)}>{t("Cancel")}</Button>
        <Button variant="primary" isLoading={busy} onPress={() => void save()}>{t("Save")}</Button></div> : undefined}>
      <div className={styles.stack}>
        {error ? <InlineNotice tone="error" message={error} /> : null}
        <Switch isDisabled={!portal.canManage} isSelected={paused} onChange={setPaused}>{t("Pause for this project")}</Switch>
        <fieldset className={styles.sections} data-tour="portal-sections" disabled={paused || !portal.canManage}>
          <legend>{t("This client sees")}</legend>
          {portal.sections.map((section) => <Checkbox key={section} isDisabled={paused || !portal.canManage} isSelected={sections.includes(section)}
            onChange={(on) => setSections((current) => (on ? [...current, section] : current.filter((item) => item !== section)))}>{labels.sections[section]}</Checkbox>)}
        </fieldset>
        <ClientContacts workspaceId={workspaceId} caseId={portal.caseId} portalUrl={portal.portalUrl} portalEnabled={portal.enabled} locale={locale} onChanged={load} />
      </div>
    </ControlledModalDialog> : null}
    {demoOpen ? <FormDialog title={t("Set demo code for {name}", { name })} description={t("They sign in with this code and their mobile number; no code is sent to them. For demonstrations only.")} onClose={() => { setDemoOpen(false); }} isSubmitting={busy} isSubmitDisabled={demoCode.length !== 6} submitLabel={t("Save")} onSubmit={() => demo(demoCode)}>
      <TextInput label={t("Demo code")} value={demoCode} onChange={(value) => setDemoCode(value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" maxLength={6} autoFocus />
    </FormDialog> : null}
    {confirmRevoke ? <FormDialog title={t("Revoke access for {name}?", { name })} description={t("They are signed out everywhere and can't sign in until invited again.")} onClose={() => { setConfirmRevoke(false); }} isSubmitting={busy} submitVariant="danger" submitLabel={t("Revoke access")} onSubmit={() => revoke()}>
      <span />
    </FormDialog> : null}
  </div>;
}

/** The client's standing in one glance: not invited, invited (when), active (last visit), revoked, or what blocks an invite. */
function ClientStatus({ client, locale, timeZone }: { client: ClientAccess; locale: string; timeZone: string }) {
  const t = useT();
  const when = (value: string) => formatDate(value, { locale, timeZone });
  const fix = client.partyId ? `/workspace/crm/customers?record=${client.partyId}` : "/workspace/crm/customers";
  if (client.blocked === "no_email" || client.blocked === "no_phone") return <>
    <Badge tone="warning">{client.blocked === "no_email" ? t("No email") : t("No mobile number")}</Badge>
    <Link className={styles.link} href={fix}>{client.blocked === "no_email" ? t("Add an email to the client") : t("Add a mobile number to the client")}</Link>
  </>;
  if (client.status === "active") return <>
    <Badge tone="success">{t("Active")}</Badge>
    {client.lastVisitAt ? <span className={styles.muted}>{t("Last visit {date}", { date: when(client.lastVisitAt) })}</span> : null}
  </>;
  if (client.status === "invited") return <>
    <Badge tone="info">{t("Invited")}</Badge>
    {client.invitedAt ? <span className={styles.muted}>{when(client.invitedAt)}</span> : null}
    {client.delivery && client.delivery !== "sent" ? <Badge tone="warning">{t("Email not sent")}</Badge> : null}
  </>;
  if (client.status === "revoked") return <Badge tone="danger">{t("Access revoked")}</Badge>;
  return <Badge tone="neutral">{t("Not invited")}</Badge>;
}
