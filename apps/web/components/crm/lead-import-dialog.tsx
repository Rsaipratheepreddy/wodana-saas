"use client";

import { useState } from "react";
import { Button, Callout, ControlledModalDialog, FileUploader, Form, FormSection, SelectField } from "@/design-system";
import type { LeadsPageData } from "@/lib/crm/leads";
import type { LeadOption } from "@/lib/crm/lead-options";
import { matchCsvHeader, parseLeadCsv, type CsvTable } from "@/lib/crm/import-csv";
import { administrativeAreaLabel, countryFromLocale } from "@/lib/workspace/region-labels";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey } from "@/lib/i18n/keys";
import styles from "./lead-import-dialog.module.css";

type Field = "displayName" | "mobile" | "emirate" | "serviceType" | "area" | "email" | "source" | "channel" | "mobileCountryCode";
const baseFields: Array<{ id: Field; label: MessageKey; names: string[]; required?: boolean }> = [
  { id: "displayName", label: tKey("Customer name"), names: ["customer name", "name", "client name", "full name"], required: true },
  { id: "mobile", label: tKey("Mobile"), names: ["mobile", "mobile number", "phone number", "phone"], required: true },
  { id: "emirate", label: tKey("Region"), names: ["emirate", "emirates", "region", "state", "province", "county"], required: true },
  { id: "serviceType", label: tKey("Enquiry type"), names: ["enquiry type", "service type", "service required"], required: true },
  { id: "area", label: tKey("Area"), names: ["area", "community", "neighbourhood"] },
  { id: "email", label: tKey("Email"), names: ["email", "email address"] },
  { id: "source", label: tKey("Source per row"), names: ["source", "lead source"] },
  { id: "channel", label: tKey("Channel per row"), names: ["channel", "lead channel"] },
  { id: "mobileCountryCode", label: tKey("Mobile country (ISO code)"), names: ["mobile country code", "country code", "country"] },
];
type RowResult = { status: "created" | "error"; message: string };

function findOption(value: string, choices: LeadOption[] | undefined) {
  const normalized = value.trim().toLocaleLowerCase();
  return choices?.find(option => option.id.toLocaleLowerCase() === normalized || option.label.toLocaleLowerCase() === normalized)?.id;
}

export function LeadImportDialog({ initialData, onClose, onImported }: { initialData: LeadsPageData; onClose: () => void; onImported: () => Promise<void> }) {
  const t = useT();
  const [table, setTable] = useState<CsvTable>();
  const [filename, setFilename] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [mapping, setMapping] = useState<Record<Field, string>>({ displayName: "", mobile: "", emirate: "", serviceType: "", area: "", email: "", source: "", channel: "", mobileCountryCode: "" });
  const [source, setSource] = useState("");
  const [channel, setChannel] = useState("");
  const [results, setResults] = useState<Record<number, RowResult>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const options = initialData.leadOptions;
  // The region column takes the country's own word and is needed only when the workspace lists regions.
  const regionLabel = administrativeAreaLabel(countryFromLocale(initialData.defaultLocale));
  const hasRegions = Boolean(options?.emirates.length);
  const fields = baseFields.map(field => field.id === "emirate" ? { ...field, label: translateKnown(t, regionLabel), names: [...field.names, regionLabel.toLowerCase()], required: hasRegions } : { ...field, label: t(field.label) });
  const value = (row: string[], field: Field) => row[table?.headers.indexOf(mapping[field]) ?? -1]?.trim() ?? "";
  const prepare = (row: string[], index: number) => {
    if (!options) throw new Error(t("Enquiry options are unavailable. Refresh and try again."));
    const displayName = value(row, "displayName"), mobile = value(row, "mobile");
    const emirate = hasRegions ? findOption(value(row, "emirate"), options.emirates) : value(row, "emirate");
    const serviceType = findOption(value(row, "serviceType"), options.enquiryTypes);
    const rowSource = value(row, "source") ? findOption(value(row, "source"), options.sources) : source;
    const rowChannel = value(row, "channel") ? findOption(value(row, "channel"), options.channels[rowSource ?? ""]) : options.channels[rowSource ?? ""]?.some(item => item.id === channel) ? channel : options.channels[rowSource ?? ""]?.[0]?.id;
    if (!displayName || !mobile || (hasRegions && !emirate) || !serviceType || !rowSource || !rowChannel || !options.channels[rowSource]?.some(item => item.id === rowChannel)) throw new Error(hasRegions ? t("Row {row}: check customer name, mobile, {region}, enquiry type, source and channel.", { row: index + 2, region: translateKnown(t, regionLabel) }) : t("Row {row}: check customer name, mobile, enquiry type, source and channel.", { row: index + 2 }));
    const areaText = value(row, "area");
    const area = areaText ? findOption(areaText, options.areas[emirate ?? ""]) ?? areaText : "";
    const country = value(row, "mobileCountryCode").toUpperCase();
    if (country && !/^[A-Z]{2}$/.test(country)) throw new Error(t("Row {row}: use a two-letter country code, such as {example}.", { row: index + 2, example: countryFromLocale(initialData.defaultLocale) ?? "GB" }));
    return {
      workspaceId: initialData.workspaceId, requestId, rowIndex: index + 1, filename,
      source: rowSource, channel: rowChannel, serviceType,
      party: { displayName, mobile, ...(value(row, "email") ? { email: value(row, "email") } : {}), ...(country ? { mobileCountryCode: country } : {}) },
      details: { emirate, area },
    };
  };
  const loadFile = async (file?: File) => {
    if (!file) return;
    setFailure(""); setTable(undefined); setResults({});
    if (file.size > 1_000_000) { setFailure(t("Choose a CSV file under 1 MB.")); return; }
    try {
      const parsed = parseLeadCsv(await file.text());
      setTable(parsed); setFilename(file.name); setRequestId(crypto.randomUUID());
      setMapping(Object.fromEntries(fields.map(field => [field.id, matchCsvHeader(parsed.headers, field.names)])) as Record<Field, string>);
    } catch (error) { setFailure(error instanceof Error ? translateKnown(t, error.message) : t("The CSV could not be read.")); }
  };
  const importRows = async () => {
    if (!table || !options || busy) return;
    setBusy(true); setFailure("");
    const next = { ...results };
    let imported = false;
    for (const [index, row] of table.rows.entries()) {
      if (next[index]?.status === "created") continue;
      try {
        const payload = prepare(row, index);
        const response = await fetch("/api/workspace/crm/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const result = await response.json();
        if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(". ") : result.message ?? t("The row could not be imported."));
        // Every accepted row is an enquiry now: a possible existing client is created at once and waits as "Confirm client".
        next[index] = { status: "created", message: String(result.reference ?? t("Enquiry created")) };
        imported = true;
      } catch (error) { next[index] = { status: "error", message: error instanceof Error ? error.message : t("The row could not be imported.") }; }
      setResults({ ...next });
    }
    if (imported) await onImported().catch(() => setFailure(t("Rows were imported. Refresh the list to see them.")));
    setBusy(false);
  };
  const counts = Object.values(results).reduce((totals, result) => ({ ...totals, [result.status]: totals[result.status] + 1 }), { created: 0, error: 0 });
  const complete = Boolean(table && Object.keys(results).length === table.rows.length && counts.error === 0);
  return <ControlledModalDialog isOpen title={t("Import enquiries")} size="lg" isDismissable={!busy} onOpenChange={open => { if (!open && !busy) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button isDisabled={busy} onPress={onClose}>{t("Close")}</Button><Button variant="primary" isDisabled={!table || !options || busy || complete || fields.some(field => field.required && !mapping[field.id]) || !source || !channel} isLoading={busy} onPress={() => void importRows()}>{complete ? t("Import complete") : Object.keys(results).length ? t("Retry failed rows") : t("Import enquiries")}</Button></div>}>
    <Form className={styles.importBody} onSubmit={event => event.preventDefault()}>
      {failure ? <Callout title={t("Import needs attention")} tone="warning">{failure}</Callout> : null}
      <FileUploader accept=".csv,text/csv" appearance="button" label={t("CSV file")} multiple={false} onFiles={files => void loadFile(files[0])} />
      {table ? <>
        <p className={styles.file}>{table.rows.length === 1 ? t("{filename} · {count} row", { filename, count: table.rows.length }) : t("{filename} · {count} rows", { filename, count: table.rows.length })}</p>
        <FormSection title={t("Columns")}>{fields.map(field => <SelectField isRequired={field.required} key={field.id} label={field.label} items={[{ id: "", label: field.required ? t("Choose column") : t("Not in file") }, ...table.headers.map(header => ({ id: header, label: header }))]} selectedKey={mapping[field.id]} onSelectionChange={key => setMapping(previous => ({ ...previous, [field.id]: String(key ?? "") }))} />)}</FormSection>
        <FormSection title={t("Source")}><SelectField isRequired label={t("Default source")} items={options?.sources ?? []} selectedKey={source || null} onSelectionChange={key => { const selected = String(key ?? ""); setSource(selected); setChannel(options?.channels[selected]?.[0]?.id ?? ""); }} /><SelectField isRequired label={t("Default channel")} items={options?.channels[source] ?? []} selectedKey={channel || null} onSelectionChange={key => setChannel(String(key ?? ""))} /></FormSection>
        <FormSection title={t("Preview")}><div className={styles.preview}>{table.rows.slice(0, 5).map((row, index) => <p key={index}>{t("Row {row}: {values}", { row: index + 2, values: ["displayName", "mobile", "emirate", "serviceType"].map(field => value(row, field as Field) || "—").join(" · ") })}</p>)}</div></FormSection>
        {Object.keys(results).length ? <div role="status" className={styles.summary}>{t("{created} created · {failed} failed", { created: counts.created, failed: counts.error })}</div> : null}
        {Object.entries(results).filter(([, result]) => result.status !== "created").slice(0, 20).map(([index, result]) => <p key={index} className={styles.rowResult}>{t("Row {row}: {message}", { row: Number(index) + 2, message: result.message })}</p>)}
      </> : null}
    </Form>
  </ControlledModalDialog>;
}
