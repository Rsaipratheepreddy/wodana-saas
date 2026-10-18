"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import {
  Button, ComboboxField, EmailInput, FileUploader, FormDialog, FormSection, IconButton, InlineNotice, MoneyField, SegmentedControl, SelectField, Switch, TextAreaField, TextInput,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FinanceRequestsApi } from "@/lib/finance-requests/client";
import type {
  ClientOption, FinanceRequestDetail, InvoiceKind, MaterialLocation, RequestContext, RequestKind, RequestOrigin,
} from "@/lib/finance-requests/types";
import { netOfTax } from "@/lib/finance-requests/amounts";
import { addExact, currencyDecimals, priceLine, subtractExact } from "@/lib/purchasing/amounts";
import { useProjectFormat } from "../project-core/format";
import { useInvoiceKindLabels, useKindLabels, useLocationLabels } from "./finance-request-labels";
import styles from "./finance-requests.module.css";

type Line = { key: string; description: string; amount: string };
const KINDS: RequestKind[] = ["invoice", "refund", "payable"];
const INVOICE_KINDS: InvoiceKind[] = ["standard", "progress", "web_order"];
const LOCATIONS: MaterialLocation[] = ["factory", "office", "project"];
const plain = (value: string | null | undefined) => (value ? (value.includes(".") ? value.replace(/\.?0+$/, "") : value) : "");
const newLine = (description = "", amount = ""): Line => ({ key: crypto.randomUUID(), description, amount });

/** Search as the person types (a short pause first), for clients, suppliers and projects. */
function useSearch<T>(load: (text: string) => Promise<T[]>, enabled: boolean) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const latest = useRef(load);
  useEffect(() => { latest.current = load; }, [load]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const timer = window.setTimeout(() => { latest.current(text.trim()).then((next) => { if (live) setItems(next); }).catch(() => { if (live) setItems([]); }); }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [text, enabled]);
  return { text, setText, items };
}

/**
 * Asking Finance for an invoice, a refund or a supplier payment (PLM-107–110). Raised from a client, deal or
 * project, those are filled; the client and the supplier are picked from their lists, never typed. An invoice is
 * tax-exclusive at the issuing company's rate. Sent again after Finance asked for more (`existing`).
 */
export function RequestForm({ api, origin = {}, existing, onClose, onSaved }: {
  api: FinanceRequestsApi; origin?: RequestOrigin; existing?: FinanceRequestDetail; onClose: () => void; onSaved: (detail: FinanceRequestDetail) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const kindLabels = useKindLabels();
  const invoiceKinds = useInvoiceKindLabels();
  const locations = useLocationLabels();
  const request = existing?.request;
  const [id] = useState(() => request?.id ?? crypto.randomUUID());
  const [kind, setKind] = useState<RequestKind>(request?.kind ?? "invoice");
  const [context, setContext] = useState<RequestContext | null>(null);
  const [loadError, setLoadError] = useState("");
  const [client, setClient] = useState<ClientOption | null>(request?.partyId ? { id: request.partyId, name: request.clientName ?? "", type: request.clientType ?? "person", email: request.clientEmail } : null);
  const [opportunityId, setOpportunityId] = useState(request?.opportunityId ?? origin.opportunityId ?? "");
  const [deals, setDeals] = useState<Array<{ id: string; reference: string; title: string }>>([]);
  const [clientEmail, setClientEmail] = useState(request?.clientEmail ?? "");
  const [clientTaxNumber, setClientTaxNumber] = useState(request?.clientTaxNumber ?? "");
  const [legalEntityId, setLegalEntityId] = useState(request?.legalEntityId ?? "");
  const [taxCode, setTaxCode] = useState(request?.taxCode ?? "");
  const [invoiceKind, setInvoiceKind] = useState<InvoiceKind>(request?.invoiceKind ?? "standard");
  const [paymentStageId, setPaymentStageId] = useState(request?.paymentStageId ?? "");
  const [quoteId, setQuoteId] = useState(request?.quoteId ?? "");
  const [paymentTerms, setPaymentTerms] = useState(request?.paymentTerms ?? "");
  const [contractReference, setContractReference] = useState(request?.contractReference ?? "");
  const [orderNumber, setOrderNumber] = useState(request?.orderNumber ?? "");
  const [orderGross, setOrderGross] = useState(plain(request?.orderGross));
  const [paymentMethodId, setPaymentMethodId] = useState(request?.paymentMethodId ?? "");
  const [paymentMethod, setPaymentMethod] = useState(request?.paymentMethod ?? "");
  const [lines, setLines] = useState<Line[]>(() => existing?.lines.length ? existing.lines.map((line) => newLine(line.description, plain(line.amount))) : [newLine()]);
  const [invoiceNumber, setInvoiceNumber] = useState(request?.invoiceNumber ?? "");
  const [reason, setReason] = useState(request?.reason ?? "");
  const [bankDetails, setBankDetails] = useState("");
  const [supplier, setSupplier] = useState<{ id: string; name: string; taxNumber: string | null; currency: string | null } | null>(
    request?.vendorId ? { id: request.vendorId, name: request.supplierName ?? "", taxNumber: request.supplierTaxNumber, currency: request.currency } : null);
  const [supplierReference, setSupplierReference] = useState(request?.supplierReference ?? "");
  const [totalAmount, setTotalAmount] = useState(request?.kind === "payable" ? plain(request.total) : "");
  const [payNowAmount, setPayNowAmount] = useState(plain(request?.payNow));
  const [authorisedBy, setAuthorisedBy] = useState(request?.authorisedBy ?? "");
  const [materialLocation, setMaterialLocation] = useState<MaterialLocation>(request?.materialLocation ?? (origin.projectId ? "project" : "factory"));
  const [project, setProject] = useState<{ id: string; label: string } | null>(request?.projectId ? { id: request.projectId, label: [request.projectReference, request.projectName].filter(Boolean).join(" · ") } : null);
  const [paidOnStatement, setPaidOnStatement] = useState(request?.paidOnStatement ?? false);
  const [remarks, setRemarks] = useState(request?.remarks ?? "");
  const [note, setNote] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<FinanceRequestDetail | null>(null);

  // The context: the record it's raised from, its deal's stages and quotes, companies and their tax, methods, people.
  const scope = useMemo<RequestOrigin>(() => ({ projectId: request?.projectId ?? origin.projectId, opportunityId: opportunityId || undefined, partyId: client?.id ?? origin.partyId }),
    [request?.projectId, origin.projectId, origin.partyId, opportunityId, client?.id]);
  useEffect(() => {
    let live = true;
    api.context(scope).then((next) => {
      if (!live) return;
      setContext(next);
      if (next.client) { setClient(next.client); setClientEmail((current) => current || next.client?.email || ""); }
      if (next.project) setProject((current) => current ?? { id: next.project!.id, label: [next.project!.reference, next.project!.name].filter(Boolean).join(" · ") });
      setLegalEntityId((current) => current || next.defaultCompanyId || "");
    }).catch((cause) => { if (live) setLoadError(cause instanceof Error ? cause.message : t("The form didn't load.")); });
    return () => { live = false; };
  }, [api, scope, t]);
  // A client picked here: their deals, so the request can name one.
  useEffect(() => {
    if (!client || origin.opportunityId || origin.projectId || request) return;
    let live = true;
    api.deals(client.id).then((next) => { if (live) setDeals(next); }).catch(() => undefined);
    return () => { live = false; };
  }, [api, client, origin.opportunityId, origin.projectId, request]);

  const fixedClient = Boolean(origin.partyId || origin.opportunityId || origin.projectId || request);
  const clients = useSearch((text) => api.clients(text), !fixedClient && kind !== "payable");
  const suppliers = useSearch((text) => api.suppliers(text), kind === "payable" && !request);
  const projects = useSearch((text) => api.projects(text), kind === "payable" && materialLocation === "project" && !origin.projectId);

  const company = context?.companies.find((item) => item.id === legalEntityId) ?? null;
  const rate = company?.rates.find((item) => item.code === taxCode) ?? company?.rates.find((item) => item.isDefault) ?? company?.rates[0] ?? null;
  const method = context?.methods.find((item) => item.id === paymentMethodId) ?? null;
  const currency = kind === "invoice" ? company?.currency ?? "" : kind === "payable" ? supplier?.currency || company?.currency || context?.currency || "" : context?.deal?.currency || context?.currency || "";
  const decimals = currencyDecimals(currency || "USD");
  const money = (value: string) => (currency ? format.money(value, currency) : value);
  const net = addExact(...lines.map((line) => line.amount));
  const invoiceTotals = rate ? priceLine({ quantity: "1", unitPrice: net, discountPercent: "0", taxRate: rate.rate }, decimals) : null;
  const balance = subtractExact(totalAmount, payNowAmount);
  const isCompany = client?.type === "organization";
  const taxNumberLabel = context?.taxNumberLabel ?? t("Tax registration number");

  const setLine = (key: string, patch: Partial<Line>) => setLines(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const pickStage = (stageId: string) => {
    setPaymentStageId(stageId);
    const stage = context?.stages.find((item) => item.id === stageId);
    if (!stage || !rate) return;
    // What the client pays at the stage includes tax; the request is before tax.
    setLines([newLine([stage.title, stage.trigger].filter(Boolean).join(" · "), netOfTax(stage.amount, rate.rate, decimals))]);
  };
  const pullQuote = async (id: string) => {
    setQuoteId(id); setError("");
    const dealId = opportunityId || context?.deal?.id;
    if (!id || !dealId) return;
    try { const quote = await api.quoteLines(dealId, id); setLines(quote.lines.map((line) => newLine(line.description, plain(line.unitPrice)))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load.")); }
  };

  const ready = Boolean(currency) && (kind === "payable"
    ? Boolean(supplier && supplierReference.trim() && totalAmount && payNowAmount && authorisedBy && legalEntityId && (materialLocation !== "project" || project))
    : Boolean(client && lines.length && lines.every((line) => line.description.trim() && line.amount)
      && (kind === "refund" ? invoiceNumber.trim() && reason.trim() && (paymentMethodId || paymentMethod.trim()) && (!method?.needsBankDetails || bankDetails.trim())
        : clientEmail.trim() && legalEntityId && rate && (!isCompany || clientTaxNumber.trim()))));

  const submit = async () => {
    setError("");
    const body: Record<string, unknown> = {
      id, kind, version: request?.version, currency, remarks, partyId: kind === "payable" ? undefined : client?.id, opportunityId: opportunityId || context?.deal?.id || undefined,
      projectId: kind === "payable" ? (materialLocation === "project" ? project?.id : origin.projectId ?? request?.projectId) : context?.project?.id ?? undefined,
      note: note.trim() || undefined,
    };
    if (kind === "invoice") Object.assign(body, { clientEmail, clientTaxNumber, legalEntityId, taxCode: rate?.code, invoiceKind, paymentStageId: paymentStageId || null, quoteId: quoteId || null,
      paymentTerms, contractReference, orderNumber, orderGross: invoiceKind === "web_order" ? orderGross : null, paymentMethodId: paymentMethodId || null, paymentMethod,
      lines: lines.map((line) => ({ description: line.description, quantity: "1", unitPrice: line.amount })) });
    if (kind === "refund") Object.assign(body, { clientEmail, invoiceNumber, reason, paymentMethodId: paymentMethodId || null, paymentMethod, bankDetails, legalEntityId: legalEntityId || null,
      lines: lines.map((line) => ({ description: line.description, unitPrice: line.amount })) });
    if (kind === "payable") Object.assign(body, { vendorId: supplier?.id, supplierReference, totalAmount, payNowAmount, authorisedBy, materialLocation, legalEntityId, paymentTerms, paidOnStatement });
    let detail = await api.command(request ? "resubmit" : "submit", body);
    if (attachment) detail = await api.upload(detail.request.id, "quote", attachment);
    setSaved(detail);
    onSaved(detail);
  };

  const title = request ? t("Answer Finance · {reference}", { reference: request.reference }) : t("New request to Finance");
  if (saved && !request) return <FormDialog size="lg" title={title} onClose={onClose} hideSubmit submitLabel={t("Send to Finance")} onSubmit={() => undefined} cancelLabel={t("Close")}>
    <InlineNotice tone="success" message={t("{reference} is with Finance.", { reference: saved.request.reference })} />
    <Link href={`/workspace/finance/requests?request=${saved.request.id}`}>{t("Open the request")}</Link>
  </FormDialog>;

  // The firm's payment methods (with their refund guidance), or typed where none are set up yet.
  const methodField = context?.methods.length ? <SelectField label={t("Payment method")} isRequired placeholder={t("Choose")} selectedKey={paymentMethodId || null}
    onSelectionChange={(key) => setPaymentMethodId(key ? String(key) : "")} items={context.methods.map((item) => ({ id: item.id, label: item.label }))} />
    : <TextInput label={t("Payment method")} isRequired maxLength={80} value={paymentMethod} onChange={setPaymentMethod} />;
  // PLM-109: a refund picks its refund method; each has its own guidance and timeline (Finance › Requests › Settings).
  const refundMethodField = context?.methods.length ? <SelectField label={t("Refund method")} isRequired placeholder={t("Choose")} selectedKey={paymentMethodId || null}
    onSelectionChange={(key) => setPaymentMethodId(key ? String(key) : "")} items={context.methods.map((item) => ({ id: item.id, label: item.label }))} />
    : <TextInput label={t("Refund method")} isRequired maxLength={80} value={paymentMethod} onChange={setPaymentMethod} />;

  const linesSection = <FormSection title={kind === "refund" ? t("Items not delivered") : t("Lines")}>
    <ul className={styles.lines}>
      {lines.map((line, index) => <li className={styles.line} key={line.key}>
        <TextInput label={index === 0 ? t("Description") : null} aria-label={index === 0 ? undefined : t("Description of line {number}", { number: index + 1 })} isRequired maxLength={500} value={line.description}
          onChange={(description) => setLine(line.key, { description })} />
        <MoneyField label={index === 0 ? (kind === "refund" ? t("Value") : t("Amount before tax")) : null} aria-label={index === 0 ? undefined : t("Amount of line {number}", { number: index + 1 })}
          currency={currency || undefined} allowNegative={kind === "invoice"} value={line.amount} onChange={(amount) => setLine(line.key, { amount })} />
        <IconButton aria-label={t("Remove line {number}", { number: index + 1 })} size="compact" variant="quiet" isDisabled={lines.length === 1}
          onPress={() => setLines(lines.filter((item) => item.key !== line.key))}><X aria-hidden="true" size={14} /></IconButton>
      </li>)}
    </ul>
    <div><Button size="compact" variant="quiet" onPress={() => setLines([...lines, newLine()])}><Plus aria-hidden="true" size={14} />{t("Add line")}</Button></div>
    {kind === "invoice" && invoiceTotals ? <dl className={styles.totals}>
      <div><dt>{t("Net")}</dt><dd>{money(invoiceTotals.net)}</dd></div>
      <div><dt>{t("{tax} {rate}%", { tax: company?.taxLabel ?? t("Tax"), rate: plain(rate?.rate) || "0" })}</dt><dd>{money(invoiceTotals.tax)}</dd></div>
      <div><dt>{t("Total")}</dt><dd><strong>{money(invoiceTotals.total)}</strong></dd></div>
    </dl> : null}
    {kind === "refund" ? <dl className={styles.totals}><div><dt>{t("To refund")}</dt><dd><strong>{money(net)}</strong></dd></div></dl> : null}
  </FormSection>;

  const clientField = fixedClient || !client && kind === "payable" ? null : <ComboboxField label={t("Client")} isRequired items={clients.items.map((item) => ({ id: item.id, label: item.name, description: item.email ?? undefined }))}
    inputValue={clients.text || client?.name || ""} onInputChange={clients.setText} selectedKey={client?.id ?? null}
    onSelectionChange={(key) => { const found = clients.items.find((item) => item.id === key); if (found) { setClient(found); setClientEmail(found.email ?? ""); setOpportunityId(""); clients.setText(""); } }} />;

  return <FormDialog size="lg" title={title} onClose={onClose} error={loadError || error || undefined} isDirty isSubmitDisabled={!ready || !context}
    submitLabel={t("Send to Finance")} onSubmit={submit}
    lead={context?.deal || context?.project ? <p className={styles.muted}>{[context.deal ? `${context.deal.reference} · ${context.deal.title}` : "",
      context.project ? [context.project.reference, context.project.name].filter(Boolean).join(" · ") : ""].filter(Boolean).join(" · ")}</p> : undefined}>
    {!request ? <SegmentedControl label={t("Request")} value={kind} onChange={(value) => setKind(value as RequestKind)} options={KINDS.map((item) => ({ id: item, label: kindLabels[item] }))} /> : null}
    {request && existing?.events.length ? <InlineNotice tone="info" message={[...existing.events].reverse().find((event) => event.kind === "needs_info")?.note || t("Finance asked for more.")} /> : null}

    {kind !== "payable" ? <FormSection title={t("Client")}>
      {fixedClient ? <TextInput label={t("Client")} value={client?.name ?? ""} isReadOnly /> : clientField}
      {!fixedClient && client && deals.length ? <SelectField label={t("Deal")} placeholder={t("Choose")} selectedKey={opportunityId || null}
        onSelectionChange={(key) => setOpportunityId(key ? String(key) : "")} items={deals.map((deal) => ({ id: deal.id, label: `${deal.reference} · ${deal.title}` }))} /> : null}
      <EmailInput label={t("Client email")} isRequired={kind === "invoice"} maxLength={320} value={clientEmail} onChange={setClientEmail} />
      {kind === "invoice" ? <TextInput label={taxNumberLabel} isRequired={isCompany} maxLength={120} value={clientTaxNumber} onChange={setClientTaxNumber}
        description={isCompany ? t("Required for a company client.") : undefined} /> : null}
      {kind === "invoice" && context?.deal?.salespersonName ? <TextInput label={t("Salesperson")} value={context.deal.salespersonName} isReadOnly /> : null}
    </FormSection> : null}

    {kind === "invoice" ? <FormSection title={t("Invoice")}>
      <SegmentedControl label={t("Kind of invoice")} value={invoiceKind} onChange={(value) => setInvoiceKind(value as InvoiceKind)}
        options={INVOICE_KINDS.map((item) => ({ id: item, label: invoiceKinds[item] }))} />
      <SelectField label={t("Issuing company")} isRequired placeholder={t("Choose")} selectedKey={legalEntityId || null}
        onSelectionChange={(key) => { setLegalEntityId(key ? String(key) : ""); setTaxCode(""); }} items={(context?.companies ?? []).map((item) => ({ id: item.id, label: item.name }))} />
      {company && !company.rates.length ? <InlineNotice tone="error" message={t("Set this company's tax rates in Settings → Tax and numbering first.")} /> : null}
      {company && company.rates.length > 1 ? <SelectField label={company.taxLabel} selectedKey={rate?.code ?? null} onSelectionChange={(key) => setTaxCode(key ? String(key) : "")}
        items={company.rates.map((item) => ({ id: item.code, label: `${item.label} · ${plain(item.rate)}%` }))} /> : null}
      {context?.stages.length ? <SelectField label={t("Payment stage")} placeholder={t("Choose")} selectedKey={paymentStageId || null}
        onSelectionChange={(key) => pickStage(key ? String(key) : "")}
        items={context.stages.map((stage) => ({ id: stage.id, label: stage.title, description: format.money(stage.amount, stage.currency || currency || "USD") }))} /> : null}
      {context?.quotes.length ? <SelectField label={t("Lines from a quote")} placeholder={t("Choose")} selectedKey={quoteId || null}
        onSelectionChange={(key) => void pullQuote(key ? String(key) : "")} items={context.quotes.map((quote) => ({ id: quote.id, label: quote.label }))} /> : null}
      <TextAreaField label={t("Payment terms and stages")} maxLength={1000} value={paymentTerms} onChange={setPaymentTerms} />
      {invoiceKind === "progress" ? <TextInput label={t("Contract or letterhead reference")} isRequired maxLength={200} value={contractReference} onChange={setContractReference} /> : null}
      {invoiceKind === "web_order" ? <>
        <TextInput label={t("Order number")} isRequired maxLength={80} value={orderNumber} onChange={setOrderNumber} />
        <MoneyField label={t("Order total")} isRequired currency={currency || undefined} value={orderGross} onChange={setOrderGross} />
      </> : null}
      {invoiceKind === "web_order" ? methodField : null}
      <FileUploader appearance="button" multiple={false} accept="application/pdf,image/*" label={attachment ? attachment.name : t("Attach the quote or BOQ")} onFiles={(files) => setAttachment(files[0] ?? null)} />
    </FormSection> : null}

    {kind === "refund" ? <FormSection title={t("Refund")}>
      <TextInput label={t("Client invoice number")} isRequired maxLength={80} value={invoiceNumber} onChange={setInvoiceNumber} />
      <TextAreaField label={t("Reason")} isRequired maxLength={2000} value={reason} onChange={setReason} />
      {refundMethodField}
      {method?.refundGuidance ? <InlineNotice tone="info" message={method.refundGuidance} /> : null}
      {method?.needsBankDetails ? <TextAreaField label={t("Client bank details")} isRequired maxLength={1000} value={bankDetails} onChange={setBankDetails}
        description={t("Only Finance sees these.")} /> : null}
      {method?.refundDays ? <p className={styles.muted}>{t("Expected about {days} days after approval.", { days: method.refundDays })}</p> : null}
    </FormSection> : null}

    {kind !== "payable" ? linesSection : null}

    {kind === "payable" ? <FormSection title={t("Supplier")}>
      {request ? <TextInput label={t("Supplier")} value={supplier?.name ?? ""} isReadOnly /> : <ComboboxField label={t("Supplier")} isRequired
        items={suppliers.items.map((item) => ({ id: item.id, label: item.name }))} inputValue={suppliers.text || supplier?.name || ""} onInputChange={suppliers.setText}
        selectedKey={supplier?.id ?? null} onSelectionChange={(key) => { const found = suppliers.items.find((item) => item.id === key); if (found) { setSupplier(found); suppliers.setText(""); } }} />}
      {supplier ? <TextInput label={taxNumberLabel} value={supplier.taxNumber ?? ""} isReadOnly description={supplier.taxNumber ? undefined : t("Not on the supplier's record.")} /> : null}
      <TextInput label={t("Supplier quote or invoice number")} isRequired maxLength={120} value={supplierReference} onChange={setSupplierReference} />
      <SelectField label={t("Paying company")} isRequired placeholder={t("Choose")} selectedKey={legalEntityId || null} onSelectionChange={(key) => setLegalEntityId(key ? String(key) : "")}
        items={(context?.companies ?? []).map((item) => ({ id: item.id, label: item.name }))} />
      <MoneyField label={t("Full amount")} isRequired currency={currency || undefined} value={totalAmount} onChange={setTotalAmount} />
      <MoneyField label={t("Pay now")} isRequired currency={currency || undefined} value={payNowAmount} onChange={setPayNowAmount} />
      {totalAmount && payNowAmount ? <dl className={styles.totals}><div><dt>{t("Balance")}</dt><dd>{money(balance)}</dd></div></dl> : null}
      <TextAreaField label={t("Payment terms")} maxLength={1000} value={paymentTerms} onChange={setPaymentTerms} />
      <SelectField label={t("Authorised by")} isRequired placeholder={t("Choose")} selectedKey={authorisedBy || null} onSelectionChange={(key) => setAuthorisedBy(key ? String(key) : "")}
        items={(context?.people ?? []).map((person) => ({ id: person.id, label: person.name }))} />
      <SegmentedControl label={t("Material needed at")} value={materialLocation} onChange={(value) => setMaterialLocation(value as MaterialLocation)}
        options={LOCATIONS.map((item) => ({ id: item, label: locations[item] }))} />
      {materialLocation === "project" ? (origin.projectId ? <TextInput label={t("Project")} value={project?.label ?? ""} isReadOnly />
        : <ComboboxField label={t("Project")} isRequired items={projects.items.map((item) => ({ id: item.id, label: [item.reference, item.name].filter(Boolean).join(" · ") }))}
          inputValue={projects.text || project?.label || ""} onInputChange={projects.setText} selectedKey={project?.id ?? null}
          onSelectionChange={(key) => { const found = projects.items.find((item) => item.id === key); if (found) { setProject({ id: found.id, label: [found.reference, found.name].filter(Boolean).join(" · ") }); projects.setText(""); } }} />) : null}
      <Switch isSelected={paidOnStatement} onChange={setPaidOnStatement}>{t("Paid on the monthly statement")}</Switch>
      <FileUploader appearance="button" multiple={false} accept="application/pdf,image/*" label={attachment ? attachment.name : t("Attach the supplier's quote")} onFiles={(files) => setAttachment(files[0] ?? null)} />
    </FormSection> : null}

    <TextAreaField label={kind === "payable" ? t("Remarks for the payee") : t("Remarks")} maxLength={2000} value={remarks} onChange={setRemarks} />
    {request ? <TextAreaField label={t("What changed")} maxLength={2000} value={note} onChange={setNote} /> : null}
  </FormDialog>;
}
