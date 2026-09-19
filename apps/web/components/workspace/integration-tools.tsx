"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Callout, ControlledModalDialog, Form, NumericInput, SelectField, Switch, TextAreaField, TextInput } from "@/design-system";
import type { IntegrationConnection } from "@/lib/workspace/integrations";
import styles from "./integration-tools.module.css";
import { templateBody, type MetaTemplate } from "@/lib/crm/whatsapp-templates";

type RecordRow = Record<string, unknown>;
type Result = { eventId?: string; htmlLink?: string; items?: RecordRow[]; calendars?: RecordRow[]; connectionVersion?: number; hasMore?: boolean; truncated?: boolean; paymentUrl?: string | null; url?: string; id?: string; status?: string; balance?: number; total?: number; currency?: string; message?: string };
const accountingActions = [
  { id: "invoices", label: "Invoices and payment links" }, { id: "invoice.create", label: "Create an invoice" },
  { id: "customers", label: "Customers" }, { id: "vendors", label: "Vendors" },
  { id: "bills", label: "Vendor bills" }, { id: "purchaseorders", label: "Purchase orders" },
  { id: "expenses", label: "Expenses" }, { id: "payments", label: "Recorded payments" },
];
const noopHealthChange = () => undefined;

export function IntegrationTools(props: { connection: IntegrationConnection | null; workspaceId: string; canManage: boolean; onClose: () => void; onHealthChange?: (connectionId: string, status: "connected" | "degraded", errorCode?: string) => void }) {
  if (!props.connection) return null;
  return <ConnectedTools key={props.connection.id} {...props} connection={props.connection} onHealthChange={props.onHealthChange ?? noopHealthChange} />;
}

function ConnectedTools({ connection, workspaceId, canManage, onClose, onHealthChange }: { connection: IntegrationConnection; workspaceId: string; canManage: boolean; onClose: () => void; onHealthChange: (connectionId: string, status: "connected" | "degraded", errorCode?: string) => void }) {
  const google = connection.provider === "google_workspace";
  const whatsapp = connection.provider === "whatsapp";
  const actions = google ? [{ id: "calendars", label: "Choose calendars" }, { id: "calendar.create", label: "Schedule a meeting or site visit" }, { id: "email.send", label: "Send an email" }, { id: "document.create", label: "Create a Drive document" }]
    : whatsapp ? [{ id: "templates", label: "Approved message templates" }, { id: "message.send", label: "Send a template message" }, { id: "events", label: "Replies and delivery updates" }] : accountingActions;
  const [action, setAction] = useState(actions[0].id);
  const [fields, setFields] = useState<Record<string, string>>({ quantity: "1", rate: "0", currency: String(connection.configuration?.currency ?? "AED"), date: new Date().toISOString().slice(0, 10), language: "en_US", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const [whatsappTemplates, setWhatsappTemplates] = useState<MetaTemplate[]>([]);
  const selectedTemplate = whatsappTemplates.find(item => `${item.id}/${item.language}` === fields.templateId);
  const bodyVariableCount = new Set(templateBody(selectedTemplate ?? { id: "", name: "", language: "", status: "" }).match(/\{\{[^}]+\}\}/g) ?? []).size;
  const dynamicUrl = selectedTemplate?.components?.some(component => component.buttons?.some(button => button.url?.includes("{{")));
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [onlinePayment, setOnlinePayment] = useState(false);
  const [optIn, setOptIn] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [page, setPage] = useState(1);
  const [calendarVersion, setCalendarVersion] = useState(connection.version);
  const [selectedCalendars, setSelectedCalendars] = useState<Record<string, boolean>>({});
  const [customers, setCustomers] = useState<RecordRow[]>([]);
  const [items, setItems] = useState<RecordRow[]>([]);
  const [calendarChoices, setCalendarChoices] = useState<RecordRow[]>([]);
  const base = `/api/workspace/integration-connections/${connection.id}/tools`;
  const isWrite = action.includes(".");
  const set = (name: string, value: string) => { setFields((previous) => ({ ...previous, [name]: value })); setKey(crypto.randomUUID()); setResult(null); };
  async function request(kind: string, body?: unknown): Promise<Result> {
    const response = await fetch(body ? base : `${base}?${new URLSearchParams({ workspaceId, ...Object.fromEntries(new URLSearchParams(kind)) })}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    const payload = await response.json() as Result;
    if (!response.ok) {
      onHealthChange(connection.id, "degraded", "provider_request_failed");
      throw new Error(payload.message ?? "Provider action failed.");
    }
    onHealthChange(connection.id, "connected");
    return payload;
  }
  async function run(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Provider action failed."); } finally { setBusy(false); }
  }
  async function load(resource = action, requestedPage = 1) {
    const data = await request(`kind=${resource}&page=${requestedPage}`);
    setRows(data.items ?? data.calendars ?? []); setResult(data); setPage(requestedPage);
    if (resource === "templates") setWhatsappTemplates((data.items ?? []) as unknown as MetaTemplate[]);
    if (data.calendars) { setCalendarVersion(data.connectionVersion ?? connection.version); setSelectedCalendars(Object.fromEntries(data.calendars.map((calendar) => [String(calendar.resourceId), calendar.enabled === true]))); }
  }
  useEffect(() => {
    if (!whatsapp || action !== "templates") return;
    let cancelled = false;
    setBusy(true); setError("");
    void fetch(`${base}?${new URLSearchParams({ workspaceId, kind: "templates" })}`).then(async response => {
      const data = await response.json();
      if (!response.ok) {
        onHealthChange(connection.id, "degraded", "provider_request_failed");
        throw new Error(data.message ?? "WhatsApp templates could not be loaded.");
      }
      if (!cancelled) { onHealthChange(connection.id, "connected"); setWhatsappTemplates(data.items ?? []); setRows(data.items ?? []); setResult(data); }
    }).catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [base, workspaceId, whatsapp, action, connection.id, onHealthChange]);
  const input = (name: string, label: string, type: "text" | "email" | "tel" | "date" | "datetime-local" | "number" = "text", required = true) => type === "number"
    ? <NumericInput isRequired={required} key={name} label={label} onChange={(value) => set(name, String(value))} value={Number(fields[name] ?? 0)} />
    : <TextInput inputType={type} isRequired={required} key={name} label={label} onChange={(value) => set(name, value)} value={fields[name] ?? ""} />;
  const rowId = (row: RecordRow) => String(row.Id ?? row.invoice_id ?? row.contact_id ?? row.item_id ?? row.id ?? row.name ?? "");
  const rowName = (row: RecordRow) => String(row.DisplayName ?? row.contact_name ?? row.customer_name ?? row.Name ?? row.name ?? row.invoice_number ?? row.DocNumber ?? rowId(row));
  const options = (records: RecordRow[]) => records.map((row) => ({ id: rowId(row), label: rowName(row) }));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      let payload: Record<string, unknown> = {};
      if (action === "email.send") payload = { to: fields.to, subject: fields.subject, body: fields.body };
      if (action === "document.create") payload = { name: fields.name, content: fields.body, ...(fields.folderId ? { folderId: fields.folderId } : {}) };
      if (action === "message.send" && (!selectedTemplate || selectedTemplate.category === "AUTHENTICATION")) throw new Error("Choose an approved business template.");
      if (action === "message.send" && bodyVariableCount && (fields.parameters ?? "").split("\n").filter(value => value.trim()).length !== bodyVariableCount) throw new Error(`Enter all ${bodyVariableCount} template values, one per line.`);
      if (action === "message.send" && dynamicUrl && !fields.urlParameter?.trim()) throw new Error("Enter the button link value.");
      if (action === "message.send") payload = { to: fields.to, templateName: fields.templateName, language: fields.language,
        bodyParameters: fields.parameters ? fields.parameters.split("\n") : [], ...(fields.urlParameter ? { urlParameter: fields.urlParameter } : {}), optInConfirmed: optIn };
      if (action === "invoice.create") payload = { customerId: fields.customerId, date: fields.date, dueDate: fields.dueDate, currency: fields.currency, reference: fields.reference, onlinePayment,
        lines: [{ itemId: fields.itemId, description: fields.description, quantity: fields.quantity, rate: fields.rate, ...(fields.taxId ? { taxId: fields.taxId } : {}) }] };
      if (action === "calendar.create") payload = { calendarId: fields.calendarId, summary: fields.subject, description: fields.body || undefined, start: new Date(fields.start).toISOString(), end: new Date(fields.end).toISOString(), timeZone: fields.timeZone, attendeeEmails: [], sendUpdates: "none" };
      const data = await request("", { workspaceId, action, idempotencyKey: key, payload });
      setResult(data.eventId ? { ...data, id: data.eventId, url: data.htmlLink } : data);
    });
  }
  return <ControlledModalDialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={connection.displayName} description="Use this organization’s connected account. Provider actions are recorded in the workspace audit log." footer={<Button onPress={onClose}>Close</Button>}>
    <div className={styles.tools}>
      <SelectField isDisabled={busy} label="What would you like to do?" selectedKey={action} items={actions} onSelectionChange={(value) => { if (!value) return; setAction(String(value)); setRows([]); setResult(null); setError(""); setKey(crypto.randomUUID()); }} />
      {error ? <Callout title="Action needs attention" tone="danger">{error}</Callout> : null}
      {result?.truncated ? <p>Showing approved templates from the first 100 results. Review remaining templates in Meta.</p> : null}
      {result?.id ? <Callout title={result.status === "accepted" ? "Accepted by provider" : "Provider result"} tone="success">{result.id}{result.status ? ` · ${result.status}` : ""}{result.balance !== undefined ? ` · Balance ${result.currency ?? ""} ${result.balance}` : ""}</Callout> : null}
      {result?.paymentUrl ? <div className={styles.actions}><a href={result.paymentUrl} target="_blank" rel="noreferrer">Open invoice payment page</a><Button onPress={() => void navigator.clipboard.writeText(result.paymentUrl!)}>Copy payment link</Button></div> : null}
      {result?.url ? <a href={result.url} target="_blank" rel="noreferrer">Open in Google</a> : null}
      {result?.id && "paymentUrl" in result && !result.paymentUrl ? <p>This provider did not return an online payment link. Check online payment activation for this company.</p> : null}
      {!isWrite ? <>
        <Button isLoading={busy} onPress={() => void run(() => load())}>{whatsapp && action === "templates" ? "Refresh templates" : "Load from provider"}</Button>
        {rows.length ? <div className={styles.records}>{rows.map((row, index) => <div key={`${rowId(row)}-${index}`} className={styles.row}>
          <div><strong>{rowName(row)}</strong><small>{rowId(row)}{row.status ? ` · ${String(row.status)}` : ""}{row.Balance !== undefined || row.balance !== undefined ? ` · Balance ${row.Balance ?? row.balance}` : ""}</small></div>
          {action === "invoices" ? <Button isDisabled={busy} onPress={() => void run(async () => setResult(await request(`kind=invoice&invoiceId=${encodeURIComponent(rowId(row))}`)))}>Refresh payment status</Button> : null}
          {action === "calendars" ? <Switch isDisabled={!canManage} isSelected={Boolean(selectedCalendars[String(row.resourceId)])} onChange={(checked) => setSelectedCalendars((current) => ({ ...current, [String(row.resourceId)]: checked }))}>{String(row.displayName)}</Switch> : null}
          {action === "templates" ? <div className={styles.templateDetails}><small>{String(row.language ?? "")} · {String(row.category ?? "")}</small><p>{templateBody(row as unknown as MetaTemplate)}</p>{row.category === "AUTHENTICATION" ? <small>Used automatically for secure portal login.</small> : null}</div> : null}
          {action === "events" ? <EventDetails changes={row.changes} /> : null}
        </div>)}</div> : result?.items ? <p>No records returned.</p> : null}
        {action === "calendars" && rows.length ? <Button isDisabled={!canManage || busy} onPress={() => void run(async () => {
          await request("", { workspaceId, action: "calendars.select", payload: { version: calendarVersion, resources: rows.map((row) => ({ resourceId: row.resourceId, enabled: Boolean(selectedCalendars[String(row.resourceId)]), direction: ["owner", "writer"].includes(String(row.accessRole)) ? "bidirectional" : "inbound" })) } });
          await load("calendars");
        })}>Save selected calendars</Button> : null}
        {result?.hasMore ? <Button isDisabled={busy} onPress={() => void run(() => load(action, page + 1))}>Next page</Button> : null}
      </> : <Form className={styles.form} onSubmit={(event) => void submit(event)}>
        {action === "invoice.create" ? <>
          <Button isDisabled={busy} onPress={() => void run(async () => { const [customerData, itemData] = await Promise.all([request("kind=customers"), request("kind=items")]); setCustomers(customerData.items ?? []); setItems(itemData.items ?? []); })}>Load customers and items</Button>
          <SelectField label="Customer" isRequired items={options(customers)} selectedKey={fields.customerId ?? null} onSelectionChange={(value) => value && set("customerId", String(value))} />
          <SelectField label="Item or service" isRequired items={options(items)} selectedKey={fields.itemId ?? null} onSelectionChange={(value) => value && set("itemId", String(value))} />
          {input("reference", "Project or milestone reference")}{input("description", "Invoice description")}
          <div className={styles.columns}>{input("quantity", "Quantity", "number")}{input("rate", "Unit rate", "number")}{input("currency", "Currency code")}</div>
          <div className={styles.columns}>{input("date", "Invoice date", "date")}{input("dueDate", "Due date", "date")}</div>
          {input("taxId", "Provider tax code (optional)", "text", false)}
          {connection.provider === "quickbooks" ? <Switch isSelected={onlinePayment} onChange={(value) => { setOnlinePayment(value); setKey(crypto.randomUUID()); }}>Enable card and bank payments (requires QuickBooks Payments)</Switch> : null}
          <p>This creates one invoice in the selected company. Choose the tax code configured by its accountant. Load invoices afterward to retrieve its payment page.</p>
        </> : null}
        {action === "email.send" ? <>{input("to", "Recipient email", "email")}{input("subject", "Subject")}</> : null}
        {action === "document.create" ? <>{input("name", "Document name")}{input("folderId", "Drive folder ID (optional)", "text", false)}<p>Creates a private text document. This connection can access files created or explicitly shared with Wodana.</p></> : null}
        {action === "calendar.create" ? <>
          <Button onPress={() => void run(async () => { const data = await request("kind=calendars"); setCalendarChoices((data.calendars ?? []).filter((row) => row.enabled && ["owner", "writer"].includes(String(row.accessRole)))); })}>Load selected calendars</Button>
          <SelectField label="Calendar" isRequired items={calendarChoices.map((row) => ({ id: String(row.externalId), label: String(row.displayName) }))} selectedKey={fields.calendarId ?? null} onSelectionChange={(value) => value && set("calendarId", String(value))} />
          {input("subject", "Meeting or visit title")}{input("start", "Starts (your local time)", "datetime-local")}{input("end", "Ends (your local time)", "datetime-local")}
        </> : null}
        {["email.send", "document.create", "calendar.create"].includes(action) ? <TextAreaField isRequired={action !== "calendar.create"} label={action === "document.create" ? "Document content" : "Message or notes"} onChange={(value) => set("body", value)} value={fields.body ?? ""} /> : null}
        {action === "message.send" ? <>
          {input("to", "Recipient phone (with country code)", "tel")}
          <SelectField label="Approved business template" isRequired selectedKey={fields.templateId ?? null} items={whatsappTemplates.filter(item => item.status === "APPROVED" && item.category !== "AUTHENTICATION").map(item => ({ id: `${item.id}/${item.language}`, label: `${item.name.replaceAll("_", " ")} · ${item.language}` }))} onSelectionChange={value => {
            const chosen = whatsappTemplates.find(item => `${item.id}/${item.language}` === value);
            if (chosen) { setFields(previous => ({ ...previous, templateId: String(value), templateName: chosen.name, language: chosen.language, parameters: "", urlParameter: "" })); setKey(crypto.randomUUID()); setResult(null); }
          }} />
          {selectedTemplate ? <p className={styles.templatePreview}>{templateBody(selectedTemplate)}</p> : <p>Choose from this account’s approved templates. Login codes are sent automatically by the portal.</p>}
          {bodyVariableCount ? <TextAreaField isRequired label={`Template values (${bodyVariableCount}, one per line)`} onChange={(value) => set("parameters", value)} value={fields.parameters ?? ""} /> : null}
          {dynamicUrl ? input("urlParameter", "Button link value") : null}
          <Switch isSelected={optIn} onChange={(checked) => { setOptIn(checked); setKey(crypto.randomUUID()); }}>The recipient has opted in to messages from this business</Switch>
          <p>Use an approved template from this account. Provider acceptance appears first; delivery and read receipts arrive in Replies and delivery updates.</p>
        </> : null}
        <Button type="submit" variant="primary" isDisabled={!canManage || Boolean(result?.id) || (action === "message.send" && (!optIn || !selectedTemplate))} isLoading={busy}>{action.endsWith("send") ? "Send message" : action === "invoice.create" ? "Create invoice" : action === "calendar.create" ? "Schedule event" : "Create document"}</Button>
      </Form>}
    </div>
  </ControlledModalDialog>;
}


function EventDetails({ changes }: { changes: unknown }) {
  if (!Array.isArray(changes)) return <p>Accounting records changed. Refresh the affected invoice to verify its current balance.</p>;
  return <div>{changes.flatMap((change: { value?: { messages?: Array<{ id: string; from: string; type: string; text?: { body: string } }>; statuses?: Array<{ id: string; recipient_id: string; status: string }> } }) => [
    ...(change.value?.messages ?? []).map((message) => <p key={message.id}><strong>{message.from}</strong>: {message.text?.body ?? `Incoming ${message.type} message`}</p>),
    ...(change.value?.statuses ?? []).map((status) => <p key={`${status.id}-${status.status}`}><strong>{status.recipient_id}</strong>: {status.status}</p>),
  ])}</div>;
}
