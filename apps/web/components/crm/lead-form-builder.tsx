"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, Eye, FileText, Palette, Plus, QrCode, Search, Upload } from "lucide-react";
import { Badge, Button, Callout, ControlledModalDialog, DataGrid, IconButton, isNoAccessError, NoAccessNotice, SelectField, Tabs, TextInput, formatDate, useConfirmationDialog, useDesignSystem } from "@/design-system";
import type { LeadsPageData } from "@/lib/crm/leads";
import { type LeadFormRecord } from "@/lib/crm/lead-forms";
import { crmRequest } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translatorFor, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { enquiryFields } from "@/lib/crm/enquiry-fields";
import { administrativeAreaLabel, countryFromLocale } from "@/lib/workspace/region-labels";
import { PublicEnquiryFormView } from "./public-enquiry-form";
import { LeadFormEditor } from "./lead-form-editor";
import styles from "./lead-forms.module.css";

export type LeadFormBranding = { logoUrl: string | null; primaryColor: string | null; secondaryColor: string | null; workspaceName: string; canManage: boolean };

type FormResponse = { id: string; reference: string | null; leadId: string | null; name: string; status: string; receivedAt: string; answers: Array<{ title: string; value: unknown }>; consentStatus: string; candidateCount: number };
const formStatusLabels: Record<string, MessageKey> = { draft: tKey("Draft"), published: tKey("Published"), paused: tKey("Paused") };

export function LeadFormBuilder({ initialData, initialBranding, onDirtyChange, onEditingChange }: { initialData: LeadsPageData; initialBranding?: LeadFormBranding; onDirtyChange?: (dirty: boolean) => void; onEditingChange?: (editing: boolean) => void }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  const [forms, setForms] = useState<LeadFormRecord[]>([]);
  const [record, setRecord] = useState<LeadFormRecord>();
  const [draft, setDraft] = useState<LeadFormRecord["draft"]>();
  const [tab, setTab] = useState("questions");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [branding, setBranding] = useState(initialBranding);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [search, setSearch] = useState("");
  const logoInput = useRef<HTMLInputElement | null>(null);
  const [qr, setQr] = useState("");
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [responseCursor, setResponseCursor] = useState<string | null>(null);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [response, setResponse] = useState<(typeof responses)[number]>();
  const [reload, setReload] = useState(0);
  const responseRequest = useRef<AbortController | null>(null);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const dirty = Boolean(record && draft && JSON.stringify(record.draft) !== JSON.stringify(draft));
  // PLM-036 / PLM-028: one link (and QR code) per channel and placement; the server re-checks the pair.
  const [shareSource, setShareSource] = useState("");
  const [shareChannel, setShareChannel] = useState("");
  const [placement, setPlacement] = useState("");
  const placementSlug = placement.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const linkParams = new URLSearchParams({ ...(shareSource && shareChannel ? { source: shareSource, channel: shareChannel } : {}), ...(placementSlug ? { placement: placementSlug } : {}) }).toString();
  const url = record && typeof window !== "undefined" ? `${window.location.origin}/enquiry/${record.token}${linkParams ? `?${linkParams}` : ""}` : "";
  const options = initialData.leadOptions;
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
      if (!anchor || anchor.getAttribute("target") === "_blank" || event.metaKey || event.ctrlKey) return;
      event.preventDefault(); event.stopPropagation();
      requestConfirmation({
        title: t("Discard unsaved form changes?"),
        body: t("Your saved form stays unchanged. Unsaved questions and settings will be discarded."),
        confirmLabel: t("Discard changes"),
        onConfirm: () => window.location.assign(anchor.href),
      });
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigate, true); };
  }, [dirty, requestConfirmation]);
  useEffect(() => {
    if (!sharing || !url) return;
    let mounted = true;
    import("qrcode").then(module => module.toDataURL(url, { width: 300, margin: 4, errorCorrectionLevel: "M" })).then(value => { if (mounted) setQr(value); }).catch(() => setError(t("QR code could not be generated.")));
    return () => { mounted = false; };
  }, [sharing, url]);
  const open = (form: LeadFormRecord) => { responseRequest.current?.abort(); setResponses([]); setResponseCursor(null); setResponse(undefined); setLoadingResponses(false); setPreview(false); setSharing(false); setBrandOpen(false); setQr(""); setRecord(form); setDraft(structuredClone(form.draft)); setTab("questions"); setError(""); setNotice(""); onEditingChange?.(true); };
  const create = async () => {
    setBusy(true); setError("");
    try { const form = await crmRequest<LeadFormRecord>(initialData.workspaceId, "lead-forms", "POST", {}); setForms(previous => [form, ...previous]); open(form); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("Form could not be created.")); }
    finally { setBusy(false); }
  };
  const save = async (action = "save") => {
    if (!record || !draft) return;
    const issue = validateDraft(draft, action === "publish", t);
    if (issue) { setError(issue); setNotice(""); setTab("questions"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await crmRequest<LeadFormRecord>(initialData.workspaceId, `lead-forms/${record.id}`, "PATCH", { version: record.version, draft, action });
      setRecord(result); setDraft(structuredClone(result.draft)); setForms(previous => previous.map(form => form.id === result.id ? result : form));
      if (action === "publish") setSharing(true);
      setNotice(action === "publish" ? t("Form published. Its link is ready to share.") : action === "pause" ? t("Form paused. New submissions are disabled.") : t("Draft saved."));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("Form could not be saved.")); }
    finally { setBusy(false); }
  };
  const loadResponses = async (cursor?: string) => {
    if (!record) return;
    responseRequest.current?.abort();
    const controller = new AbortController(); responseRequest.current = controller;
    setLoadingResponses(true);
    try { const result = await crmRequest<{ data: typeof responses; nextCursor: string | null }>(initialData.workspaceId, `lead-forms/${record.id}/responses?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, "GET", undefined, controller.signal); if (!controller.signal.aborted) { setResponses(previous => cursor ? [...previous, ...result.data] : result.data); setResponseCursor(result.nextCursor); } }
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
      confirmLabel: t("Discard changes"),
      onConfirm: closeForm,
    });
  };
  return <section className={styles.forms} aria-label={t("Enquiry form builder")}>
    {error && (isNoAccessError(error) ? <NoAccessNotice area={t("Forms")} /> : <Callout title={t("Forms")} tone="danger">{error}{!record && !loading && <Button size="compact" onPress={() => { setLoading(true); setError(""); setReload(value => value + 1); }}>{t("Retry loading forms")}</Button>}</Callout>)}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!record || !draft ? <>
      <div className={styles.formListToolbar}><label className={styles.formSearch}><Search size={17} aria-hidden="true" /><input aria-label={t("Search forms")} placeholder={t("Search forms")} value={search} onChange={event => setSearch(event.target.value)} /></label><Button variant="primary" size="compact" onPress={() => void create()} isLoading={busy}><Plus size={15} />{t("New form")}</Button></div>
      {loading ? <p role="status">{t("Loading forms…")}</p> : <div className={styles.formGallery} aria-label={t("Enquiry forms")}>
        {forms.filter(form => form.draft.title.toLowerCase().includes(search.trim().toLowerCase())).map(form => <button type="button" className={styles.formTile} key={form.id} onClick={() => open(form)} aria-label={t("Edit form {title}", { title: form.draft.title })}>
          <span className={styles.formTilePreview}>{branding?.logoUrl && <Image src={branding.logoUrl} alt="" width={96} height={36} unoptimized />}<span>{form.draft.title}</span><i /><i /><i /></span>
          <span className={styles.formTileFooter}><FileText size={17} aria-hidden="true" /><span><strong>{form.draft.title}</strong><small>{form.status === "published" ? t("Live · responses in Enquiries") : form.status === "paused" ? t("Paused") : t("Draft · publish to create enquiries")} · {t("Updated {date}", { date: formatDate(form.updatedAt, { locale, timeZone }) })}</small></span></span>
        </button>)}
        {!forms.length && <div className={styles.emptyForms}><FileText size={23} aria-hidden="true" /><p>{t("Your first form starts with the required enquiry questions and sends submissions directly to Enquiries.")}</p><Button size="compact" variant="primary" onPress={() => void create()}>{t("Create default enquiry form")}</Button></div>}
        {forms.length > 0 && !forms.some(form => form.draft.title.toLowerCase().includes(search.trim().toLowerCase())) && <p>{t("No matching forms.")}</p>}
      </div>}
    </> : <>
      <header className={styles.toolbar}>
        <div className={styles.toolbarTitle}><IconButton aria-label={t("Back to forms")} size="compact" isDisabled={busy} onPress={requestCloseForm}><ArrowLeft size={17} /></IconButton><span className={styles.editorName}>{draft.title}</span><Badge>{dirty ? t("Unsaved") : formStatusLabels[record.status] ? t(formStatusLabels[record.status]) : record.status}</Badge></div>
        <div className={styles.actions}><Button size="compact" variant="quiet" onPress={() => setBrandOpen(value => !value)}><Palette size={16} />{t("Brand")}</Button><Button size="compact" variant="quiet" onPress={() => setPreview(true)}><Eye size={16} />{t("Preview form")}</Button>{record.status === "published" && <Button size="compact" onPress={() => setSharing(true)}><QrCode size={16} />{t("Share form")}</Button>}<Button size="compact" isDisabled={!dirty || busy} onPress={() => void save()}>{t("Save draft")}</Button><Button size="compact" variant="primary" isLoading={busy} onPress={() => void save("publish")}>{record.published ? t("Publish changes") : t("Publish")}</Button></div>
      </header>
      {brandOpen && <aside className={styles.brandPanel} aria-label={t("Form branding")}><div className={styles.brandIdentity}>{branding?.logoUrl ? <Image src={branding.logoUrl} alt={t("{name} logo", { name: branding.workspaceName })} width={104} height={52} unoptimized /> : <span>{branding?.workspaceName ?? t("Company")}</span>}<div><strong>{t("Workspace brand")}</strong><small>{t("This logo and your brand colours appear on all published enquiry forms.")}</small></div></div><input ref={logoInput} className={styles.visuallyHidden} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t("Choose brand logo")} onChange={event => void uploadLogo(event)} /><Button size="compact" isDisabled={!branding?.canManage || uploadingLogo} isLoading={uploadingLogo} onPress={() => logoInput.current?.click()}><Upload size={15} />{branding?.logoUrl ? t("Replace logo") : t("Upload logo")}</Button>{!branding?.canManage && <small>{t("Ask a workspace administrator to update the brand logo.")}</small>}</aside>}
      <fieldset disabled={busy} className={styles.editorFieldset}><Tabs selectedKey={tab} onSelectionChange={key => { setTab(key); if (key === "responses") void loadResponses(); }} items={[
        { id: "questions", label: t("Questions"), panel: <LeadFormEditor key={record.id} draft={draft} setDraft={setDraft} busy={busy} fields={fields} workspaceId={initialData.workspaceId} onFieldCreated={saved => setFieldState(current => current && ({ ...current, custom: [...current.custom, saved] }))} /> },
        { id: "responses", label: responses.length ? t("Responses ({count})", { count: `${responses.length}${responseCursor ? "+" : ""}` }) : t("Responses"), panel: <div className={styles.responsesPanel}><div className={styles.responsesHeading}><p>{t("Each submitted response is linked to an enquiry, or held for duplicate review.")}</p><Button size="compact" variant="quiet" isDisabled={loadingResponses} onPress={() => void loadResponses()}>{t("Refresh")}</Button></div>{loadingResponses && <p role="status">{t("Loading responses…")}</p>}<DataGrid ariaLabel={t("Form responses")} data={responses} columns={[{ accessorKey: "reference", header: t("Enquiry ID"), size: 140, cell: ({ row }) => row.original.reference ?? t("Pending review") }, { accessorKey: "name", header: t("Customer"), size: 240 }, { accessorKey: "status", header: t("Status"), size: 180, cell: ({ row }) => row.original.status === "duplicate_candidate" ? t("Duplicate review · {count}", { count: row.original.candidateCount }) : row.original.status.replaceAll("_", " ") }, { accessorKey: "receivedAt", header: t("Received"), size: 180, cell: ({ getValue }) => formatDate(String(getValue()), { locale, timeZone }, { dateStyle: "medium", timeStyle: "short" }) }]} getRowId={entry => entry.id} onRowAction={setResponse} pageSize={25} hasMoreRows={Boolean(responseCursor)} footerActions={responseCursor ? <Button size="compact" isLoading={loadingResponses} onPress={() => void loadResponses(responseCursor)}>{t("Load more responses")}</Button> : undefined} emptyTitle={loadingResponses ? t("Loading responses…") : t("No responses yet")} emptyDescription={t("Responses from the published form appear here and in Enquiries.")} /></div> },
        { id: "settings", label: t("Settings"), panel: <div className={styles.settings}><h3>{t("Enquiry destination")}</h3><p>{t("Every submission creates an intake record and an enquiry. Routing rules assign it to the sales team; possible duplicates wait for review.")}</p><div className={styles.questionFields}><SelectField label={t("Source")} items={options?.sources ?? []} selectedKey={draft.source} onSelectionChange={key => { const source = String(key); setDraft({ ...draft, source, channel: options?.channels[source]?.[0]?.id ?? "" }); }} /><SelectField label={t("Channel")} items={options?.channels[draft.source] ?? []} selectedKey={draft.channel} onSelectionChange={key => setDraft({ ...draft, channel: String(key) })} /></div><p>{t("These attribution settings are internal. Choosing a social channel records where you shared the link; it does not import social lead ads.")}</p>{record.status === "published" && <Button isDisabled={busy} onPress={() => void save("pause")}>{t("Pause submissions")}</Button>}</div> },
      ]} /></fieldset>
      {preview && <ControlledModalDialog isOpen onOpenChange={setPreview} title={t("Form preview")} size="lg"><PublicEnquiryFormView key={JSON.stringify(draft)} preview form={{ ...draft, areas: options?.areas, revision: "preview", consentLabel: t("I agree to be contacted about this enquiry."), branding: branding ? { displayName: branding.workspaceName, logoUrl: branding.logoUrl, primaryColor: branding.primaryColor, secondaryColor: branding.secondaryColor, headingFont: null, bodyFont: null } : null }} /></ControlledModalDialog>}
      {sharing && <ControlledModalDialog isOpen onOpenChange={setSharing} title={t("Share enquiry form")} size="md"><div className={styles.share}>
        <div className={styles.shareFields}>
          <SelectField label={t("Source")} selectedKey={shareSource || "form"} items={[{ id: "form", label: t("Form default") }, ...(options?.sources ?? []).filter(source => !source.allowedRoles?.length && !["returning_customer", "referral"].includes(source.id)).map(source => ({ id: source.id, label: source.label }))]} onSelectionChange={key => { setShareSource(key === "form" ? "" : String(key)); setShareChannel(""); }} />
          {shareSource ? <SelectField label={t("Channel")} isRequired selectedKey={shareChannel || null} items={(options?.channels[shareSource] ?? []).map(channel => ({ id: channel.id, label: channel.label }))} onSelectionChange={key => setShareChannel(String(key ?? ""))} /> : null}
          <TextInput label={t("Placement")} description={t("For example: showroom door, magazine, event stand.")} value={placement} onChange={setPlacement} maxLength={60} />
        </div>
        <TextInput label={t("Form link")} value={url} isReadOnly />
        <Button onPress={() => { void navigator.clipboard.writeText(url).then(() => setNotice(t("Form link copied."))).catch(() => setError(t("Select and copy the form link manually."))); }}>{t("Copy link")}</Button>
        {qr && <><Image unoptimized src={qr} alt={t("QR code for this enquiry form")} width={240} height={240} /><a className={styles.download} href={qr} download={`enquiry-form-qr${placementSlug ? `-${placementSlug}` : shareChannel ? `-${shareChannel}` : ""}.png`}>{t("Download QR code")}</a></>}
      </div></ControlledModalDialog>}
      {response && <ControlledModalDialog isOpen onOpenChange={open => { if (!open) setResponse(undefined); }} title={response.reference || t("Enquiry response")} size="md">{response.status === "duplicate_candidate" && <Callout title={t("Duplicate review required")} tone="warning">{response.candidateCount === 1 ? t("This response is preserved with {count} possible customer match. Review it in Incoming enquiries.", { count: response.candidateCount }) : t("This response is preserved with {count} possible customer matches. Review it in Incoming enquiries.", { count: response.candidateCount })}</Callout>}<div className={styles.responseAnswers}>{response.answers.map((answer, index) => <div key={index}><h4>{answer.title}</h4><p>{Array.isArray(answer.value) ? answer.value.join(", ") : String(answer.value ?? t("Not provided"))}</p></div>)}</div>{response.leadId && <a className={styles.enquiryLink} href={`/workspace/crm/leads?lead=${response.leadId}`}>{response.reference ? t("Open {reference} in Enquiries", { reference: response.reference }) : t("Open enquiry in Enquiries")}</a>}</ControlledModalDialog>}
    </>}
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
