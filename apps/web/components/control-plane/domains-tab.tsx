"use client";

import { parseDate } from "@internationalized/date";
import { Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge, Button, Callout, ControlledModalDialog, DateField, ErrorState, InlineNotice, InspectorSheet, RecordTable, TextInput,
  EmptyState, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { consoleApi, type ConsoleDomain, type DomainList } from "@/lib/internal/console";
import { useConsoleFormat, useConsoleLabels } from "./labels";
import styles from "./control-plane.module.css";

type Step = "verify" | "recheck" | "rotate-challenge" | "remove" | "activate" | "rollback-complete";

/**
 * Custom domains: requested → verifying → verified → certificate issued → live (or failed, removed).
 * Until a domain is live, the organization signs in at its Wodana address.
 */
export function DomainsTab({ orgKey, canManage }: { orgKey: string; canManage: boolean }) {
  const t = useT();
  const labels = useConsoleLabels();
  const format = useConsoleFormat();
  const [data, setData] = useState<DomainList | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    try { setData(await consoleApi.domains(orgKey)); setError(""); }
    catch (cause) { setError((cause as Error).message || t("Domains didn't load.")); }
  }, [orgKey, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const columns = useMemo<DataGridColumn<ConsoleDomain>[]>(() => [
    { id: "hostname", header: t("Domain"), size: 260, accessorFn: (row) => row.hostname, meta: { primary: true, renderCell: (row) =>
      <span className={styles.nameCell}><strong dir="ltr">{row.hostname}</strong>{row.issues[0] ? <small>{row.issues[0]}</small> : null}</span> } },
    { id: "state", header: t("State"), size: 170, accessorFn: (row) => row.state, meta: { renderCell: (row) =>
      <Badge tone={labels.domain[row.state].tone}>{labels.domain[row.state].label}</Badge> } },
    { id: "checked", header: t("Last checked"), size: 150, accessorFn: (row) => row.lastCheckedAt ?? "", meta: { renderCell: (row) =>
      row.lastCheckedAt ? format.relative(row.lastCheckedAt) : <span className={styles.muted}>{t("Not yet")}</span> } },
  ], [format, labels, t]);
  const open = data?.domains.find((domain) => domain.id === openId) ?? null;

  if (error && !data) return <div className={styles.panel}><ErrorState description={error} onRetry={() => void load()} /></div>;
  return <div className={styles.panel}>
    <div className={styles.toolbar}>
      {data ? <p className={styles.inline}>{t("Signs in at")} <strong dir="ltr">{data.signIn.hostname}</strong>
        {data.signIn.fallback && data.domains.length ? <Badge tone="warning">{t("Wodana address")}</Badge> : null}</p> : <span />}
      {canManage ? <div className={styles.toolbarActions}><Button onPress={() => setAdding(true)}>{t("Add domain")}</Button></div> : null}
    </div>
    <RecordTable<ConsoleDomain> ariaLabel={t("Domains")} columns={columns} data={data?.domains ?? []} getRowId={(row) => row.id}
      isLoading={!data} onRowAction={(row) => setOpenId(row.id)} emptyContent={<EmptyState illustration={null} title={t("No custom domain")} description={t("The organization signs in at its Wodana address.")} />}
      rowNumbers={false} selectable={false} showToolbar={false} showFooter={false} wrapText />
    {open ? <DomainSheet orgKey={orgKey} domain={open} canManage={canManage} onClose={() => setOpenId(null)} onChanged={load} /> : null}
    {adding ? <AddDomainDialog orgKey={orgKey} onClose={() => setAdding(false)} onAdded={async (id) => { setAdding(false); await load(); setOpenId(id); }} /> : null}
  </div>;
}

function DomainSheet({ orgKey, domain, canManage, onClose, onChanged }: {
  orgKey: string; domain: ConsoleDomain; canManage: boolean; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const t = useT();
  const labels = useConsoleLabels();
  const format = useConsoleFormat();
  const [busy, setBusy] = useState<Step | "certificate" | null>(null);
  const [error, setError] = useState("");
  const [certificate, setCertificate] = useState(false);
  const run = async (step: Step) => {
    setBusy(step); setError("");
    try {
      if (step === "activate" || step === "rollback-complete") await consoleApi.domainStep(orgKey, domain.id, step, { expectedVersion: domain.version });
      else await consoleApi.domainAction(orgKey, domain.id, step, domain.version);
      await onChanged();
      if (step === "remove") onClose();
    } catch (cause) { setError((cause as Error).message || t("The domain could not be updated.")); await onChanged(); }
    finally { setBusy(null); }
  };
  const rollback = domain.rollback.status === "pending" || domain.rollback.status === "failed";
  const needsRecord = domain.state === "requested" || domain.state === "verifying" || (domain.state === "failed" && domain.dns.status !== "verified" && !rollback);
  const removable = domain.routing.status !== "active" && !rollback && domain.certificate.status !== "issued";
  const state = labels.domain[domain.state];
  return <InspectorSheet isOpen size="md" title={domain.hostname} onOpenChange={(value) => { if (!value) onClose(); }}>
    <div className={styles.stack}>
      <p className={styles.inline}><Badge tone={state.tone}>{state.label}</Badge>
        {domain.certificate.expiresAt ? <span className={styles.muted}>{t("Certificate until {date}", { date: format.date(domain.certificate.expiresAt) })}</span> : null}</p>
      {domain.issues.length ? <Callout tone="warning" title={domain.issues[0]}>{domain.issues.slice(1).join(" · ") || t("Sign-in uses the Wodana address meanwhile.")}</Callout> : null}
      {needsRecord ? <section className={styles.section} aria-label={t("DNS record")}>
        <h2 className={styles.subhead}>{t("DNS record")}</h2>
        <dl className={styles.record}>
          <dt>{t("Type")}</dt><dd><code>{domain.dns.record.type}</code></dd>
          <dt>{t("Name")}</dt><dd><code>{domain.dns.record.name}</code></dd>
          <dt>{t("Value")}</dt><dd><code>{domain.dns.record.value}</code></dd>
          <dt>{t("Valid until")}</dt><dd>{format.dateTime(domain.dns.expiresAt)}</dd>
        </dl>
        <div><Button size="compact" onPress={() => void navigator.clipboard.writeText(`${domain.dns.record.name}\n${domain.dns.record.value}`)}>
          <Copy aria-hidden="true" size={14} />{t("Copy record")}</Button></div>
      </section> : null}
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {canManage ? <div className={styles.actions}>
        {removable ? <Button variant="quiet" isLoading={busy === "remove"} onPress={() => void run("remove")}>{t("Remove")}</Button> : null}
        {domain.dns.status === "verified" ? <Button isLoading={busy === "recheck"} onPress={() => void run("recheck")}>{t("Recheck")}</Button> : null}
        {needsRecord ? <Button isLoading={busy === "rotate-challenge"} onPress={() => void run("rotate-challenge")}>{t("New code")}</Button> : null}
        {rollback ? <Button variant="primary" isLoading={busy === "rollback-complete"} onPress={() => void run("rollback-complete")}>{t("Finish rollback")}</Button> : null}
        {domain.state === "requested" || domain.state === "verifying"
          ? <Button variant="primary" isLoading={busy === "verify"} onPress={() => void run("verify")}>{t("Verify")}</Button> : null}
        {domain.state === "verified" ? <Button variant="primary" onPress={() => setCertificate(true)}>{t("Record certificate")}</Button> : null}
        {domain.state === "certificate_issued" ? <Button variant="primary" isLoading={busy === "activate"} onPress={() => void run("activate")}>{t("Go live")}</Button> : null}
      </div> : null}
    </div>
    {certificate ? <CertificateDialog onClose={() => setCertificate(false)} onSave={async (expiresAt) => {
      await consoleApi.domainStep(orgKey, domain.id, "certificate", { expectedVersion: domain.version, expiresAt });
      setCertificate(false); await onChanged();
    }} /> : null}
  </InspectorSheet>;
}

function CertificateDialog({ onClose, onSave }: { onClose: () => void; onSave: (expiresAt: string) => Promise<void> }) {
  const t = useT();
  const [date, setDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <ControlledModalDialog isOpen size="md" title={t("Record certificate")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!date} onPress={async () => {
        setBusy(true); setError("");
        try { await onSave(new Date(`${date}T00:00:00`).toISOString()); } catch (cause) { setError((cause as Error).message || t("The certificate could not be recorded.")); }
        finally { setBusy(false); }
      }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <DateField label={t("Expires on")} isRequired value={date ? parseDate(date) : null} onChange={(value) => setDate(value ? value.toString() : null)} />
      {error ? <InlineNotice tone="error" message={error} /> : null}
    </div>
  </ControlledModalDialog>;
}

function AddDomainDialog({ orgKey, onClose, onAdded }: { orgKey: string; onClose: () => void; onAdded: (id: string) => Promise<void> }) {
  const t = useT();
  const [hostname, setHostname] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <ControlledModalDialog isOpen size="md" title={t("Add domain")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!hostname.trim()} onPress={async () => {
        setBusy(true); setError("");
        try { const created = await consoleApi.requestDomain(orgKey, hostname.trim(), key); await onAdded(created.id); }
        catch (cause) { setError((cause as Error).message || t("The domain could not be added.")); }
        finally { setBusy(false); }
      }}>{t("Add")}</Button></div>}>
    <div className={styles.dialogBody}>
      <TextInput label={t("Domain")} isRequired value={hostname} onChange={setHostname} placeholder="portal.example.com" />
      {error ? <InlineNotice tone="error" message={error} /> : null}
    </div>
  </ControlledModalDialog>;
}
