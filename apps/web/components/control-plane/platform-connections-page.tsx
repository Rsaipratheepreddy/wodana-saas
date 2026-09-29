"use client";

import { Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ProviderMark } from "@/components/brand/provider-mark";
import {
  Badge, Button, ErrorState, FormDialog, IconButton, PageHeader, PageSkeleton, SelectField, Surface, TextInput, useToast,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey } from "@/lib/i18n/keys";
import {
  platformConnectionsApi, TEST_REASON_LABELS, ZOHO_DATA_CENTERS,
  type PlatformConnection, type PlatformConnectionSave, type PlatformConnectionStatus, type PlatformProvider,
  type PlatformSecretField, type PlatformValueField,
} from "@/lib/internal/platform-connections";
import type { ProviderCapabilityState } from "@/lib/workspace/integrations";
import { useConsoleFormat } from "./labels";
import styles from "./control-plane.module.css";

type Vendor = Exclude<PlatformProvider, "platform">;
type FieldSpec = {
  id: PlatformValueField | PlatformSecretField;
  label: MessageKey;
  secret?: boolean;
  options?: ReadonlyArray<{ id: string; label: MessageKey }>;
  placeholder?: string;
};

const ENVIRONMENTS = [{ id: "sandbox", label: tKey("Sandbox") }, { id: "production", label: tKey("Production") }] as const;
const CLIENT_ID: FieldSpec = { id: "clientId", label: tKey("Client ID") };
const CLIENT_SECRET: FieldSpec = { id: "clientSecret", label: tKey("Client secret"), secret: true };

/** Each provider's app: its console's name, the product firms connect, and the fields Wodana needs. */
const VENDORS: Array<{ id: Vendor; name: string; product: string; mark: ProviderCapabilityState["id"]; fields: FieldSpec[] }> = [
  { id: "meta", name: "Meta", product: "WhatsApp Business", mark: "whatsapp", fields: [
    { id: "clientId", label: tKey("App ID") },
    { id: "clientSecret", label: tKey("App secret"), secret: true },
    { id: "configId", label: tKey("Embedded Signup configuration ID") },
    { id: "webhookSecret", label: tKey("Webhook verify token"), secret: true },
    { id: "graphVersion", label: tKey("Graph API version"), placeholder: "v23.0" },
  ] },
  { id: "intuit", name: "Intuit", product: "QuickBooks", mark: "quickbooks", fields: [
    CLIENT_ID, CLIENT_SECRET,
    { id: "environment", label: tKey("Environment"), options: ENVIRONMENTS },
    { id: "webhookSecret", label: tKey("Webhook verifier token"), secret: true },
  ] },
  { id: "zoho", name: "Zoho", product: "Zoho Books", mark: "zoho_books", fields: [
    CLIENT_ID, CLIENT_SECRET, { id: "dataCenter", label: tKey("Data center"), options: ZOHO_DATA_CENTERS },
  ] },
  { id: "google", name: "Google", product: "Google Workspace", mark: "google_workspace", fields: [CLIENT_ID, CLIENT_SECRET] },
];
const PUBLIC_ADDRESS: FieldSpec = { id: "publicApiBase", label: tKey("Public API address"), placeholder: "https://api.example.com" };

const STATUS: Record<PlatformConnectionStatus, { label: MessageKey; tone: "neutral" | "info" | "success" | "danger" }> = {
  not_set: { label: tKey("Not set"), tone: "neutral" },
  set: { label: tKey("Set"), tone: "info" },
  tested_ok: { label: tKey("Tested OK"), tone: "success" },
  test_failed: { label: tKey("Test failed"), tone: "danger" },
};
const URL_LABELS = { callback: tKey("Callback URL"), webhook: tKey("Webhook URL") } as const;

/**
 * Wodana Control → Platform connections: Wodana's own app credentials for each provider firms connect to.
 * Secrets are write-only (set · last 4); Test runs a safe live check; the URLs are the ones to register in
 * each provider's console. Changes apply within a minute, with no restart.
 */
export function PlatformConnectionsPage() {
  const t = useT();
  const toast = useToast();
  const [connections, setConnections] = useState<PlatformConnection[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PlatformProvider | null>(null);
  const [testing, setTesting] = useState<Vendor | null>(null);

  const load = useCallback(async () => {
    try { setConnections((await platformConnectionsApi.list()).providers); setError(""); }
    catch (cause) { setError((cause as Error).message || t("Platform connections didn't load.")); }
  }, [t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const test = async (vendor: Vendor) => {
    setTesting(vendor);
    try {
      const answer = await platformConnectionsApi.test(vendor);
      setConnections(answer.providers);
      if (answer.result.ok) toast.push({ title: t("Tested OK"), message: VENDORS.find((item) => item.id === vendor)?.name ?? "", tone: "success" });
      else toast.push({ title: t("Test failed"), message: t(TEST_REASON_LABELS[answer.result.reason ?? ""] ?? tKey("The provider sent an unexpected answer.")), tone: "danger" });
    } catch (cause) {
      toast.push({ title: t("The check could not run."), message: translateKnown(t, (cause as Error).message || "Try again."), tone: "danger" });
    } finally { setTesting(null); }
  };

  if (error && !connections) return <div className={styles.page}><PageHeader title={t("Platform connections")} /><ErrorState description={error} onRetry={() => void load()} /></div>;
  if (!connections) return <div className={styles.page}><PageHeader title={t("Platform connections")} /><PageSkeleton /></div>;
  const byProvider = new Map(connections.map((item) => [item.provider, item]));
  const platform = byProvider.get("platform");
  const editingConnection = editing ? byProvider.get(editing) : undefined;
  return <div className={styles.page}>
    <PageHeader title={t("Platform connections")} />
    {platform ? <section aria-label={t("Public API address")} className={styles.addressRow}>
      <dl className={styles.properties}>
        <div><dt>{t("Public API address")}</dt><dd>{platform.values.publicApiBase
          ? <code className={styles.url}>{platform.values.publicApiBase}</code>
          : <span className={styles.muted}>{t("Not set")}</span>}</dd></div>
      </dl>
      <Button onPress={() => setEditing("platform")} size="compact">{t("Edit")}</Button>
    </section> : null}
    <div className={styles.connectionGrid}>{VENDORS.map((vendor) => {
      const connection = byProvider.get(vendor.id);
      if (!connection) return null;
      return <VendorCard connection={connection} isTesting={testing === vendor.id} key={vendor.id} onEdit={() => setEditing(vendor.id)}
        onTest={() => void test(vendor.id)} vendor={vendor} />;
    })}</div>
    {editing && editingConnection ? <CredentialsDialog connection={editingConnection} key={editing}
      fields={editing === "platform" ? [PUBLIC_ADDRESS] : VENDORS.find((vendor) => vendor.id === editing)!.fields}
      onClose={() => setEditing(null)} onReload={load}
      onSaved={(providers) => { setConnections(providers); setEditing(null); toast.push({ title: t("Saved"), message: editing === "platform" ? t("Public API address") : VENDORS.find((vendor) => vendor.id === editing)!.name, tone: "success" }); }}
      title={editing === "platform" ? t("Public API address") : VENDORS.find((vendor) => vendor.id === editing)!.name} /> : null}
  </div>;
}

function VendorCard({ connection, isTesting, onEdit, onTest, vendor }: {
  connection: PlatformConnection; isTesting: boolean; onEdit: () => void; onTest: () => void; vendor: typeof VENDORS[number];
}) {
  const t = useT();
  const format = useConsoleFormat();
  const toast = useToast();
  const status = STATUS[connection.status];
  const copy = (url: string) => {
    void navigator.clipboard.writeText(url)
      .then(() => toast.push({ title: t("Copied"), message: url, tone: "success" }))
      .catch(() => toast.push({ title: t("Couldn't copy"), message: url, tone: "danger" }));
  };
  return <Surface as="article" aria-label={vendor.name} className={styles.connectionCard} tone="raised">
    <header className={styles.connectionHead}>
      <span className={styles.connectionIcon}><ProviderMark provider={vendor.mark} /></span>
      <span className={styles.nameCell}><strong>{vendor.name}</strong><small>{vendor.product}</small></span>
      <Badge tone={status.tone}>{t(status.label)}</Badge>
    </header>
    {connection.test?.testedAt ? <p className={connection.status === "test_failed" ? styles.testFailed : styles.muted}>
      {connection.status === "test_failed"
        ? t(TEST_REASON_LABELS[connection.test.reason ?? ""] ?? tKey("The provider sent an unexpected answer."))
        : t("Tested {date}", { date: format.dateTime(connection.test.testedAt) })}
    </p> : null}
    <dl className={styles.record}>{vendor.fields.map((field) => <FieldValue connection={connection} field={field} key={field.id} />)}</dl>
    {connection.urls.length ? <ul className={styles.urlList} aria-label={t("URLs to register")}>{connection.urls.map((item) => <li key={item.url}>
      <span className={styles.nameCell}><small>{t(URL_LABELS[item.id])}</small><code className={styles.url}>{item.url}</code></span>
      <IconButton aria-label={t("Copy {label}", { label: t(URL_LABELS[item.id]) })} onPress={() => copy(item.url)} size="compact" variant="quiet">
        <Copy aria-hidden="true" size={14} />
      </IconButton>
    </li>)}</ul> : <p className={styles.muted}>{t("Set the public API address to see the URLs to register.")}</p>}
    <footer className={styles.actions}>
      <Button isLoading={isTesting} onPress={onTest} size="compact">{t("Test")}</Button>
      <Button onPress={onEdit} size="compact" variant="primary">{t("Edit")}</Button>
    </footer>
  </Surface>;
}

function FieldValue({ connection, field }: { connection: PlatformConnection; field: FieldSpec }) {
  const t = useT();
  if (field.secret) {
    const secret = connection.secrets[field.id as PlatformSecretField];
    return <><dt>{t(field.label)}</dt><dd>{secret?.set
      ? <span className={styles.secret} dir="ltr">{t("Set")} · ••••{secret.last4}</span>
      : <span className={styles.muted}>{t("Not set")}</span>}</dd></>;
  }
  const value = connection.values[field.id as PlatformValueField];
  const label = value && field.options ? field.options.find((option) => option.id === value)?.label : undefined;
  return <><dt>{t(field.label)}</dt><dd>{value
    ? label ? t(label) : <code>{value}</code>
    : <span className={styles.muted}>{t("Not set")}</span>}</dd></>;
}

function CredentialsDialog({ connection, fields, onClose, onReload, onSaved, title }: {
  connection: PlatformConnection; fields: FieldSpec[]; onClose: () => void; onReload: () => Promise<void>;
  onSaved: (providers: PlatformConnection[]) => void; title: string;
}) {
  const t = useT();
  const initial = useCallback(() => Object.fromEntries(fields.map((field) =>
    [field.id, field.secret ? "" : connection.values[field.id as PlatformValueField] ?? ""])) as Record<string, string>, [connection, fields]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  // One key per content: a retried save of the same values lands once; a changed form is a new request.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const change = (id: string, value: string) => { setValues((current) => ({ ...current, [id]: value })); setRequestKey(crypto.randomUUID()); };
  const required = new Set(connection.required);
  const dirty = fields.some((field) => field.secret ? Boolean(values[field.id]) : (values[field.id] ?? "") !== (connection.values[field.id as PlatformValueField] ?? ""));
  return <FormDialog conflict={{
    onReload: async () => { await onReload(); setValues(initial()); },
    onKeepMine: async () => { await onReload(); },
  }} isDirty={dirty} onClose={onClose} size="md" submitLabel={t("Save")} title={title} onSubmit={async () => {
    const body: PlatformConnectionSave = { expectedVersion: connection.version };
    for (const field of fields) {
      const value = (values[field.id] ?? "").trim();
      if (field.secret) { if (value) body[field.id] = value; }
      else body[field.id] = value || null;
    }
    const saved = await platformConnectionsApi.save(connection.provider, body, requestKey);
    onSaved(saved.providers);
  }}>
    {fields.map((field) => {
      if (field.options) {
        return <SelectField isRequired={required.has(field.id)} items={field.options.map((option) => ({ id: option.id, label: t(option.label) }))} key={field.id}
          label={t(field.label)} onSelectionChange={(key) => key && change(field.id, String(key))} selectedKey={values[field.id] || null} />;
      }
      const secret = field.secret ? connection.secrets[field.id as PlatformSecretField] : undefined;
      return <TextInput autoComplete="off" description={secret?.set ? t("Saved · ends in {last4}. Leave blank to keep it.", { last4: secret.last4 ?? "" }) : undefined}
        inputType={field.secret ? "password" : "text"} isRequired={required.has(field.id) && !secret?.set} key={field.id} label={t(field.label)}
        onChange={(value) => change(field.id, value)} placeholder={field.placeholder} value={values[field.id] ?? ""} />;
    })}
  </FormDialog>;
}
