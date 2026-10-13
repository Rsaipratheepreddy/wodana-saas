'use client';
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey } from "@/lib/i18n/keys";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Copy, Eye, Plus, Redo2, Save, Download, Trash2, Undo2 } from 'lucide-react';
import type { CommercialState, Quote } from '@/lib/commercial/types';
import { commercialPath, jsonRequest } from '@/lib/commercial/client';
import { QuotationBuilderPreview } from './quotation-builder-preview';
import { QuotationPageDesigner } from './quotation-page-designer';
import { builderPresentation } from '@/lib/commercial/quotation-builder-document';
import { referencePresentation, referenceTermsFor } from '@/lib/commercial/quotation-reference-template';
import { QuotationDocumentDetails } from './quotation-document-details';
import { quotationPages } from './quotation-document-page';
import { QuotationScopeGrid } from './quotation-scope-grid';
import { Checkbox, ControlledModalDialog, useConfirmationDialog, useDetailsMenu } from '@/design-system';
import { ScopeImport } from './scope-import';
import { QuotationPaymentEditor } from './quotation-payment-editor';
import { QuotationPdfExport } from './quotation-pdf-export';
import { CatalogOptionsProvider } from './catalog-options-cache';
import styles from './quotation-builder-shell.module.css';
const labels: Record<string, MessageKey> = { cover: tKey('Cover page'), scope: tKey('Scope & pricing'), terms: tKey('Terms & conditions'), summary: tKey('Summary'), payments: tKey('Payment schedule'), acceptance: tKey('Acceptance') };
/** Inside the quote editor the designer saves only the document's design, and payments open the editor's own tab. */
export type EmbeddedProposal = {
    save: (change: { presentation?: unknown; cover?: unknown; terms?: string; inclusions?: string; exclusions?: string }) => Promise<{ quote: Quote; revision: number }>;
    onPayments: () => void;
};
export function QuotationBuilderShell({ backHref, initial, quoteId, embedded }: {
    backHref: string;
    initial: CommercialState;
    quoteId: string;
    embedded?: EmbeddedProposal;
}) {
  const t = useT();
    const router = useRouter();
    const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
    const original = initial.data.quotes.find(quote => quote.id === quoteId)!;
    const [draft, setDraft] = useState<Quote>(() => ({ ...original, ...(!original.presentation ? { terms: referenceTermsFor(original, initial.proposalKit) } : {}), presentation: builderPresentation(original, initial.portalBrand?.name ?? '', initial.customerName,initial) }));
    // The baseline is the draft as opened (normalised), so opening the document doesn't count as a change.
    const [saved, setSaved] = useState(() => JSON.stringify(draft));
    const [revision, setRevision] = useState(initial.data.revision);
    const [active, setActive] = useState(draft.presentation!.pageOrder![0]);
    const [scopeView, setScopeView] = useState(false), [detailsOpen, setDetailsOpen] = useState(false);
    // The page menus close on a click outside or Esc; ticking pages keeps Pages open, an action closes the options.
    const pagesMenu = useDetailsMenu(), pageOptionsMenu = useDetailsMenu({ closeOnChoose: true });
    const [inspectorHost, setInspectorHost] = useState<HTMLDivElement | null>(null);
    const [past, setPast] = useState<Quote[]>([]), [future, setFuture] = useState<Quote[]>([]);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [templateOpen, setTemplateOpen] = useState(false), [templateName, setTemplateName] = useState(''), [converting, setConverting] = useState(false), [templateError, setTemplateError] = useState(''), [templateCreated, setTemplateCreated] = useState(false);
    const [paymentEditor, setPaymentEditor] = useState(false), [scopeImport, setScopeImport] = useState(false);
    const [preview, setPreview] = useState(false), [exporting, setExporting] = useState(false);
    const saving = useRef(false), latest = useRef(draft), lastEdit = useRef(0);
    latest.current = draft;
    const readOnly = !initial.canEdit || draft.status !== 'draft';
    const dirty = !readOnly && JSON.stringify(draft) !== saved;
    const design = draft.presentation!, pages = design.pageOrder!;
    const custom = design.pages.find(page => page.id === active && page.kind === 'custom');
    const title = (id: string) => id === 'scope' ? t('Scope & Items') : t('Page {number}', { number: Math.max(0, quotationPages(draft, t).findIndex(page => page.id === id)) + 1 });
    useEffect(() => { if (!pages.includes(active) && !active.startsWith('items:'))
        setActive(pages[0]); }, [pages, active]);
    useEffect(() => { document.getElementById(`builder-tab-${active}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }, [active]);
    useEffect(() => {
        if (!dirty)
            return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);
    // In the quote editor the design saves itself a moment after the last change.
    useEffect(() => {
        if (!embedded || !dirty || busy)
            return;
        const timer = window.setTimeout(() => void save(), 1200);
        return () => window.clearTimeout(timer);
    });
    function change(next: Quote, checkpoint = false) {
        if (readOnly || saving.current)
            return;
        const now = Date.now(), previous=latest.current;
        if (checkpoint || now - lastEdit.current > 650)
            setPast(value => [...value, previous].slice(-40));
        lastEdit.current = now;
        setFuture([]);
        const prepared = { ...next, presentation: builderPresentation(next, initial.portalBrand?.name ?? '', initial.customerName) };
        setDraft(prepared);
        latest.current = prepared;
        setNotice('');
    }
    function undo() { if (!past.length || readOnly || busy)
        return; setFuture(value => [draft, ...value]); setDraft(past[past.length - 1]); setPast(value => value.slice(0, -1)); lastEdit.current = 0; }
    function redo() { if (!future.length || readOnly || busy)
        return; setPast(value => [...value, draft]); setDraft(future[0]); setFuture(value => value.slice(1)); lastEdit.current = 0; }
    async function save() {
        if (saving.current)
            return false;
        if (!dirty)
            return true;
        if (readOnly)
            return false;
        saving.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            if (embedded) {
                // Only the design is sent; the lines stay as the sheet has them.
                const sent = latest.current;
                const result = await embedded.save({ presentation: sent.presentation, cover: sent.cover, terms: sent.terms, inclusions: sent.inclusions, exclusions: sent.exclusions });
                const next = { ...result.quote, presentation: builderPresentation(result.quote, initial.portalBrand?.name ?? '', initial.customerName) };
                if (latest.current === sent) { setDraft(next); latest.current = next; }
                setSaved(JSON.stringify(latest.current === sent ? next : { ...latest.current, presentation: next.presentation }));
                setRevision(result.revision);
                setNotice(t('Saved'));
                return true;
            }
            const result = await jsonRequest<{
                data: CommercialState['data'];
            }>(commercialPath(initial.workspaceId, `cases/${initial.caseId}`), 'POST', { action: 'save', revision, quoteId: draft.id, quote: draft });
            const next = result.data.quotes.find(quote => quote.id === draft.id);
            if (!next)
                throw new Error(t('The saved quotation was not returned. Refresh before retrying.'));
            setDraft(next);
            setSaved(JSON.stringify(next));
            setRevision(result.data.revision);
            setNotice(t('Saved'));
            return true;
        }
        catch (error) {
            setError(error instanceof Error ? error.message : t('Could not save. Your edits are still here.'));
            return false;
        }
        finally {
            saving.current = false;
            setBusy(false);
        }
    }
    async function importScope(action: string, input: Record<string, unknown>) {
        if (readOnly || saving.current || dirty || action !== 'import_scope')
            return false;
        saving.current = true;
        setBusy(true);
        setError('');
        try {
            const result = await jsonRequest<{
                data: CommercialState['data'];
            }>(commercialPath(initial.workspaceId, `cases/${initial.caseId}`), 'POST', { ...input, action, revision, quoteId: draft.id });
            const returned = result.data.quotes.find(quote => quote.id === draft.id);
            if (!returned)
                throw new Error(t('The updated quotation was not returned. Refresh before retrying.'));
            const next = { ...returned, presentation: builderPresentation(returned, initial.portalBrand?.name ?? '', initial.customerName) };
            setDraft(next);
            setSaved(JSON.stringify(next));
            setRevision(result.data.revision);
            setPast([]);
            setFuture([]);
            setNotice(t('Requirements imported'));
            return true;
        }
        catch (failure) {
            setError(failure instanceof Error ? failure.message : t('Requirements could not be imported.'));
            return false;
        }
        finally {
            saving.current = false;
            setBusy(false);
        }
    }
    async function convertTemplate() {
        if (converting || !templateName.trim() || !draft.lines.length)
            return;
        setConverting(true);
        setTemplateError('');
        try {
            if (dirty && !(await save()))
                throw new Error(t('Save the quotation successfully before converting it to a template.'));
            await jsonRequest(commercialPath(initial.workspaceId, 'quotation-templates'), 'PUT', { name: templateName.trim(), caseId: initial.caseId, quoteId: draft.id });
            setTemplateCreated(true);
        }
        catch (error) {
            setTemplateError(error instanceof Error ? error.message : t('Could not create the template.'));
        }
        finally {
            setConverting(false);
        }
    }
    function addPage(kind: string) {
        if (!kind || pages.length >= 40 || design.pages.length >= 40)
            return;
        const id = `custom:${crypto.randomUUID()}`;
        const name = t(kind === 'introduction' ? 'Introduction' : kind === 'closing' ? 'Closing page' : 'Custom page');
        const elements = kind === 'blank' ? [] : [{ id: kind==='payments'?'data:payments':crypto.randomUUID(), type: 'text' as const, x: 70, y: 90, width: 760, height: kind==='payments'?1000:110, text: kind === 'payments'?'':kind==='closing'?t('Thank you'):name, color: '#26382f', fontSize: 44, align: 'left' as const }];
        const index=pages.indexOf(active.startsWith('items:')?'scope':active);
        const next = { ...design, pageOrder: [...pages.slice(0,index+1), id, ...pages.slice(index+1)], pages: [...design.pages, { id, kind: 'custom' as const, title: name, background: '#ffffff', elements }] };
        change({ ...draft, presentation: next }, true);
        setActive(id);
    }
    function move(direction: number) { const index = pages.indexOf(active.startsWith('items:')?'scope':active), other = index + direction; if (index<0 || other < 0 || other >= pages.length)
        return; const order = [...pages]; [order[index], order[other]] = [order[other], order[index]]; change({ ...draft, presentation: { ...design, pageOrder: order } }, true); }
    function duplicate() { if (!custom || pages.length >= 40 || design.pages.length >= 40)
        return; const id = `custom:${crypto.randomUUID()}`; change({ ...draft, presentation: { ...design, pageOrder: [...pages.slice(0, pages.indexOf(active) + 1), id, ...pages.slice(pages.indexOf(active) + 1)], pages: [...design.pages, { ...custom, id, title: t('{title} copy', { title: title(active) }), elements: structuredClone(custom.elements) }] } }, true); setActive(id); }
    const documentPages = quotationPages(draft, t);
    const canvas = <div className={styles.documentWorkspace}>
  <div className={styles.pageStack}>{documentPages.map((page, index) => <section key={page.id} id={`document-page-${page.id}`} className={styles.documentPage} aria-label={t('Page {number}', { number: index + 1 })}><header><span>{t(page.id.startsWith('items:') ? 'Page {number} · Scope & Items' : 'Page {number}', { number: index + 1 })}</span><button type="button" onClick={() => setActive(page.id)}>{t("Edit page")}</button></header><QuotationPageDesigner pageId={page.id} quote={draft} continuous active={active === page.id} inspectorHost={inspectorHost} onActivate={() => setActive(page.id)} readOnly={readOnly || busy} onChange={change} onEditPayments={() => (embedded ? embedded.onPayments() : setPaymentEditor(true))} onEditDetails={() => setDetailsOpen(true)} onEditScope={() => (embedded ? undefined : setScopeView(true))}/></section>)}</div>
  <aside className={styles.properties}><strong>{t("{title} properties", { title: title(active) })}</strong><p>{t("Select text or an image on any page. Double-click text to edit.")}</p><button type="button" onClick={() => setDetailsOpen(true)}>{t("Client & project details")}</button><button type="button" onClick={() => (embedded ? embedded.onPayments() : setPaymentEditor(true))}>{t("Payment schedule")}</button><div ref={setInspectorHost}/></aside>
 </div>;
    return <CatalogOptionsProvider workspaceId={initial.workspaceId} caseId={initial.caseId}>
 <section className={styles.builder} aria-label={t("Quotation builder")} data-embedded={embedded ? true : undefined}>
  <header className={styles.header} data-embedded={embedded ? true : undefined}>
   {embedded ? <span /> : <Link href={backHref} className={styles.back} onClick={event => { if (busy) {
        event.preventDefault();
        return;
    } if (dirty) {
        event.preventDefault();
        requestConfirmation({ title: t('Leave without saving?'), body: t('Your unsaved quotation changes will be discarded.'), confirmLabel: t('Leave quotation'), cancelLabel: t('Keep editing'), onConfirm: () => router.push(backHref) });
    } }}><ArrowLeft size={15}/>{t("Back to quotations")}</Link>}

   <div className={styles.actions}>
    <span role="status">{readOnly ? t('View only') : busy ? t('Saving…') : dirty ? t('Unsaved changes') : notice || t('Saved')}</span>
    <button type="button" aria-label={t("Undo")} disabled={!past.length || readOnly || busy} onClick={undo}><Undo2 size={16}/></button>
    <button type="button" aria-label={t("Redo")} disabled={!future.length || readOnly || busy} onClick={redo}><Redo2 size={16}/></button>
    {!embedded && initial.canEdit && draft.kind === 'quotation' && <button type="button" disabled={busy || converting} onClick={() => { setTemplateName(draft.title); setTemplateError(''); setTemplateCreated(false); setTemplateOpen(true); }}>{t("Convert to template")}</button>}
    <button type="button" disabled={exporting || !documentPages.length} title={t("Open the print dialog and choose Save as PDF")} onClick={() => setExporting(true)}><Download size={15}/>{t(exporting ? 'Preparing…' : 'Download PDF')}</button>
    <button type="button" aria-pressed={preview} onClick={() => setPreview(!preview)}><Eye size={15}/>{t(preview ? 'Back to editing' : 'Preview')}</button>
    {!readOnly && !embedded && <button type="button" onClick={() => void save()} disabled={busy || !dirty}><Save size={15}/>{t("Save")}</button>}
    {!embedded && <button type="button" className={styles.primary} disabled={busy} onClick={async () => { if (await save())
        router.push(`/workspace/pre-projects/cases/${initial.caseId}/approvals?review=${encodeURIComponent(`quote:${draft.id}`)}`); }}>{t("Review quotation")}<ArrowRight size={14}/></button>}
   </div>
  </header>
   {!preview && <div className={styles.tabs}>
    <div className={styles.pageNavigation} aria-label={t("Quotation pages")}>{embedded ? null : <button type="button" aria-pressed={scopeView} onClick={() => setScopeView(true)}>{t("Scope & Items")}</button>}<button type="button" aria-pressed={!scopeView} onClick={() => setScopeView(false)}>{t("Document")}</button>{!scopeView && documentPages.map((page, index) => <button key={page.id} type="button" aria-current={active === page.id ? 'page' : undefined} onClick={() => { setActive(page.id); document.getElementById(`document-page-${page.id}`)?.scrollIntoView({ block: 'start', behavior: 'instant' }); }}>{index + 1}</button>)}</div>
    {!readOnly && <label className={styles.addPage}><Plus size={14}/><select aria-label={t("Add page")} value="" disabled={busy || pages.length >= 40 || design.pages.length >= 40} onChange={event => addPage(event.target.value)}><option value="" disabled>{t("Add page")}</option><option value="blank">{t("Blank page")}</option><option value="introduction">{t("Introduction")}</option><option value="closing">{t("Closing page")}</option>{['payments', 'acceptance'].filter(id => !pages.includes(id)).map(id => <option key={id} value={id}>{t(labels[id])}</option>)}</select></label>}
    <details className={styles.pageMenu} ref={pagesMenu.ref}><summary>{t("Pages")}</summary><div><small>{t("Include in preview and document")}</small>{pages.map(id => <Checkbox key={id} aria-label={t('Include {title}', { title: title(id) })} isSelected={!design.hiddenPages?.includes(id)} isDisabled={readOnly || busy} onChange={included => change({ ...draft, presentation: { ...design, hiddenPages: included ? (design.hiddenPages ?? []).filter(hidden => hidden !== id) : [...(design.hiddenPages ?? []), id] } }, true)}>{title(id)}</Checkbox>)}</div></details>
    {!readOnly && <details className={styles.pageMenu} onClick={pageOptionsMenu.onClick} ref={pageOptionsMenu.ref}><summary aria-label={t("Page options")}>•••</summary><div>
     <button type="button" disabled={busy} onClick={() => requestConfirmation({ title: t('Use the standard layout?'), body: t('This replaces the page designs with the standard layout, filled from your brand and proposal kit. Your scope, prices, terms and payment schedule stay unchanged. You can undo this change.'), confirmLabel: t('Use standard layout'), onConfirm: () => { const next = { ...draft, terms: referenceTermsFor(draft, initial.proposalKit) }; change({ ...next, presentation: referencePresentation(next, initial.portalBrand?.name ?? '', initial.customerName, initial) }, true); setActive('cover'); setScopeView(false); } })}>{t("Use standard layout")}</button>
     <button type="button" disabled={busy || pages.indexOf(active) === 0} onClick={() => move(-1)}><ArrowLeft size={14}/>{t("Move earlier")}</button>
     <button type="button" disabled={busy || pages.indexOf(active) === pages.length - 1} onClick={() => move(1)}><ArrowRight size={14}/>{t("Move later")}</button>
     {custom && <button type="button" disabled={busy || pages.length >= 40 || design.pages.length >= 40} onClick={duplicate}><Copy size={14}/>{t("Duplicate page")}</button>}
     {!active.startsWith('items:') && !['scope', 'cover', 'terms'].includes(active) && <button type="button" disabled={busy} onClick={() => { requestConfirmation({ title: t('Remove {title}?', { title: title(active) }), body: t('You can undo this change.'), confirmLabel: t('Remove page'), onConfirm: () => { change({ ...draft, presentation: { ...design, pageOrder: pages.filter(id => id !== active), pages: design.pages.filter(page => page.id !== active), hiddenPages: design.hiddenPages?.filter(id => id !== active) } }, true); setActive('cover'); } }); }}><Trash2 size={14}/>{t("Remove page")}</button>}
    </div></details>}
   </div>}
  {error && <p role="alert" className={styles.error}>{translateKnown(t, error)}</p>}
  {preview ? <QuotationBuilderPreview initialPageId={active} allPages fitWidth quote={{ ...draft, letterhead: draft.letterhead ?? initial.portalLetterhead ?? null }} brand={initial.portalBrand} customerName={initial.customerName}/> : <div id="builder-panel" className={styles.canvas}>
   {active === 'payments' && <div className={styles.scopeControls}><button type="button" onClick={() => (embedded ? embedded.onPayments() : setPaymentEditor(true))}>{t(readOnly ? 'View payment schedule' : 'Edit payment schedule')}</button><span>{t("{count} milestones · {percent}% allocated", { count: draft.paymentTerms.length, percent: draft.paymentTerms.reduce((sum, term) => sum + term.percent, 0).toFixed(2) })}</span></div>}
   {scopeView && !readOnly && <div className={styles.scopeControls}><button type="button" disabled={busy} onClick={async () => { if (await save())
            setScopeImport(true); }}>{t("Import requirements")}</button></div>}
   {scopeView ? <QuotationScopeGrid quote={draft} onChange={change} readOnly={readOnly || busy} workspaceId={initial.workspaceId} caseId={initial.caseId} canOverridePrice={Boolean(initial.canOverridePrice)}/> : canvas}

  </div>}
  {detailsOpen && <QuotationDocumentDetails quote={draft} readOnly={readOnly || busy} onChange={change} onClose={() => setDetailsOpen(false)}/>}
  <ScopeImport workspaceId={initial.workspaceId} caseId={initial.caseId} quote={draft} open={scopeImport} onClose={() => setScopeImport(false)} busy={busy} run={importScope}/>
  <ControlledModalDialog title={t("Convert quotation to template")} isOpen={templateOpen} onOpenChange={open => { if (!converting)
        setTemplateOpen(open); }} size="md">
   <div className={styles.templateForm}>{templateCreated ? <><p role="status">{t("Template created. It is available in Quotation Templates.")}</p><Link href="/workspace/pre-projects/quotation-templates">{t("Open quotation templates")}</Link></> : <><p>{t("Save the rooms, items, rates, payment schedule and page designs as a reusable template. Your original quotation stays available.")}</p><label>{t("Template name")}<input maxLength={160} value={templateName} disabled={converting} onChange={event => setTemplateName(event.target.value)}/></label>{!draft.lines.length && <p>{t("Add at least one quotation item before converting.")}</p>}{templateError && <p role="alert">{translateKnown(t, templateError)}</p>}<button type="button" disabled={converting || !templateName.trim() || !draft.lines.length} onClick={() => void convertTemplate()}>{t(converting ? 'Converting…' : 'Create template')}</button></>}</div>
  </ControlledModalDialog>
  <ControlledModalDialog title={t("Payment schedule")} isOpen={paymentEditor} onOpenChange={setPaymentEditor} size="lg" footer={<button type="button" onClick={() => setPaymentEditor(false)}>{t("Done")}</button>}><QuotationPaymentEditor quote={draft} onChange={change} readOnly={readOnly || busy}/></ControlledModalDialog>
  {exporting && <QuotationPdfExport quote={{ ...draft, letterhead: draft.letterhead ?? initial.portalLetterhead ?? null }} brand={initial.portalBrand} customerName={initial.customerName} onDone={() => setExporting(false)} onError={message => { setError(message); setExporting(false); }}/>}

 {confirmationDialog}
 </section>
 </CatalogOptionsProvider>;
}
