"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, Copy, Download, Eye, FileText, LayoutTemplate, Pencil, Plus, QrCode, RefreshCw, Trash2, Upload } from "lucide-react";
import { Badge, Button, Callout, ControlledModalDialog, DataGrid, DesignSystemProvider, EmptyState, FormSection, IconButton, InspectorSheet, isNoAccessError, NoAccessNotice, SearchInput, SegmentedControl, SelectField, Tabs, formatDate, useConfirmationDialog, useDesignSystem, useMediaQuery, type DataGridColumn, type StatusTone } from "@/design-system";
import { leadOptionLabel } from "@/lib/crm/lead-options";
import { translateKnown } from "@/lib/i18n/keys";
import type { LeadsPageData } from "@/lib/crm/leads";
import { type LeadFormRecord, type LeadFormSchema } from "@/lib/crm/lead-forms";
import { LEAD_FORM_TEMPLATES, applyLeadFormTemplate, type LeadFormTemplate } from "@/lib/crm/lead-form-templates";
import { crmRequest } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translatorFor, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { enquiryFields } from "@/lib/crm/enquiry-fields";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { administrativeAreaLabel, countryFromLocale } from "@/lib/workspace/region-labels";
import { PublicEnquiryFormView, type EnquiryFormLayout } from "./public-enquiry-form";
import { LeadFormEditor, SYSTEM_FIELDS } from "./lead-form-editor";
import { LeadFormShareSheet } from "./lead-form-share";
import crmTheme from "./crm-workspace-colors.module.css";
import styles from "./lead-forms.module.css";

export type LeadFormBranding = { logoUrl: string | null; primaryColor: string | null; secondaryColor: string | null; workspaceName: string; canManage: boolean };

type FormResponse = { id: string; reference: string | null; leadId: string | null; name: string; status: string; receivedAt: string; answers: Array<{ title: string; value: unknown }>; consentStatus: string; candidateCount: number };
const formStatusLabels: Record<string, MessageKey> = { draft: tKey("Draft"), published: tKey("Published"), paused: tKey("Paused") };
/** The live preview sits beside the questions from this width; below it, "Preview" opens it. */
const WIDE_BUILDER = "(min-width: 80rem)";
const answerText = (value: unknown) => Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value);
/** A spreadsheet cell: quoted, and never read as a formula. */
const csvCell = (value: string) => `"${(/^[=+\-@]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;

/** The public form exactly as people see it: always light, in the tenant's brand. */
export function LeadFormPreview({ draft, areas, branding, consentLabel, layout = "classic" }: { draft: LeadFormSchema; areas?: Record<string, { id: string; label: string }[]>; branding?: LeadFormBranding; consentLabel: string; layout?: EnquiryFormLayout }) {
  return <DesignSystemProvider theme="light" className={[crmTheme.theme, styles.previewCanvas].join(" ")} style={workspacePrimaryColorStyle({ primaryColor: branding?.primaryColor ?? null, secondaryColor: branding?.secondaryColor ?? null })}>
    <PublicEnquiryFormView key={`${layout}:${JSON.stringify(draft)}`} preview layout={layout} form={{ ...draft, areas, revision: "preview", consentLabel, branding: branding ? { displayName: branding.workspaceName, logoUrl: branding.logoUrl, primaryColor: branding.primaryColor, secondaryColor: branding.secondaryColor, headingFont: null, bodyFont: null } : null }} />
  </DesignSystemProvider>;
}

export function LeadFormBuilder({ initialData, initialBranding, onDirtyChange, onEditingChange, autosaveDelay = 2500 }: { initialData: LeadsPageData; initialBranding?: LeadFormBranding; onDirtyChange?: (dirty: boolean) => void; onEditingChange?: (editing: boolean) => void; /** Milliseconds after the last edit before the draft saves itself; 0 turns autosave off. */ autosaveDelay?: number }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const wide = useMediaQuery(WIDE_BUILDER);
  const [forms, setForms] = useState<LeadFormRecord[]>([]);
  const [record, setRecord] = useState<LeadFormRecord>();
  const [draft, setDraft] = useState<LeadFormRecord["draft"]>();
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const [tab, setTab] = useState("questions");
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [previewLayout, setPreviewLayout] = useState<EnquiryFormLayout>("classic");
  const [picking, setPicking] = useState(false);
  const [sharing, setSharing] = useState<LeadFormRecord | null>(null);
  const [branding, setBranding] = useState(initialBranding);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [search, setSearch] = useState("");
  const logoInput = useRef<HTMLInputElement | null>(null);
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [responseCursor, setResponseCursor] = useState<string | null>(null);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [responseSearch, setResponseSearch] = useState("");
  const [responseFilter, setResponseFilter] = useState("all");
  const [response, setResponse] = useState<FormResponse>();
  const [reload, setReload] = useState(0);
  const responseRequest = useRef<AbortController | null>(null);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  // A form not saved yet (no id) is unsaved work until it is saved.
  const dirty = Boolean(record && draft && (!record.id || JSON.stringify(record.draft) !== JSON.stringify(draft)));
  const unpublished = Boolean(record?.published && JSON.stringify(record.published) !== JSON.stringify(record.draft));
  const options = initialData.leadOptions;
  const consentLabel = t("I agree to be contacted about this enquiry.");
  const [fieldState, setFieldState] = useState(initialData.enquiryFields);
  const fields = enquiryFields(fieldState, administrativeAreaLabel(countryFromLocale(initialData.defaultLocale))).map(field => field.kind === "fixed" && field.key !== "region" ? { ...field, label: t(field.label as never) } : field);
  useEffect(() => {
    const controller = new AbortController();
    crmRequest<{ data: LeadFormRecord[] }>(initialData.workspaceId, "lead-forms", "GET", undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setForms(result.data); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("Forms could not be loaded.")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialData.workspaceId, reload]);
  useEffect(() => () => responseRequest.current?.abort(), []);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.getAttribute("target") === "_blank" || anchor.hasAttribute("download") || event.metaKey || event.ctrlKey) return;
      event.preventDefault(); event.stopPropagation();
      requestConfirmation({
        title: t("Discard unsaved form changes?"),
        body: t("Your saved form stays unchanged. Unsaved questions and settings will be discarded."),
        confirmLabel: t("Discard changes"), cancelLabel: t("Keep editing"),
        onConfirm: () => window.location.assign(anchor.href),
      });
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigate, true); };
  }, [dirty, requestConfirmation]);
  const open = (form: LeadFormRecord, next?: LeadFormSchema) => { responseRequest.current?.abort(); setResponses([]); setResponseCursor(null); setResponse(undefined); setLoadingResponses(false); setPreview(false); setSharing(null); setRecord(form); setDraft(next ?? structuredClone(form.draft)); setTab("questions"); setError(""); setNotice(""); setSaveState("idle"); onEditingChange?.(true); };
  // A new form (from a template or the default) is only in the builder until it is saved or published: leaving it
  // saves nothing, so abandoned drafts don't pile up in the list.
  const create = async (template?: LeadFormTemplate) => {
    setBusy(true); setError("");
    try {
      const { draft: base } = await crmRequest<{ draft: LeadFormSchema }>(initialData.workspaceId, "lead-forms/blank");
      setPicking(false);
      const unsaved: LeadFormRecord = { id: "", token: "", draft: base, published: null, status: "draft", version: 0, updatedAt: new Date().toISOString() };
      open(unsaved, template ? applyLeadFormTemplate(template, base, fields, t, SYSTEM_FIELDS) : undefined);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("Form could not be created.")); }
    finally { setBusy(false); }
  };
  /** A draft nobody published can be deleted; a published form is paused instead. */
  const removeDraft = (form: LeadFormRecord) => requestConfirmation({
    title: t("Delete the draft {title}?", { title: form.draft.title }), body: t("The draft is removed. It was never published, so no enquiries came from it."), confirmLabel: t("Delete draft"),
    onConfirm: () => void crmRequest(initialData.workspaceId, `lead-forms/${form.id}?version=${form.version}`, "DELETE")
      .then(() => { setForms(previous => previous.filter(item => item.id !== form.id)); setNotice(t("Draft deleted.")); })
      .catch(failure => setError(failure instanceof Error ? failure.message : t("The draft could not be deleted."))),
  });
  /** Saves the draft (or publishes it). Autosave is quiet: editing carries on and only a failure is shown. */
  const save = async (action = "save", quiet = false) => {
    if (!record || !draft || saveState === "saving") return;
    const issue = validateDraft(draft, action === "publish", t);
    if (issue) { if (!quiet) { setError(issue); setNotice(""); setTab("questions"); } return; }
    const sent = draft;
    if (!quiet) setBusy(true);
    setSaveState("saving"); setError(""); if (!quiet) setNotice("");
    try {
      let saved = record;
      if (!saved.id) {
        // The first save creates the form with what is in the builder.
        const created = await crmRequest<LeadFormRecord>(initialData.workspaceId, "lead-forms", "POST", { draft: sent });
        saved = created; setRecord(created); setForms(previous => [created, ...previous]);
      }
      const result = action === "save" && saved !== record ? saved : await crmRequest<LeadFormRecord>(initialData.workspaceId, `lead-forms/${saved.id}`, "PATCH", { version: saved.version, draft: sent, action });
      setRecord(result); setForms(previous => previous.map(form => form.id === result.id ? result : form));
      // Edits made while an autosave was on its way are kept; otherwise the server's copy is the draft.
      if (!quiet || draftRef.current === sent) setDraft(structuredClone(result.draft));
      setSaveState("saved");
      if (action === "publish") setSharing(result);
      if (!quiet) setNotice(action === "publish" ? t("Form published. Its link is ready to share.") : action === "pause" ? t("Form paused. New submissions are disabled.") : t("Draft saved."));
    } catch (failure) { setSaveState("idle"); setError(failure instanceof Error ? failure.message : t("Form could not be saved.")); }
    finally { if (!quiet) setBusy(false); }
  };
  useEffect(() => {
    if (!record?.id || !dirty || !autosaveDelay || busy || !draft || saveState === "saving" || validateDraft(draft, false, t)) return;
    const timer = window.setTimeout(() => void save("save", true), autosaveDelay);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, busy, record, saveState, autosaveDelay]);
  const loadResponses = async (cursor?: string) => {
    if (!record?.id) return;
    responseRequest.current?.abort();
    const controller = new AbortController(); responseRequest.current = controller;
    setLoadingResponses(true);
    try { const result = await crmRequest<{ data: FormResponse[]; nextCursor: string | null }>(initialData.workspaceId, `lead-forms/${record.id}/responses?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "GET", undefined, controller.signal); if (!controller.signal.aborted) { setResponses(previous => cursor ? [...previous, ...result.data] : result.data); setResponseCursor(result.nextCursor); } }
    catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("Responses could not be loaded.")); }
    finally { if (!controller.signal.aborted) setLoadingResponses(false); }
  };
  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !branding?.canManage || uploadingLogo) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError(t("Choose a PNG, JPEG, or WebP logo no larger than 5 MB.")); return;
    }
    setUploadingLogo(true); setError("");
    try {
      const started = await fetch("/api/workspace/company-profile/logo-uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: initialData.workspaceId, filename: file.name, mimeType: file.type, byteSize: file.size }) });
      if (!started.ok) throw new Error(t("The logo upload could not be started."));
      const session = await started.json() as { assetId: string; uploadMode: string; uploadUrl?: string; uploadHeaders: Record<string, string> };
      const uploadUrl = session.uploadMode === "signed" && session.uploadUrl ? session.uploadUrl : `/api/workspace/company-profile/logo-uploads/${session.assetId}/content?workspaceId=${initialData.workspaceId}`;
      const uploaded = await fetch(uploadUrl, { method: "PUT", headers: session.uploadHeaders, body: file });
      if (!uploaded.ok) throw new Error(t("The logo could not be uploaded."));
      const completed = await fetch(`/api/workspace/company-profile/logo-uploads/${session.assetId}/complete?workspaceId=${initialData.workspaceId}`, { method: "POST" });
      if (!completed.ok) throw new Error(t("The logo could not be activated."));
      const result = await completed.json() as { logoUrl: string };
      setBranding(current => current ? { ...current, logoUrl: result.logoUrl } : current);
      setNotice(t("Brand logo updated for this workspace and its enquiry forms."));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("The logo could not be uploaded.")); }
    finally { setUploadingLogo(false); }
  };
  const closeForm = () => { setRecord(undefined); setDraft(undefined); onEditingChange?.(false); };
  const requestCloseForm = () => {
    if (!dirty) { closeForm(); return; }
    requestConfirmation({
      title: t("Discard unsaved form changes?"),
      body: t("Your saved form stays unchanged. Unsaved questions and settings will be discarded."),
      confirmLabel: t("Discard changes"), cancelLabel: t("Keep editing"),
      onConfirm: closeForm,
    });
  };
  const exportResponses = () => {
    const titles = [...new Set(responses.flatMap(entry => entry.answers.map(answer => answer.title)))];
    const rows = [[t("Enquiry ID"), t("Customer"), t("Status"), t("Received"), ...titles], ...responses.map(entry => [entry.reference ?? "", entry.name, entry.status, entry.receivedAt, ...titles.map(title => answerText(entry.answers.find(answer => answer.title === title)?.value))])];
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    link.download = `${(draft?.title || "form").replace(/[^\w-]+/g, "-").toLowerCase()}-responses.csv`;
    link.click(); URL.revokeObjectURL(link.href);
  };

  const status: { label: string; tone: StatusTone } = !record ? { label: "", tone: "neutral" }
    : saveState === "saving" ? { label: t("Saving…"), tone: "neutral" }
    : dirty ? { label: t("Unsaved changes"), tone: "warning" }
    : unpublished ? { label: t("Unpublished changes"), tone: "warning" }
    : record.status === "draft" && saveState === "saved" ? { label: t("Draft saved"), tone: "neutral" }
    : { label: formStatusLabels[record.status] ? t(formStatusLabels[record.status]) : record.status, tone: record.status === "published" ? "success" : "neutral" };
  const query = responseSearch.trim().toLowerCase();
  const shownResponses = responses.filter(entry => (responseFilter === "all" || (responseFilter === "review" ? entry.status === "duplicate_candidate" : Boolean(entry.leadId)))
    && (!query || [entry.reference ?? "", entry.name, ...entry.answers.map(answer => answerText(answer.value))].some(value => value.toLowerCase().includes(query))));
  const visibleForms = forms.filter(form => form.draft.title.toLowerCase().includes(search.trim().toLowerCase()));
  // PLM-116: one list of every form with where its enquiries land, its submissions, the link to copy and the QR code.
  const live = (form: LeadFormRecord) => form.published ?? form.draft;
  const formLink = (form: LeadFormRecord) => typeof window === "undefined" ? "" : `${window.location.origin}/enquiry/${form.token}`;
  const copyLink = (form: LeadFormRecord) => navigator.clipboard.writeText(formLink(form)).then(() => { setError(""); setNotice(t("Form link copied.")); }).catch(() => setError(t("Select and copy the text manually.")));
  const downloadQr = async (form: LeadFormRecord) => {
    try {
      const qr = await import("qrcode");
      const link = document.createElement("a");
      link.href = await qr.toDataURL(formLink(form), { width: 600, margin: 4, errorCorrectionLevel: "M" });
      link.download = `enquiry-form-qr-${live(form).title.replace(/[^\w-]+/g, "-").toLowerCase()}.png`;
      link.click();
    } catch { setError(t("QR code could not be generated.")); }
  };
  const published = (form: LeadFormRecord) => form.status === "published";
  const formColumns: DataGridColumn<LeadFormRecord>[] = [
    { id: "title", accessorFn: form => form.draft.title, header: t("Form"), size: 260, meta: { primary: true }, cell: ({ row: { original: form } }) => <span className={styles.formName}><strong>{form.draft.title}</strong><small>{t("Updated {date}", { date: formatDate(form.updatedAt, { locale, timeZone }) })}</small></span> },
    { id: "status", accessorFn: form => form.status, header: t("Status"), size: 120, cell: ({ row: { original: form } }) => <Badge tone={published(form) ? "success" : "neutral"}>{formStatusLabels[form.status] ? t(formStatusLabels[form.status]) : form.status}</Badge> },
    { id: "source", accessorFn: form => translateKnown(t, leadOptionLabel(options?.sources, live(form).source)), header: t("Source"), size: 150 },
    { id: "channel", accessorFn: form => translateKnown(t, leadOptionLabel(options?.channels[live(form).source], live(form).channel)), header: t("Channel"), size: 150 },
    { id: "submissions", accessorFn: form => form.submissions ?? 0, header: t("Submissions"), size: 120, meta: { align: "end" } },
    { id: "actions", header: t("Actions"), size: 200, enableSorting: false, meta: { align: "end" }, cell: ({ row: { original: form } }) => <span className={styles.rowActions}>
      {published(form) ? <>
        <IconButton size="compact" aria-label={t("Copy link to {title}", { title: form.draft.title })} onPress={() => void copyLink(form)}><Copy size={15} /></IconButton>
        <IconButton size="compact" aria-label={t("Download QR for {title}", { title: form.draft.title })} onPress={() => void downloadQr(form)}><Download size={15} /></IconButton>
        <IconButton size="compact" aria-label={t("Share {title}", { title: form.draft.title })} onPress={() => setSharing(form)}><QrCode size={15} /></IconButton>
      </> : <small className={styles.hint}>{t("Publish to share")}</small>}
      <IconButton size="compact" aria-label={t("Edit form {title}", { title: form.draft.title })} isDisabled={busy} onPress={() => open(form)}><Pencil size={15} /></IconButton>
      {form.status === "draft" && !form.published ? <IconButton size="compact" aria-label={t("Delete the draft {title}", { title: form.draft.title })} isDisabled={busy} onPress={() => removeDraft(form)}><Trash2 size={15} /></IconButton> : null}
    </span> },
  ];

  return <section className={styles.forms} aria-label={t("Enquiry form builder")}>
    {error && (isNoAccessError(error) ? <NoAccessNotice area={t("Forms")} /> : <Callout title={t("Forms")} tone="danger">{error}{!record && !loading && <Button size="compact" onPress={() => { setLoading(true); setError(""); setReload(value => value + 1); }}>{t("Retry loading forms")}</Button>}</Callout>)}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!record || !draft ? <>
      <div className={styles.formListToolbar}><SearchInput label={t("Search forms")} value={search} onChange={setSearch} /><Button variant="primary" size="compact" onPress={() => setPicking(true)} isDisabled={busy}><Plus size={15} />{t("New form")}</Button></div>
      <DataGrid ariaLabel={t("Enquiry forms")} columns={formColumns} data={visibleForms} getRowId={form => form.id} onRowAction={open} isLoading={loading} selectable={false} rowNumbers={false} showToolbar={false} showFooter={false} keepEmptyTable={false}
        emptyContent={forms.length ? <EmptyState title={t("No matching forms.")} description={t("Try another search.")} />
          : <EmptyState title={t("No forms yet")} description={t("Start from a template; every submission becomes an enquiry.")} action={<Button size="compact" variant="primary" onPress={() => void create()}>{t("Create default enquiry form")}</Button>} />} />
    </> : <>
      <header className={styles.toolbar}>
        <div className={styles.toolbarTitle}><IconButton aria-label={t("Back to forms")} size="compact" isDisabled={busy} onPress={requestCloseForm}><ArrowLeft size={17} /></IconButton><span className={styles.editorName}>{draft.title}</span><Badge tone={status.tone} aria-live="polite">{status.label}</Badge></div>
        <div className={styles.actions}>
          <Button size="compact" variant="quiet" onPress={() => setPreview(true)}><Eye size={16} />{t("Preview form")}</Button>
          {record.status === "published" && <Button size="compact" variant="quiet" onPress={() => setSharing(record)}><QrCode size={16} />{t("Share form")}</Button>}
          <Button size="compact" isDisabled={!dirty || busy || saveState === "saving"} onPress={() => void save()}>{t("Save draft")}</Button>
          <Button size="compact" variant="primary" isLoading={busy} isDisabled={saveState === "saving"} onPress={() => void save("publish")}>{record.published ? t("Publish changes") : t("Publish")}</Button>
        </div>
      </header>
      <fieldset disabled={busy} className={styles.editorFieldset}><Tabs selectedKey={tab} onSelectionChange={key => { setTab(key); if (key === "responses") void loadResponses(); }} items={[
        { id: "questions", label: t("Questions"), panel: <LeadFormEditor key={record.id} draft={draft} setDraft={setDraft} busy={busy} fields={fields} workspaceId={initialData.workspaceId} onFieldCreated={saved => setFieldState(current => current && ({ ...current, custom: [...current.custom, saved] }))}
          preview={wide ? <LeadFormPreview draft={draft} areas={options?.areas} branding={branding} consentLabel={consentLabel} /> : undefined} /> },
        { id: "responses", label: responses.length ? t("Responses ({count})", { count: `${responses.length}${responseCursor ? "+" : ""}` }) : t("Responses"), panel: <div className={styles.responsesPanel}>
          <div className={styles.responsesToolbar}>
            <SearchInput label={t("Search responses")} value={responseSearch} onChange={setResponseSearch} />
            <SegmentedControl label={t("Show")} value={responseFilter} onChange={setResponseFilter} options={[{ id: "all", label: t("All") }, { id: "linked", label: t("In Enquiries") }, { id: "review", label: t("Duplicate review") }]} />
            <span className={styles.spacer} />
            <Button size="compact" variant="quiet" isDisabled={loadingResponses} onPress={() => void loadResponses()}><RefreshCw size={14} aria-hidden="true" />{t("Refresh")}</Button>
            <Button size="compact" isDisabled={!responses.length} onPress={exportResponses}><Download size={14} aria-hidden="true" />{t("Export CSV")}</Button>
          </div>
          {loadingResponses && <p role="status" className={styles.hint}>{t("Loading responses…")}</p>}
          <DataGrid ariaLabel={t("Form responses")} data={shownResponses} columns={[{ accessorKey: "reference", header: t("Enquiry ID"), size: 140, cell: ({ row }) => row.original.reference ?? t("Pending review") }, { accessorKey: "name", header: t("Customer"), size: 240 }, { accessorKey: "status", header: t("Status"), size: 180, cell: ({ row }) => row.original.status === "duplicate_candidate" ? t("Duplicate review · {count}", { count: row.original.candidateCount }) : row.original.status.replaceAll("_", " ") }, { accessorKey: "receivedAt", header: t("Received"), size: 180, cell: ({ getValue }) => formatDate(String(getValue()), { locale, timeZone }, { dateStyle: "medium", timeStyle: "short" }) }]} getRowId={entry => entry.id} onRowAction={setResponse} pageSize={25} hasMoreRows={Boolean(responseCursor)} footerActions={responseCursor ? <Button size="compact" isLoading={loadingResponses} onPress={() => void loadResponses(responseCursor)}>{t("Load more responses")}</Button> : undefined} emptyTitle={loadingResponses ? t("Loading responses…") : responses.length ? t("No responses match") : t("No responses yet")} emptyDescription={responses.length ? t("Try another search or filter.") : t("Responses from the published form appear here and in Enquiries.")} />
        </div> },
        { id: "settings", label: t("Settings"), panel: <div className={styles.settings}>
          <FormSection title={t("Brand")}>
            <div className={styles.brandIdentity}>{branding?.logoUrl ? <Image src={branding.logoUrl} alt={t("{name} logo", { name: branding.workspaceName })} width={104} height={52} unoptimized /> : <strong>{branding?.workspaceName ?? t("Company")}</strong>}
              <input ref={logoInput} className="wd-visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label={t("Choose brand logo")} onChange={event => void uploadLogo(event)} />
              <Button size="compact" isDisabled={!branding?.canManage || uploadingLogo} isLoading={uploadingLogo} onPress={() => logoInput.current?.click()}><Upload size={15} />{branding?.logoUrl ? t("Replace logo") : t("Upload logo")}</Button>
            </div>
            {!branding?.canManage && <p className={styles.hint}>{t("Ask a workspace administrator to update the brand logo.")}</p>}
          </FormSection>
          <FormSection title={t("Enquiry destination")}>
            <div className={styles.settingsFields}>
              <SelectField label={t("Source")} items={options?.sources ?? []} selectedKey={draft.source} onSelectionChange={key => { const source = String(key); setDraft({ ...draft, source, channel: options?.channels[source]?.[0]?.id ?? "" }); }} />
              <SelectField label={t("Channel")} description={t("Recorded on each enquiry; a share link can set its own.")} items={options?.channels[draft.source] ?? []} selectedKey={draft.channel} onSelectionChange={key => setDraft({ ...draft, channel: String(key) })} />
            </div>
          </FormSection>
          {record.status === "published" && <FormSection title={t("Submissions")}><div><Button isDisabled={busy} onPress={() => void save("pause")}>{t("Pause submissions")}</Button></div></FormSection>}
        </div> },
      ]} /></fieldset>
      {preview && <ControlledModalDialog isOpen onOpenChange={setPreview} title={t("Form preview")} size="lg">
        <div className={styles.previewDialog}>
          <SegmentedControl label={t("Layout")} value={previewLayout} onChange={value => setPreviewLayout(value as EnquiryFormLayout)} options={[{ id: "classic", label: t("All questions") }, { id: "steps", label: t("One question per screen") }]} />
          <LeadFormPreview draft={draft} areas={options?.areas} branding={branding} consentLabel={consentLabel} layout={previewLayout} />
        </div>
      </ControlledModalDialog>}
      {response && <InspectorSheet isOpen onOpenChange={value => { if (!value) setResponse(undefined); }} title={response.reference || t("Enquiry response")} size="md">
        <div className={styles.responseDetail}>
          {response.status === "duplicate_candidate" && <Callout title={t("Duplicate review required")} tone="warning">{response.candidateCount === 1 ? t("This response is preserved with {count} possible customer match. Review it in Incoming enquiries.", { count: response.candidateCount }) : t("This response is preserved with {count} possible customer matches. Review it in Incoming enquiries.", { count: response.candidateCount })}</Callout>}
          <dl className={styles.responseAnswers}>{response.answers.map((answer, index) => <div key={index}><dt>{answer.title}</dt><dd>{answerText(answer.value) || t("Not provided")}</dd></div>)}</dl>
          {response.leadId && <a className={styles.enquiryLink} href={`/workspace/crm/leads?lead=${response.leadId}`}>{response.reference ? t("Open {reference} in Enquiries", { reference: response.reference }) : t("Open enquiry in Enquiries")}</a>}
        </div>
      </InspectorSheet>}
    </>}
    {picking && <ControlledModalDialog isOpen onOpenChange={setPicking} title={t("New form")} size="lg">
      <div className={styles.templates}>
        <button type="button" className={styles.templateTile} disabled={busy} onClick={() => void create()}><LayoutTemplate size={18} aria-hidden="true" /><strong>{t("Default enquiry form")}</strong><small>{t("The required enquiry questions")}</small></button>
        {LEAD_FORM_TEMPLATES.map(template => <button type="button" key={template.id} className={styles.templateTile} disabled={busy} onClick={() => void create(template)}><FileText size={18} aria-hidden="true" /><strong>{t(template.name)}</strong><small>{t(template.use)} · {t("{count} questions", { count: template.questions.length })}</small></button>)}
      </div>
    </ControlledModalDialog>}
    {sharing && <LeadFormShareSheet form={sharing} options={options} brandName={branding?.workspaceName} logoUrl={branding?.logoUrl} onClose={() => setSharing(null)} onNotice={setNotice} onError={setError} />}
    {confirmationDialog}
  </section>;
}

export function validateDraft(draft: LeadFormRecord["draft"], publishing: boolean, t: Translate = translatorFor({})) {
  if (!draft.title.trim()) return t("Enter a form title before saving.");
  for (const [index, question] of draft.questions.entries()) {
    const name = question.title.trim() || t("Field {number}", { number: index + 1 });
    if (publishing && !question.title.trim()) return t("Give field {number} a label before publishing.", { number: index + 1 });
    if (question.options.some(option => !option.label.trim())) return t("{name}: enter a label for every option, or remove the empty option.", { name });
    if (publishing && (!question.field || question.field === "custom")) return t("{name}: make it an enquiry field before publishing.", { name });
    // Fixed-field choices are filled in on save; the workspace's own fields carry their choices.
    if (publishing && ["radio", "dropdown", "checkboxes"].includes(question.type) && question.field?.startsWith("cf:") && !question.options.length) return t("{name}: add choices to this field in Settings → Fields.", { name });
  }
  return "";
}
