"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { Building2, CheckCircle2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Callout, ConfirmationDialog, SelectField, TextInput, useDesignSystem, FormDialog } from "@/design-system";
import { countryFromLocale } from "@/lib/workspace/region-labels";
import { TaxNumberingSheet } from "./tax-numbering-sheet";
import type { CompanyAddress, LegalEntityRecord, WorkspaceRecord } from "@/lib/workspace/company-profile";
import { countryOptions, currencyOptions, localeOptions, timeZoneOptions } from "@/lib/workspace/regional-options";
import styles from "./company-profile.module.css";

type LegalEntityDraft = {
  code: string;
  displayName: string;
  registeredName: string;
  countryCode: string;
  baseCurrency: string;
  locale: string;
  timezone: string;
  registrationNumber: string;
  taxRegistrationNumber: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
};

function addressValue(address: CompanyAddress, key: keyof CompanyAddress) {
  return typeof address[key] === "string" ? address[key] : "";
}

function codeFromName(value: string) {
  const code = value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
  return code.length >= 2 ? code : "";
}

function createDraft(workspace: WorkspaceRecord, entity?: LegalEntityRecord, template?: LegalEntityRecord): LegalEntityDraft {
  if (entity) return {
    code: entity.code,
    displayName: entity.displayName,
    registeredName: entity.registeredName,
    countryCode: entity.countryCode,
    baseCurrency: entity.baseCurrency,
    locale: entity.locale,
    timezone: entity.timezone,
    registrationNumber: entity.registrationNumber ?? "",
    taxRegistrationNumber: entity.taxRegistrationNumber ?? "",
    line1: addressValue(entity.address, "line1"),
    line2: addressValue(entity.address, "line2"),
    city: addressValue(entity.address, "city"),
    region: addressValue(entity.address, "region"),
    postalCode: addressValue(entity.address, "postalCode"),
  };
  return {
    code: "",
    displayName: "",
    registeredName: "",
    countryCode: template?.countryCode ?? countryFromLocale(workspace.defaultLocale) ?? "",
    baseCurrency: template?.baseCurrency ?? workspace.defaultCurrency,
    locale: template?.locale ?? workspace.defaultLocale,
    timezone: template?.timezone ?? workspace.defaultTimezone,
    registrationNumber: "",
    taxRegistrationNumber: "",
    line1: "",
    line2: "",
    city: "",
    region: "",
    postalCode: "",
  };
}

function optionalAddress(draft: LegalEntityDraft) {
  const address = {
    line1: draft.line1.trim(), line2: draft.line2.trim(), city: draft.city.trim(),
    region: draft.region.trim(), postalCode: draft.postalCode.trim(),
  };
  return Object.values(address).some(Boolean) ? address : undefined;
}

function responseMessage(response: Response, fallback: string) {
  return response.json()
    .then((payload: { message?: string } | null) => payload?.message ?? fallback)
    .catch(() => fallback);
}

function displayRegion(code: string, locale: string) {
  try { return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code; } catch { return code; }
}

export function LegalEntitiesPanel({
  canManage,
  initialEntities,
  standalone = false,
  workspace,
  onChange,
}: {
  canManage: boolean;
  initialEntities: LegalEntityRecord[];
  standalone?: boolean;
  workspace: WorkspaceRecord;
  onChange: (entities: LegalEntityRecord[]) => void;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [entities, setEntities] = useState(initialEntities);
  const [editing, setEditing] = useState<LegalEntityRecord | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<LegalEntityRecord | null>(null);
  const [draft, setDraft] = useState<LegalEntityDraft>(() => createDraft(workspace));
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const countries = useMemo(() => countryOptions(workspace.defaultLocale), [workspace.defaultLocale]);
  const currencies = useMemo(() => currencyOptions(workspace.defaultLocale), [workspace.defaultLocale]);
  const locales = useMemo(() => localeOptions, []);
  const timezones = useMemo(() => timeZoneOptions(), []);
  const existing = editing && editing !== "new" ? editing : null;

  useEffect(() => {
    setEntities(initialEntities);
  }, [initialEntities]);

  const commit = (next: LegalEntityRecord[]) => {
    setEntities(next);
    onChange(next);
  };

  const openCreate = () => {
    setDraft(createDraft(workspace, undefined, entities[0]));
    setError("");
    setEditing("new");
  };

  const openEdit = (entity: LegalEntityRecord) => {
    setDraft(createDraft(workspace, entity));
    setError("");
    setEditing(entity);
  };

  const updateDisplayName = (displayName: string) => {
    setDraft((current) => ({
      ...current,
      displayName,
      registeredName: !current.registeredName || current.registeredName === current.displayName ? displayName : current.registeredName,
      code: !existing && (!current.code || current.code === codeFromName(current.displayName)) ? codeFromName(displayName) : current.code,
    }));
    setError("");
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || saving) return;
    const code = draft.code.trim().toUpperCase();
    const displayName = draft.displayName.trim();
    const registeredName = draft.registeredName.trim();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(code)) { setError(t("Entity code must be 2–24 letters, numbers, hyphens, or underscores.")); return; }
    if (displayName.length < 2 || registeredName.length < 2) { setError(t("Enter a display name and registered company name.")); return; }
    if (!/^[A-Z]{2}$/.test(draft.countryCode) || !/^[A-Z]{3}$/.test(draft.baseCurrency) || !draft.locale || !draft.timezone) { setError(t("Choose country, currency, locale, and time zone.")); return; }
    setSaving(true);
    setError("");
    setNotice("");
    const payload = {
      workspaceId: workspace.id,
      ...(existing ? { version: existing.version } : { code }),
      displayName,
      registeredName,
      countryCode: draft.countryCode,
      baseCurrency: draft.baseCurrency,
      locale: draft.locale,
      timezone: draft.timezone,
      registrationNumber: draft.registrationNumber.trim(),
      taxRegistrationNumber: draft.taxRegistrationNumber.trim(),
      address: optionalAddress(draft),
    };
    try {
      const response = await fetch(existing ? `/api/workspace/legal-entities/${existing.id}` : "/api/workspace/legal-entities", {
        method: existing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await responseMessage(response, t("The business record could not be saved.")));
      const saved = await response.json() as LegalEntityRecord;
      commit(existing ? entities.map((entity) => entity.id === saved.id ? saved : entity) : [...entities, saved]);
      setEditing(null);
      setNotice(existing ? t("{name} updated.", { name: saved.displayName }) : t("{name} added.", { name: saved.displayName }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("The business record could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!archiveTarget || archiving) return;
    setArchiving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/workspace/legal-entities/${archiveTarget.id}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id, version: archiveTarget.version }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, t("The business record could not be archived.")));
      const archived = await response.json() as LegalEntityRecord;
      commit(entities.filter((entity) => entity.id !== archived.id));
      setArchiveTarget(null);
      setNotice(t("{name} archived.", { name: archived.displayName }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("The business record could not be archived."));
      setArchiveTarget(null);
    } finally {
      setArchiving(false);
    }
  };

  return <>
    <section aria-label={standalone ? t("Business records") : undefined} aria-labelledby={standalone ? undefined : "legal-entities-heading"} className={`${styles.detailSection} ${styles.legalEntitiesSection}`}>
      <header>
        <div>{standalone ? <h2 className={styles.standaloneHeading}>{t("Businesses")}</h2> : <><h2 id="legal-entities-heading">{t("Business records")}</h2><p className={styles.sectionHint}>{t("Official company, trade-license and tax details used on contracts and invoices.")}</p></>}</div>
        {canManage ? <Button onPress={openCreate} size="compact" variant="secondary"><Plus aria-hidden="true" size={15} />{t("Add business")}</Button> : null}
      </header>
      {notice ? <p aria-live="polite" className={styles.organizationNotice}><CheckCircle2 aria-hidden="true" size={14} />{notice}</p> : null}
      {error ? <Callout title={t("Business record action failed")} tone="danger">{error}</Callout> : null}
      <ul aria-label={t("Active legal entities")} className={styles.legalEntityList}>
        {entities.map((entity) => <li key={entity.id}>
          <span aria-hidden="true" className={styles.organizationIcon}><Building2 size={15} /></span>
          <div className={styles.legalEntityDetails}>
            <strong>{entity.displayName}</strong>
            <small>{entity.code} · {entity.registeredName}</small>
            <small>{displayRegion(entity.countryCode, locale)} · {entity.baseCurrency} · {entity.timezone}</small>
          </div>
          <Badge tone={entity.status === "active" ? "success" : "neutral"}>{entity.status === "active" ? t("Active") : t("Archived")}</Badge>
          <TaxNumberingSheet canManage={canManage} entityId={entity.id} entityName={entity.displayName} workspaceId={workspace.id} />
          {canManage ? <div className={styles.legalEntityActions}>
            <Button aria-label={t("Edit {name}", { name: entity.displayName })} onPress={() => openEdit(entity)} size="compact" variant="quiet"><Pencil aria-hidden="true" size={14} />{t("Edit")}</Button>
            {entities.length > 1 ? <Button aria-label={t("Archive {name}", { name: entity.displayName })} onPress={() => setArchiveTarget(entity)} size="compact" variant="quiet"><Trash2 aria-hidden="true" size={14} />{t("Archive")}</Button> : null}
          </div> : null}
        </li>)}
      </ul>
      {entities.length === 1 && canManage ? <p className={styles.permissionNote}>{t("At least one active business record is required for a workspace.")}</p> : null}
    </section>

    <FormDialog isOpen={Boolean(editing)} size="lg" title={existing ? t("Edit {name}", { name: existing.displayName }) : t("Add business")} description={existing ? t("Update the official details and defaults for this business.") : t("Add official business details for documents, operating units and integrations.")} onClose={() => { setEditing(null); }} isSubmitting={saving} submitLabel={existing ? t("Save business") : t("Add business")} onSubmit={save} formClassName={styles.legalEntityForm}>

        {error ? <Callout title={t("Could not save business record")} tone="danger">{error}</Callout> : null}
        <div className={styles.formGrid}>
          <TextInput isDisabled={Boolean(existing)} isRequired label={t("Entity code")} onChange={(code) => { setDraft((current) => ({ ...current, code: code.toUpperCase() })); setError(""); }} placeholder={t("PALM_LIVING")} value={draft.code} />
          <TextInput isRequired label={t("Display name")} onChange={updateDisplayName} placeholder={t("Palm Living")} value={draft.displayName} />
          <div className={styles.fullField}><TextInput isRequired label={t("Registered company name")} onChange={(registeredName) => { setDraft((current) => ({ ...current, registeredName })); setError(""); }} value={draft.registeredName} /></div>
          <SelectField isRequired items={countries} label={t("Country / region")} onSelectionChange={(key) => key && setDraft((current) => ({ ...current, countryCode: String(key) }))} selectedKey={draft.countryCode} />
          <SelectField isRequired items={currencies} label={t("Base currency")} onSelectionChange={(key) => key && setDraft((current) => ({ ...current, baseCurrency: String(key) }))} selectedKey={draft.baseCurrency} />
          <SelectField isRequired items={locales} label={t("Language & format")} onSelectionChange={(key) => key && setDraft((current) => ({ ...current, locale: String(key) }))} selectedKey={draft.locale} />
          <SelectField isRequired items={timezones} label={t("Time zone")} onSelectionChange={(key) => key && setDraft((current) => ({ ...current, timezone: String(key) }))} selectedKey={draft.timezone} />
          <TextInput label={t("Registration number")} onChange={(registrationNumber) => setDraft((current) => ({ ...current, registrationNumber }))} value={draft.registrationNumber} />
          <TextInput label={t("Tax registration number")} onChange={(taxRegistrationNumber) => setDraft((current) => ({ ...current, taxRegistrationNumber }))} value={draft.taxRegistrationNumber} />
          <div className={styles.fullField}><TextInput label={t("Address line 1")} onChange={(line1) => setDraft((current) => ({ ...current, line1 }))} value={draft.line1} /></div>
          <div className={styles.fullField}><TextInput label={t("Address line 2")} onChange={(line2) => setDraft((current) => ({ ...current, line2 }))} value={draft.line2} /></div>
          <TextInput label={t("City")} onChange={(city) => setDraft((current) => ({ ...current, city }))} value={draft.city} />
          <TextInput label={t("State / region")} onChange={(region) => setDraft((current) => ({ ...current, region }))} value={draft.region} />
          <TextInput label={t("Postal code")} onChange={(postalCode) => setDraft((current) => ({ ...current, postalCode }))} value={draft.postalCode} />
        </div>
      
</FormDialog>

    <ConfirmationDialog
      body={archiveTarget ? t("Archive {name}? Its operating units and integrations must already be reassigned or archived.", { name: archiveTarget.displayName }) : null}
      confirmLabel={archiving ? t("Archiving…") : t("Archive business")}
      isOpen={Boolean(archiveTarget)}
      onConfirm={() => void archive()}
      onOpenChange={(open) => { if (!open && !archiving) setArchiveTarget(null); }}
      title={t("Archive business record?")}
    />
  </>;
}
