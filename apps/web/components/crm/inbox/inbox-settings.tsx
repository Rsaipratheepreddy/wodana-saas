"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import { Badge, Button, Checkbox, ControlledModalDialog, DataGrid, InlineNotice, NoAccessState, SelectField, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextAreaField, TextInput, type DataGridColumn } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { fillTemplate, LABEL_COLORS, renderTemplate, TEMPLATE_SOURCE_LABELS, TEMPLATE_SOURCES, type InboxLabel, type InboxTemplate, type LabelColor, type QuickReply, type TemplateSource } from "@/lib/crm/inbox";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { AutoRepliesSection } from "./auto-replies-settings";
import { ClientMessagesSection } from "./client-messages-settings";
import { LabelChip, useInboxLookups } from "./inbox-parts";
import styles from "./inbox-parts.module.css";

/**
 * Settings → Inbox: the one number every seat replies from, how new chats are assigned, the optional
 * signature, and the workspace's labels, quick replies and WhatsApp template variables.
 */
export function InboxSettingsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { labels, quickReplies, settings, templates, failure: loadFailure, reload } = useInboxLookups(workspaceId);
  const [draft, setDraft] = useState<{ autoAssign: boolean; queueId: string | null; signatureEnabled: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(""), [notice, setNotice] = useState("");
  const [editingLabel, setEditingLabel] = useState<Partial<InboxLabel> | null>(null);
  const [editingReply, setEditingReply] = useState<Partial<QuickReply> | null>(null);
  const [mapping, setMapping] = useState<InboxTemplate | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => { if (settings) setDraft({ autoAssign: settings.autoAssign, queueId: settings.queueId, signatureEnabled: settings.signatureEnabled }); }, [settings]);

  if (!settings && !loadFailure) return <SettingsPage title={t("Inbox")}><Skeleton lines={5} shape="form" /></SettingsPage>;
  if (!settings) return <SettingsPage title={t("Inbox")}><NoAccessState area={t("Inbox")} /></SettingsPage>;
  const canManage = settings.canManage;
  const run = async (work: () => Promise<unknown>, success: string) => {
    setFailure(""); setNotice("");
    try { await work(); setNotice(success); await reload(); return true; }
    catch (error) { setFailure(error instanceof Error ? error.message : t("Inbox settings could not be saved.")); return false; }
  };
  const changed = draft && (draft.autoAssign !== settings.autoAssign || draft.queueId !== settings.queueId || draft.signatureEnabled !== settings.signatureEnabled);

  const labelColumns: DataGridColumn<InboxLabel>[] = [
    { accessorKey: "name", header: t("Label"), size: 240, cell: ({ row: { original } }) => <LabelChip label={original} /> },
    { accessorKey: "openChats", header: t("Open chats"), size: 120 },
    { accessorKey: "status", header: t("Status"), size: 110, cell: ({ row: { original } }) => <Badge tone={original.status === "archived" ? "neutral" : "success"}>{original.status === "archived" ? t("Archived") : t("Active")}</Badge> },
    ...(canManage ? [{ id: "actions", header: "", size: 170, enableSorting: false, cell: ({ row: { original } }: { row: { original: InboxLabel } }) => <span className={styles.rowActions}>
      <Button size="compact" variant="secondary" onPress={() => setEditingLabel(original)}><Pencil aria-hidden="true" size={13} />{t("Edit")}</Button>
      <Button size="compact" variant="quiet" aria-label={`${original.status === "archived" ? t("Restore") : t("Archive")} ${original.name}`} onPress={() => void run(() => crmRequest(workspaceId, `inbox/labels/${original.id}`, "PATCH", { version: original.version, status: original.status === "archived" ? "active" : "archived" }), original.status === "archived" ? t("Label restored.") : t("Label archived."))}>{original.status === "archived" ? <RotateCcw aria-hidden="true" size={13} /> : <Archive aria-hidden="true" size={13} />}</Button>
    </span> } as DataGridColumn<InboxLabel>] : []),
  ];
  const replyColumns: DataGridColumn<QuickReply>[] = [
    { accessorKey: "shortcut", header: t("Shortcut"), size: 160, cell: ({ row: { original } }) => <strong>/{original.shortcut}</strong> },
    { accessorKey: "body", header: t("Reply"), size: 360, enableSorting: false, cell: ({ row: { original } }) => <span className={styles.name}><small>{original.body}</small></span> },
    { accessorKey: "scope", header: t("For"), size: 120, cell: ({ row: { original } }) => original.scope === "workspace" ? t("Everyone") : t("Only me") },
    { id: "actions", header: "", size: 170, enableSorting: false, cell: ({ row: { original } }) => original.canEdit ? <span className={styles.rowActions}>
      <Button size="compact" variant="secondary" onPress={() => setEditingReply(original)}><Pencil aria-hidden="true" size={13} />{t("Edit")}</Button>
      <Button size="compact" variant="quiet" aria-label={`${original.status === "archived" ? t("Restore") : t("Archive")} /${original.shortcut}`} onPress={() => void run(() => crmRequest(workspaceId, `inbox/quick-replies/${original.id}`, "PATCH", { version: original.version, status: original.status === "archived" ? "active" : "archived" }), original.status === "archived" ? t("Quick reply restored.") : t("Quick reply archived."))}>{original.status === "archived" ? <RotateCcw aria-hidden="true" size={13} /> : <Archive aria-hidden="true" size={13} />}</Button>
    </span> : null },
  ];
  const templateColumns: DataGridColumn<InboxTemplate>[] = [
    { accessorKey: "code", header: t("Template"), size: 240, cell: ({ row: { original } }) => <span className={styles.name}><strong>{original.code}</strong><small>{original.body}</small>{original.providerReason ? <small className={styles.reason}>{original.providerReason}</small> : null}</span> },
    { accessorKey: "locale", header: t("Language"), size: 100 },
    { accessorKey: "category", header: t("Category"), size: 110, cell: ({ row: { original } }) => original.category ? t(CATEGORY_LABELS[original.category] ?? "Utility") : "" },
    { accessorKey: "providerStatus", header: t("Status"), size: 150, cell: ({ row: { original } }) => { const status = TEMPLATE_STATUS[original.providerStatus ?? "approved"]; return <Badge tone={status.tone}>{t(status.label)}</Badge>; } },
    { id: "variables", header: t("Variables"), size: 170, accessorFn: (template) => template.positions.length, cell: ({ row: { original } }) => !original.positions.length ? t("None") : !original.usable ? <Badge tone="warning">{t("Not numbered 1, 2, 3…")}</Badge>
      : original.positions.every((position) => original.variables.some((variable) => variable.position === position)) ? <Badge tone="success">{t("{count} mapped", { count: original.positions.length })}</Badge> : <Badge tone="warning">{t("Needs mapping")}</Badge> },
    ...(canManage ? [{ id: "actions", header: "", size: 130, enableSorting: false, cell: ({ row: { original } }: { row: { original: InboxTemplate } }) => original.positions.length && original.usable ? <Button size="compact" variant="secondary" onPress={() => setMapping(original)}>{t("Map variables")}</Button> : null } as DataGridColumn<InboxTemplate>] : []),
  ];

  return <SettingsPage title={t("Inbox")} width="wide">
    <div className={styles.page}>
      {failure || loadFailure ? <InlineNotice message={failure || loadFailure} tone="error" /> : null}
      {notice ? <InlineNotice message={notice} tone="success" /> : null}
      <SettingsSection id="inbox-number" title={t("WhatsApp number")}>
        <SettingsRow label={t("Replying as")} hint={settings.whatsapp.connected ? t("All {count} seats reply from this number. Clients see the business, not the person.", { count: settings.seats }) : undefined}>
          {settings.whatsapp.connected ? <strong>{[settings.businessName, settings.whatsapp.number].filter(Boolean).join(" · ")}</strong> : <Link href="/workspace/integrations">{t("Connect WhatsApp")}</Link>}
        </SettingsRow>
        {settings.whatsapp.connected ? <SettingsRow label={t("Number health")} hint={[settings.whatsapp.quality ? t("Quality {value}", { value: settings.whatsapp.quality.toLowerCase() }) : null, settings.whatsapp.limit ? t("Limit {value}", { value: settings.whatsapp.limit.replace(/_/g, " ").toLowerCase() }) : null].filter(Boolean).join(" · ") || undefined}>
          <Badge tone={settings.whatsapp.health === "blocked" ? "danger" : settings.whatsapp.health === "limited" ? "warning" : "success"}>{settings.whatsapp.health === "blocked" ? t("Blocked by Meta") : settings.whatsapp.health === "limited" ? t("Limited by Meta") : t("Can send")}</Badge>
        </SettingsRow> : null}
        <SettingsRow label={t("Signature")} hint={t("Adds “— first name” under each reply.")}>
          <Switch isDisabled={!canManage || !draft} isSelected={Boolean(draft?.signatureEnabled)} onChange={(value) => setDraft((current) => current && { ...current, signatureEnabled: value })}>{t("Sign replies")}</Switch>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection id="inbox-assignment" title={t("New chats")}
        actions={canManage ? <Button size="compact" variant="primary" isDisabled={!changed} isLoading={saving} onPress={async () => {
          if (!draft) return; setSaving(true);
          await run(() => crmRequest(workspaceId, "inbox/settings", "PUT", { version: settings.version, ...draft }), t("Inbox settings saved."));
          setSaving(false);
        }}>{t("Save")}</Button> : null}>
        <SettingsRow label={t("Assign automatically")} hint={t("To whoever already looks after the client, else the next person in the queue.")}>
          <Switch isDisabled={!canManage || !draft} isSelected={Boolean(draft?.autoAssign)} onChange={(value) => setDraft((current) => current && { ...current, autoAssign: value })}>{draft?.autoAssign ? t("On") : t("Off")}</Switch>
        </SettingsRow>
        <SettingsRow label={t("Queue")}>
          <span className={styles.inline}><SelectField aria-label={t("Queue")} label={null} isDisabled={!canManage || !draft?.autoAssign}
            items={[{ id: "", label: t("Sales fallback queue") }, ...settings.queues.map((queue) => ({ id: queue.id, label: queue.name }))]}
            selectedKey={draft?.queueId ?? ""} onSelectionChange={(key) => setDraft((current) => current && { ...current, queueId: key ? String(key) : null })} /></span>
        </SettingsRow>
      </SettingsSection>
      <AutoRepliesSection workspaceId={workspaceId} />
      <ClientMessagesSection workspaceId={workspaceId} canManage={canManage} templates={templates} />
      <SettingsSection id="inbox-labels" title={t("Labels")} actions={canManage ? <Button size="compact" variant="primary" onPress={() => setEditingLabel({ color: "viz-1" })}><Plus aria-hidden="true" size={14} />{t("Add label")}</Button> : null}>
        <div data-sales-grid><DataGrid ariaLabel={t("Labels")} columns={labelColumns} data={labels} emptyTitle={t("No labels yet")} emptyDescription={t("Add labels such as Quote request or Site visit.")} getRowId={(label) => label.id} rowNumbers={false} selectable={false} showToolbar={false} /></div>
      </SettingsSection>
      <SettingsSection id="inbox-quick-replies" title={t("Quick replies")} actions={<Button size="compact" variant="primary" onPress={() => setEditingReply({ scope: canManage ? "workspace" : "personal" })}><Plus aria-hidden="true" size={14} />{t("Add quick reply")}</Button>}>
        <div data-sales-grid><DataGrid ariaLabel={t("Quick replies")} columns={replyColumns} data={quickReplies} emptyTitle={t("No quick replies yet")} emptyDescription={t("Type / in a chat to use them.")} getRowId={(reply) => reply.id} rowNumbers={false} selectable={false} showToolbar={false} /></div>
      </SettingsSection>
      <SettingsSection id="inbox-templates" title={t("WhatsApp templates")} actions={canManage && settings.whatsapp.connected ? <Button size="compact" variant="primary" onPress={() => setStarting(true)}><Plus aria-hidden="true" size={14} />{t("Add starter templates")}</Button> : null}>
        <div data-sales-grid><DataGrid ariaLabel={t("WhatsApp templates")} columns={templateColumns} data={templates} emptyTitle={t("No templates yet")} emptyDescription={settings.whatsapp.connected ? t("Add the starter templates: one for each client message.") : t("Connect WhatsApp first.")} getRowId={(template) => template.id} rowNumbers={false} selectable={false} showToolbar={false} /></div>
      </SettingsSection>
    </div>
    {editingLabel ? <LabelDialog initial={editingLabel} onClose={() => setEditingLabel(null)} onSave={async (value) => {
      const saved = await run(() => value.id ? crmRequest(workspaceId, `inbox/labels/${value.id}`, "PATCH", { version: value.version, name: value.name, color: value.color }) : crmRequest(workspaceId, "inbox/labels", "POST", { name: value.name, color: value.color }), t("Label saved."));
      if (saved) setEditingLabel(null);
    }} /> : null}
    {editingReply ? <QuickReplyDialog initial={editingReply} canShare={canManage} onClose={() => setEditingReply(null)} onSave={async (value) => {
      const saved = await run(() => value.id ? crmRequest(workspaceId, `inbox/quick-replies/${value.id}`, "PATCH", { version: value.version, shortcut: value.shortcut, body: value.body }) : crmRequest(workspaceId, "inbox/quick-replies", "POST", { shortcut: value.shortcut, body: value.body, scope: value.scope }), t("Quick reply saved."));
      if (saved) setEditingReply(null);
    }} /> : null}
    {mapping ? <TemplateVariablesDialog template={mapping} onClose={() => setMapping(null)} onSave={async (variables) => {
      const saved = await run(() => crmRequest(workspaceId, `inbox/templates/${mapping.id}/variables`, "PUT", { version: mapping.mappingVersion, variables }), t("Template variables saved."));
      if (saved) setMapping(null);
    }} /> : null}
    {starting ? <StarterPackDialog workspaceId={workspaceId} onClose={() => setStarting(false)} onSubmit={async (languages) => {
      const saved = await run(() => crmRequest(workspaceId, "inbox/starter-pack", "POST", { languages }), t("Starter templates sent to Meta for review."));
      if (saved) setStarting(false);
    }} /> : null}
  </SettingsPage>;
}

const TEMPLATE_STATUS: Record<NonNullable<InboxTemplate["providerStatus"]>, { label: MessageKey; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  submitting: { label: tKey("Sending to Meta"), tone: "info" }, pending: { label: tKey("Waiting for Meta approval"), tone: "warning" },
  approved: { label: tKey("Approved"), tone: "success" }, rejected: { label: tKey("Rejected"), tone: "danger" },
  paused: { label: tKey("Paused by Meta"), tone: "warning" }, disabled: { label: tKey("Disabled by Meta"), tone: "danger" },
};
const CATEGORY_LABELS: Record<string, MessageKey> = { utility: tKey("Utility"), marketing: tKey("Marketing"), authentication: tKey("Authentication") };

type StarterPack = { languages: string[]; defaultLanguages: string[]; items: Array<{ key: string; event: string; name: string; language: string; body: string; status: string | null }> };

/** One confirm adds a template for every client message in the chosen languages; the worker submits them to Meta. */
function StarterPackDialog({ workspaceId, onClose, onSubmit }: { workspaceId: string; onClose: () => void; onSubmit: (languages: string[]) => Promise<void> }) {
  const t = useT();
  const [pack, setPack] = useState<StarterPack | null>(null);
  const [languages, setLanguages] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    void crmRequest<StarterPack>(workspaceId, "inbox/starter-pack").then((next) => { setPack(next); setLanguages(new Set(next.defaultLanguages)); }).catch((reason: Error) => setError(reason.message));
  }, [workspaceId]);
  const names: Record<string, string> = { en: "English", ar: "العربية" };
  const missing = pack?.items.filter((item) => languages.has(item.language) && !item.status) ?? [];
  return <ControlledModalDialog isOpen size="lg" title={t("Starter templates")} onOpenChange={(open) => { if (!open && !saving) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>{t("Cancel")}</Button><Button variant="primary" isLoading={saving} isDisabled={!missing.length}
      onPress={async () => { setSaving(true); await onSubmit([...languages]); setSaving(false); }}>{missing.length ? t("Send {count} to Meta", { count: missing.length }) : t("Nothing to add")}</Button></div>}>
    <div className={styles.form}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {!pack && !error ? <Skeleton lines={5} /> : null}
      {pack ? <>
        <div className={styles.inline} role="group" aria-label={t("Languages")}>{pack.languages.map((language) => <Checkbox key={language} isSelected={languages.has(language)} onChange={(value) => setLanguages((current) => { const next = new Set(current); if (value) next.add(language); else next.delete(language); return next; })}>{names[language] ?? language}</Checkbox>)}</div>
        <ul className={styles.starterList}>{pack.items.filter((item) => languages.has(item.language)).map((item) => <li key={`${item.name}:${item.language}`}>
          <span className={styles.name}><strong>{item.name}</strong><small dir="auto">{item.body}</small></span>
          {item.status ? <Badge tone={TEMPLATE_STATUS[item.status as keyof typeof TEMPLATE_STATUS]?.tone ?? "neutral"}>{t(TEMPLATE_STATUS[item.status as keyof typeof TEMPLATE_STATUS]?.label ?? "Added")}</Badge> : <Badge tone="neutral">{names[item.language] ?? item.language}</Badge>}
        </li>)}</ul>
      </> : null}
    </div>
  </ControlledModalDialog>;
}

function LabelDialog({ initial, onClose, onSave }: { initial: Partial<InboxLabel>; onClose: () => void; onSave: (value: Partial<InboxLabel>) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState<Partial<InboxLabel>>(initial);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const save = async () => {
    if (!value.name?.trim()) { setError(t("Enter the label name.")); return; }
    setSaving(true); setError(""); await onSave({ ...value, name: value.name.trim() }); setSaving(false);
  };
  return <ControlledModalDialog isOpen title={initial.id ? t("Edit label") : t("New label")} onOpenChange={(open) => { if (!open && !saving) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>{t("Cancel")}</Button><Button variant="primary" isLoading={saving} onPress={() => void save()}>{t("Save label")}</Button></div>}>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <TextInput isRequired label={t("Name")} maxLength={60} value={value.name ?? ""} onChange={(name) => setValue((current) => ({ ...current, name }))} />
      <div role="group" aria-label={t("Colour")} className={styles.swatches}>
        {LABEL_COLORS.map((color: LabelColor) => <button key={color} type="button" aria-pressed={value.color === color} aria-label={t("Colour {number}", { number: LABEL_COLORS.indexOf(color) + 1 })} onClick={() => setValue((current) => ({ ...current, color }))}><LabelChip label={{ name: value.name?.trim() || t("Label"), color }} /></button>)}
      </div>
      {error ? <InlineNotice message={error} tone="error" /> : null}
    </form>
  </ControlledModalDialog>;
}

/** Quick replies can use fields from the chat's records, written as {{contact.first_name}}. */
function QuickReplyDialog({ initial, canShare, onClose, onSave }: { initial: Partial<QuickReply>; canShare: boolean; onClose: () => void; onSave: (value: Partial<QuickReply>) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState<Partial<QuickReply>>(initial);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const save = async () => {
    const shortcut = (value.shortcut ?? "").trim().replace(/^\//, "").toLowerCase();
    if (!/^\S{1,40}$/u.test(shortcut)) { setError(t("Enter a shortcut without spaces.")); return; }
    if (!value.body?.trim()) { setError(t("Enter the reply.")); return; }
    setSaving(true); setError(""); await onSave({ ...value, shortcut, body: value.body.trim() }); setSaving(false);
  };
  return <ControlledModalDialog isOpen title={initial.id ? t("Edit quick reply") : t("New quick reply")} onOpenChange={(open) => { if (!open && !saving) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>{t("Cancel")}</Button><Button variant="primary" isLoading={saving} onPress={() => void save()}>{t("Save quick reply")}</Button></div>}>
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <TextInput isRequired label={t("Shortcut")} prefix="/" maxLength={41} value={value.shortcut ?? ""} onChange={(shortcut) => setValue((current) => ({ ...current, shortcut }))} />
      <TextAreaField isRequired label={t("Reply")} maxLength={4096} value={value.body ?? ""} onChange={(body) => setValue((current) => ({ ...current, body }))} />
      <div className={styles.fields} role="group" aria-label={t("Insert a field")}>
        {TEMPLATE_SOURCES.filter((source) => source !== "staff.first_name").map((source) => <Button key={source} size="compact" variant="quiet" onPress={() => setValue((current) => ({ ...current, body: `${current.body ?? ""}{{${source}}}` }))}>{t(TEMPLATE_SOURCE_LABELS[source])}</Button>)}
      </div>
      {!initial.id && canShare ? <SelectField label={t("For")} items={[{ id: "workspace", label: t("Everyone") }, { id: "personal", label: t("Only me") }]} selectedKey={value.scope ?? "workspace"} onSelectionChange={(key) => setValue((current) => ({ ...current, scope: String(key) as QuickReply["scope"] }))} /> : null}
      {error ? <InlineNotice message={error} tone="error" /> : null}
    </form>
  </ControlledModalDialog>;
}

/** Which field fills each {{n}}; the preview shows an example with the field names in place. */
function TemplateVariablesDialog({ template, onClose, onSave }: { template: InboxTemplate; onClose: () => void; onSave: (variables: Array<{ position: number; source: TemplateSource }>) => Promise<void> }) {
  const t = useT();
  const [sources, setSources] = useState<Record<number, TemplateSource | "">>(() => Object.fromEntries(template.positions.map((position) => [position, template.variables.find((variable) => variable.position === position)?.source ?? ""])));
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const names = Object.fromEntries(TEMPLATE_SOURCES.map((source) => [source, `[${t(TEMPLATE_SOURCE_LABELS[source])}]`])) as Record<TemplateSource, string>;
  const preview = renderTemplate(template.body, fillTemplate({ positions: template.positions, variables: template.positions.flatMap((position) => sources[position] ? [{ position, source: sources[position] as TemplateSource }] : []) }, names).parameters);
  const save = async () => {
    const missing = template.positions.find((position) => !sources[position]);
    if (missing) { setError(t("Choose a field for {{{position}}}.", { position: missing })); return; }
    setSaving(true); setError("");
    await onSave(template.positions.map((position) => ({ position, source: sources[position] as TemplateSource })));
    setSaving(false);
  };
  return <ControlledModalDialog isOpen title={template.code} description={template.locale} onOpenChange={(open) => { if (!open && !saving) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>{t("Cancel")}</Button><Button variant="primary" isLoading={saving} onPress={() => void save()}>{t("Save variables")}</Button></div>}>
    <div className={styles.variables}>
      <p className={styles.preview}>{preview}</p>
      {template.positions.map((position) => <SelectField key={position} isRequired label={`{{${position}}}`} placeholder={t("Choose a field")}
        items={TEMPLATE_SOURCES.map((source) => ({ id: source, label: t(TEMPLATE_SOURCE_LABELS[source]) }))}
        selectedKey={sources[position] || null} onSelectionChange={(key) => setSources((current) => ({ ...current, [position]: (key ? String(key) : "") as TemplateSource | "" }))} />)}
      {error ? <InlineNotice message={error} tone="error" /> : null}
    </div>
  </ControlledModalDialog>;
}
