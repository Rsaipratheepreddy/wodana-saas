"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";
import {
  Button, Callout, ComboboxField, ConfirmationDialog, ControlledModalDialog,
  DesignSystemProvider, SelectField, TextInput, ValidationSummary,
} from "@/design-system";
import {
  type CompanyAddress, type CompanyProfileData, type CompanyProfileUpdate, type LegalEntityRecord,
} from "@/lib/workspace/company-profile";
import { countryOptions, currencyOptions, localeOptions, timeZoneOptions, type RegionalOption } from "@/lib/workspace/regional-options";
import styles from "./company-profile.module.css";
import { identityInitials, identityStyle } from "@/lib/brand/identity";

type ProfileForm = {
  name: string; registeredName: string; countryCode: string;
  registrationNumber: string; taxRegistrationNumber: string; line1: string; line2: string;
  city: string; region: string; postalCode: string; defaultCurrency: string;
  defaultLocale: string; defaultTimezone: string; unitSystem: string; weekStartsOn: string;
};
type FormErrors = Partial<Record<keyof ProfileForm, string>>;
type UploadSession = { assetId: string; uploadMode: "signed" | "application"; uploadUrl: string | null; uploadHeaders: Record<string, string> };

function valueFromAddress(address: CompanyAddress, key: keyof CompanyAddress): string {
  const value = address[key];
  return typeof value === "string" ? value : "";
}

function emptyForm(data: CompanyProfileData): ProfileForm {
  return {
    name: data.workspace.name, registeredName: "", countryCode: "",
    registrationNumber: "", taxRegistrationNumber: "", line1: "", line2: "", city: "", region: "", postalCode: "",
    defaultCurrency: data.workspace.defaultCurrency, defaultLocale: data.workspace.defaultLocale,
    defaultTimezone: data.workspace.defaultTimezone, unitSystem: data.workspace.unitSystem,
    weekStartsOn: String(data.workspace.weekStartsOn),
  };
}

function formFromProfile(data: CompanyProfileData, entity: LegalEntityRecord): ProfileForm {
  return {
    ...emptyForm(data), registeredName: entity.registeredName, countryCode: entity.countryCode,
    registrationNumber: entity.registrationNumber ?? "", taxRegistrationNumber: entity.taxRegistrationNumber ?? "",
    line1: valueFromAddress(entity.address, "line1"), line2: valueFromAddress(entity.address, "line2"),
    city: valueFromAddress(entity.address, "city"), region: valueFromAddress(entity.address, "region"),
    postalCode: valueFromAddress(entity.address, "postalCode"),
  };
}

function optionalValue(value: string | null | undefined): string { return value?.trim() || "Not provided"; }
function displayName(code: string, type: "region" | "currency"): string {
  try { return new Intl.DisplayNames(["en"], { type }).of(code) ?? code; } catch { return code; }
}
function streetAddress(address: CompanyAddress): string {
  const seen = new Set<string>();
  return [address.line1, address.line2]
    .map((value) => value?.trim())
    .filter((value): value is string => {
      if (!value) return false;
      const key = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
}

function measurementLabel(value: string): string {
  if (value === "metric") return "Metric";
  if (value === "imperial") return "Imperial";
  return "Mixed";
}

function weekStartLabel(value: number): string {
  return ({ 0: "Sunday", 1: "Monday", 6: "Saturday" } as Record<number, string>)[value] ?? "Monday";
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return <div className={styles.profileField}>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>;
}

function validate(form: ProfileForm): FormErrors {
  const errors: FormErrors = {};
  if (form.name.trim().length < 2) errors.name = "Enter a company name.";
  else if (form.name.trim().length > 160) errors.name = "Company name must be 160 characters or fewer.";
  if (form.registeredName.trim().length < 2) errors.registeredName = "Enter the registered company name.";
  else if (form.registeredName.trim().length > 200) errors.registeredName = "Registered name must be 200 characters or fewer.";
  if (!/^[A-Z]{2}$/.test(form.countryCode)) errors.countryCode = "Select the country where this company is registered.";
  if (form.registrationNumber.length > 100) errors.registrationNumber = "Registration number must be 100 characters or fewer.";
  if (form.taxRegistrationNumber.length > 100) errors.taxRegistrationNumber = "Tax registration number must be 100 characters or fewer.";
  if (!form.line1.trim()) errors.line1 = "Enter the registered street address.";
  else if (form.line1.length > 160) errors.line1 = "Address line must be 160 characters or fewer.";
  if (form.line2.length > 160) errors.line2 = "Address line must be 160 characters or fewer.";
  if (!form.city.trim()) errors.city = "Enter the city.";
  else if (form.city.length > 100) errors.city = "City must be 100 characters or fewer.";
  if (form.countryCode === "AE" && !form.region.trim()) errors.region = "Select an emirate.";
  else if (form.region.length > 100) errors.region = "State or region must be 100 characters or fewer.";
  if (form.countryCode !== "AE" && form.postalCode.length > 32) errors.postalCode = "Postal code must be 32 characters or fewer.";
  if (!/^[A-Z]{3}$/.test(form.defaultCurrency)) errors.defaultCurrency = "Select a base currency.";
  if (!form.defaultLocale) errors.defaultLocale = "Select a language and format.";
  if (!form.defaultTimezone) errors.defaultTimezone = "Select a time zone.";
  return errors;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  return payload?.message ?? fallback;
}

async function loadLocationOptions(countryCode: string, region: string | undefined, signal: AbortSignal): Promise<RegionalOption[]> {
  const params = new URLSearchParams({ countryCode });
  if (region) params.set("region", region);
  const response = await fetch(`/api/geo/locations?${params}`, { signal });
  const payload = await response.json().catch(() => null) as { items?: RegionalOption[]; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? "Location suggestions are unavailable.");
  return Array.isArray(payload?.items) ? payload.items : [];
}

function administrativeAreaLabel(countryCode: string): string {
  if (countryCode === "AE") return "Emirate";
  if (["AU", "BR", "IN", "MX", "US"].includes(countryCode)) return "State";
  if (countryCode === "CA") return "Province / territory";
  return "State / province / region";
}

export function CompanyProfile({
  canManage,
  initialData,
}: {
  canManage: boolean;
  initialData: CompanyProfileData;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [data, setData] = useState(initialData);
  const entity = data.legalEntities[0];
  const [form, setForm] = useState<ProfileForm>(() => entity ? formFromProfile(initialData, entity) : emptyForm(initialData));
  const [errors, setErrors] = useState<FormErrors>({});
  const [isOpen, setIsOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [removeLogoOpen, setRemoveLogoOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isRemovingLogo, setIsRemovingLogo] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [logoError, setLogoError] = useState("");
  const [status, setStatus] = useState("");
  const [regions, setRegions] = useState<RegionalOption[]>([]);
  const [cities, setCities] = useState<RegionalOption[]>([]);
  const [isLoadingRegions, setIsLoadingRegions] = useState(false);
  const [isLoadingCities, setIsLoadingCities] = useState(false);
  const [regionLookupFailed, setRegionLookupFailed] = useState(false);
  const [cityLookupFailed, setCityLookupFailed] = useState(false);

  const savedForm = useMemo(() => entity ? formFromProfile(data, entity) : form, [data, entity, form]);
  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm);
  const address = entity ? streetAddress(entity.address) : "";
  const hasAddress = Boolean(entity && [address, entity.address.city, entity.address.region, entity.address.postalCode].some((value) => value?.trim()));
  const countries = useMemo(() => countryOptions(data.workspace.defaultLocale), [data.workspace.defaultLocale]);
  const currencies = useMemo(() => currencyOptions(data.workspace.defaultLocale), [data.workspace.defaultLocale]);
  const timeZones = useMemo(() => timeZoneOptions(), []);
  const locales = useMemo(() => localeOptions.some((item) => item.id === form.defaultLocale) ? localeOptions : [{ id: form.defaultLocale, label: form.defaultLocale }, ...localeOptions], [form.defaultLocale]);
  const defaultLocaleLabel = localeOptions.find((item) => item.id === data.workspace.defaultLocale)?.label ?? data.workspace.defaultLocale;

  useEffect(() => {
    if (!isOpen || !form.countryCode) return;
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return [];
        setIsLoadingRegions(true);
        setRegionLookupFailed(false);
        setRegions([]);
        return loadLocationOptions(form.countryCode, undefined, controller.signal);
      })
      .then((items) => {
        if (controller.signal.aborted) return;
        setRegions(items);
        setRegionLookupFailed(items.length === 0);
      })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setRegionLookupFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setIsLoadingRegions(false); });
    return () => controller.abort();
  }, [form.countryCode, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    void Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return [];
        setCities([]);
        if (!form.region || regionLookupFailed) {
          setCityLookupFailed(regionLookupFailed);
          return null;
        }
        setIsLoadingCities(true);
        setCityLookupFailed(false);
        return loadLocationOptions(form.countryCode, form.region, controller.signal);
      })
      .then((items) => {
        if (items === null || controller.signal.aborted) return;
        setCities(items);
        setCityLookupFailed(items.length === 0);
      })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setCityLookupFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setIsLoadingCities(false); });
    return () => controller.abort();
  }, [form.countryCode, form.region, isOpen, regionLookupFailed]);

  const updateField = (key: keyof ProfileForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSaveError("");
  };
  const openEditor = () => {
    if (!entity) return;
    setForm(formFromProfile(data, entity)); setErrors({}); setSaveError(""); setLogoError(""); setIsOpen(true);
  };
  const requestEditorChange = (open: boolean) => {
    if (!open && isDirty) { setDiscardOpen(true); return; }
    setIsOpen(open);
  };
  const discardChanges = () => {
    if (entity) setForm(formFromProfile(data, entity));
    setDiscardOpen(false); setIsOpen(false); setErrors({}); setSaveError("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!entity || isSaving) return;
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setIsSaving(true); setSaveError(""); setStatus("");
    try {
      const response = await fetch("/api/workspace/company-profile", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: data.workspace.id, workspaceVersion: data.workspace.version,
          legalEntityId: entity.id, legalEntityVersion: entity.version,
          name: form.name.trim(), registeredName: form.registeredName.trim(),
          countryCode: form.countryCode, registrationNumber: form.registrationNumber.trim(),
          taxRegistrationNumber: form.taxRegistrationNumber.trim(), defaultCurrency: form.defaultCurrency,
          defaultLocale: form.defaultLocale, defaultTimezone: form.defaultTimezone,
          unitSystem: form.unitSystem, weekStartsOn: Number(form.weekStartsOn),
          address: { line1: form.line1.trim(), line2: form.line2.trim(), city: form.city.trim(), region: form.region.trim(), postalCode: form.postalCode.trim() },
        }),
      });
      const payload = await response.json().catch(() => null) as (Partial<CompanyProfileUpdate> & { message?: string }) | null;
      if (!response.ok || !payload?.workspace || !payload.legalEntity) { setSaveError(payload?.message ?? "The company profile could not be saved."); return; }
      const updated: CompanyProfileData = { ...data, workspace: payload.workspace, legalEntities: data.legalEntities.map((item) => item.id === payload.legalEntity?.id ? payload.legalEntity : item) };
      setData(updated); setForm(formFromProfile(updated, payload.legalEntity)); setStatus("Company profile saved."); setIsOpen(false); router.refresh();
    } catch { setSaveError("The company profile service is unavailable. Try again."); }
    finally { setIsSaving(false); }
  };

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || isUploadingLogo) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setLogoError("Choose a PNG, JPEG, or WebP image."); return; }
    if (file.size > 5 * 1024 * 1024) { setLogoError("Logo must be 5 MB or smaller."); return; }
    setIsUploadingLogo(true); setLogoError(""); setStatus("");
    try {
      const started = await fetch("/api/workspace/company-profile/logo-uploads", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: data.workspace.id, filename: file.name, mimeType: file.type, byteSize: file.size }),
      });
      if (!started.ok) throw new Error(await responseMessage(started, "The logo upload could not be started."));
      const session = await started.json() as UploadSession;
      const uploadUrl = session.uploadMode === "signed" && session.uploadUrl ? session.uploadUrl : `/api/workspace/company-profile/logo-uploads/${session.assetId}/content?workspaceId=${data.workspace.id}`;
      const uploaded = await fetch(uploadUrl, { method: "PUT", headers: session.uploadHeaders, body: file });
      if (!uploaded.ok) throw new Error(await responseMessage(uploaded, "The logo could not be uploaded."));
      const completed = await fetch(`/api/workspace/company-profile/logo-uploads/${session.assetId}/complete?workspaceId=${data.workspace.id}`, { method: "POST" });
      if (!completed.ok) throw new Error(await responseMessage(completed, "The logo could not be verified."));
      const branding = await completed.json() as { assetId: string; logoUrl: string; updatedAt: string };
      setData((current) => ({ ...current, branding: { ...current.branding, logoAssetId: branding.assetId, logoUrl: branding.logoUrl, logoUpdatedAt: branding.updatedAt } }));
      setStatus("Company logo updated."); router.refresh();
    } catch (error) { setLogoError(error instanceof Error ? error.message : "The logo could not be uploaded."); }
    finally { setIsUploadingLogo(false); }
  };

  const removeLogo = async () => {
    if (isRemovingLogo) return;
    setIsRemovingLogo(true); setLogoError("");
    try {
      const response = await fetch(`/api/workspace/company-profile/logo?workspaceId=${data.workspace.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseMessage(response, "The logo could not be removed."));
      setData((current) => ({ ...current, branding: { ...current.branding, logoAssetId: null, logoUrl: null, logoUpdatedAt: null } }));
      setRemoveLogoOpen(false); setStatus("Company logo removed."); router.refresh();
    } catch (error) { setLogoError(error instanceof Error ? error.message : "The logo could not be removed."); setRemoveLogoOpen(false); }
    finally { setIsRemovingLogo(false); }
  };

  return (
    <DesignSystemProvider className={styles.provider} currency={data.workspace.defaultCurrency} locale={data.workspace.defaultLocale} portalContainer={portalContainer} ref={setPortalContainer} timeZone={data.workspace.defaultTimezone}>
      <section aria-label="Company profile" className={styles.page}>
        <h1 className="wd-visually-hidden">Company profile</h1>
        {status ? <div aria-live="polite" className={styles.liveStatus}><CheckCircle2 aria-hidden="true" size={15} />{status}</div> : null}
        {logoError ? <Callout title="Could not update logo" tone="danger">{logoError}</Callout> : null}

        {!entity ? <Callout title="Business details required" tone="warning">Add business details before editing company settings.</Callout> : <div className={styles.settingList}>
          <section aria-labelledby="identity-details-heading" className={`${styles.settingCard} ${styles.profileHeader}`} id="company-information">
            <div className={styles.profileBody}>
              <div className={styles.logoControl}>
                <div className={styles.logoPreview} data-has-logo={data.branding.logoUrl ? true : undefined} style={data.branding.logoUrl ? undefined : identityStyle(data.workspace.id)}>
                  {data.branding.logoUrl ? <Image alt={`${data.workspace.name} logo`} height={112} src={data.branding.logoUrl} unoptimized width={112} /> : <span aria-hidden="true">{identityInitials(data.workspace.name)}</span>}
                </div>
              </div>
              <div className={styles.profileIdentity}>
                <div className={styles.cardHeader}><div><h2 id="identity-details-heading">{data.workspace.name}</h2><p>{entity.registeredName}</p></div>{canManage ? <Button onPress={openEditor} size="compact">Edit profile</Button> : null}</div>
                <dl className={styles.profileMeta}>
                  <ProfileField label="Company code" value={entity.code} />
                  <ProfileField label="Registered country" value={displayName(entity.countryCode, "region")} />
                </dl>
              </div>
            </div>
            <input accept="image/png,image/jpeg,image/webp" aria-label="Choose company logo" className={styles.fileInput} onChange={uploadLogo} ref={fileInput} type="file" />
          </section>

          <section aria-labelledby="legal-details-heading" className={styles.settingCard}>
            <header className={styles.cardHeader}><h2 id="legal-details-heading">Legal &amp; tax</h2></header>
            <dl className={styles.profileFields}>
              <ProfileField label="Registered country" value={displayName(entity.countryCode, "region")} />
              <ProfileField label="Registration number" value={optionalValue(entity.registrationNumber)} />
              <ProfileField label="Tax registration number" value={optionalValue(entity.taxRegistrationNumber)} />
            </dl>
          </section>

          <section aria-labelledby="address-details-heading" className={styles.settingCard} id="registered-office">
            <header className={styles.cardHeader}><h2 id="address-details-heading">Registered office</h2></header>
            <dl className={styles.profileFields}>
              <ProfileField label="Street address" value={hasAddress ? optionalValue(address) : "Not provided"} />
              <ProfileField label="City" value={optionalValue(entity.address.city)} />
              <ProfileField label="State / region" value={optionalValue(entity.address.region)} />
              <ProfileField label="Postal code" value={optionalValue(entity.address.postalCode)} />
            </dl>
          </section>

          <section aria-labelledby="defaults-heading" className={styles.settingCard} id="regional-settings">
            <header className={styles.cardHeader}><h2 id="defaults-heading">Regional defaults</h2></header>
            <dl className={styles.profileFields}>
              <ProfileField label="Base currency" value={`${data.workspace.defaultCurrency} · ${displayName(data.workspace.defaultCurrency, "currency")}`} />
              <ProfileField label="Language & format" value={defaultLocaleLabel} />
              <ProfileField label="Time zone" value={data.workspace.defaultTimezone} />
              <ProfileField label="Measurements" value={measurementLabel(data.workspace.unitSystem)} />
              <ProfileField label="Week starts on" value={weekStartLabel(data.workspace.weekStartsOn)} />
            </dl>
          </section>

        </div>}
        {!canManage ? <p className={styles.permissionNote}>Only workspace owners and administrators can edit this profile.</p> : null}
      </section>

      {entity ? <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button isDisabled={isSaving} onPress={() => requestEditorChange(false)}>Cancel</Button><Button form="company-profile-form" isLoading={isSaving} type="submit" variant="primary">Save</Button></div>} isOpen={isOpen} onOpenChange={requestEditorChange} size="lg" title="Edit profile">
        <form className={styles.editor} data-wd-density="compact" id="company-profile-form" noValidate onSubmit={submit}>
          <ValidationSummary errors={Object.values(errors).filter((error): error is string => Boolean(error))} />
          {saveError ? <Callout title="Could not save changes" tone="danger">{saveError}</Callout> : null}
          {logoError ? <Callout title="Could not update logo" tone="danger">{logoError}</Callout> : null}
          <div className={styles.formGrid}>
            <div className={styles.fullField}><div className={styles.logoFormActions}><div className={styles.logoFormPreview} data-has-logo={data.branding.logoUrl ? true : undefined} style={data.branding.logoUrl ? undefined : identityStyle(data.workspace.id)}>{data.branding.logoUrl ? <Image alt={`${data.workspace.name} logo`} height={56} src={data.branding.logoUrl} unoptimized width={56} /> : <span aria-hidden="true">{identityInitials(data.workspace.name)}</span>}</div><Button isDisabled={isUploadingLogo} isLoading={isUploadingLogo} onPress={() => fileInput.current?.click()}>Upload logo</Button>{data.branding.logoUrl ? <Button isDisabled={isUploadingLogo} onPress={() => setRemoveLogoOpen(true)} variant="quiet"><Trash2 aria-hidden="true" size={15} />Remove</Button> : null}</div></div>
            <div className={styles.fullField}><TextInput autoFocus errorMessage={errors.name} isInvalid={Boolean(errors.name)} isRequired label="Company name" onChange={(value) => updateField("name", value)} value={form.name} /></div>
            <div className={styles.fullField}><TextInput errorMessage={errors.registeredName} isInvalid={Boolean(errors.registeredName)} isRequired label="Registered company name" onChange={(value) => updateField("registeredName", value)} value={form.registeredName} /></div>
            <ComboboxField errorMessage={errors.countryCode} isInvalid={Boolean(errors.countryCode)} isRequired items={countries} label="Country / region" onSelectionChange={(key) => key && updateField("countryCode", String(key))} placeholder="Search countries" selectedKey={form.countryCode} />
            <TextInput errorMessage={errors.registrationNumber} isInvalid={Boolean(errors.registrationNumber)} label="Registration number" onChange={(value) => updateField("registrationNumber", value)} value={form.registrationNumber} />
            <TextInput errorMessage={errors.taxRegistrationNumber} isInvalid={Boolean(errors.taxRegistrationNumber)} label="Tax registration number" onChange={(value) => updateField("taxRegistrationNumber", value)} value={form.taxRegistrationNumber} />
            <div className={styles.fullField}><TextInput errorMessage={errors.line1} isInvalid={Boolean(errors.line1)} isRequired label="Address line 1" onChange={(value) => updateField("line1", value)} value={form.line1} /></div>
            <div className={styles.fullField}><TextInput errorMessage={errors.line2} isInvalid={Boolean(errors.line2)} label="Address line 2" onChange={(value) => updateField("line2", value)} value={form.line2} /></div>
            {regionLookupFailed ? <TextInput description="Location suggestions are unavailable; enter the local administrative area." errorMessage={errors.region} isInvalid={Boolean(errors.region)} isRequired={form.countryCode === "AE"} label={administrativeAreaLabel(form.countryCode)} onChange={(value) => updateField("region", value)} value={form.region} /> : <ComboboxField description={isLoadingRegions ? `Loading locations for ${displayName(form.countryCode, "region")}…` : `Only locations in ${displayName(form.countryCode, "region")} are shown.`} errorMessage={errors.region} isDisabled={isLoadingRegions} isInvalid={Boolean(errors.region)} isRequired={form.countryCode === "AE"} items={regions} label={administrativeAreaLabel(form.countryCode)} onSelectionChange={(key) => { if (!key) return; const value = String(key); if (value !== form.region) updateField("city", ""); updateField("region", value); }} placeholder={isLoadingRegions ? "Loading…" : `Select ${administrativeAreaLabel(form.countryCode).toLowerCase()}`} selectedKey={form.region || null} />}
            {cityLookupFailed ? <TextInput description="City suggestions are unavailable; enter the city manually." errorMessage={errors.city} isInvalid={Boolean(errors.city)} isRequired label="City" onChange={(value) => updateField("city", value)} value={form.city} /> : <ComboboxField description={!form.region ? `Select ${administrativeAreaLabel(form.countryCode).toLowerCase()} first.` : isLoadingCities ? `Loading cities in ${form.region}…` : `Only cities in ${form.region} are shown.`} errorMessage={errors.city} isDisabled={!form.region || isLoadingCities} isInvalid={Boolean(errors.city)} isRequired items={cities} label="City" onSelectionChange={(key) => key && updateField("city", String(key))} placeholder={!form.region ? `Select ${administrativeAreaLabel(form.countryCode).toLowerCase()} first` : isLoadingCities ? "Loading…" : "Select city"} selectedKey={form.city || null} />}
            {form.countryCode === "AE" ? null : <TextInput errorMessage={errors.postalCode} isInvalid={Boolean(errors.postalCode)} label="Postal code" onChange={(value) => updateField("postalCode", value)} value={form.postalCode} />}
            <ComboboxField errorMessage={errors.defaultCurrency} isInvalid={Boolean(errors.defaultCurrency)} isRequired items={currencies} label="Base currency" onSelectionChange={(key) => key && updateField("defaultCurrency", String(key))} placeholder="Search currencies" selectedKey={form.defaultCurrency} />
            <SelectField errorMessage={errors.defaultLocale} isInvalid={Boolean(errors.defaultLocale)} isRequired items={locales} label="Language & number format" onSelectionChange={(key) => key && updateField("defaultLocale", String(key))} selectedKey={form.defaultLocale} />
            <div className={styles.fullField}><ComboboxField errorMessage={errors.defaultTimezone} isInvalid={Boolean(errors.defaultTimezone)} isRequired items={timeZones} label="Time zone" onSelectionChange={(key) => key && updateField("defaultTimezone", String(key))} placeholder="Search time zones" selectedKey={form.defaultTimezone} /></div>
            <SelectField items={[{ id: "metric", label: "Metric" }, { id: "imperial", label: "Imperial" }, { id: "mixed", label: "Mixed" }]} label="Measurement system" onSelectionChange={(key) => key && updateField("unitSystem", String(key))} selectedKey={form.unitSystem} />
            <SelectField items={[{ id: "0", label: "Sunday" }, { id: "1", label: "Monday" }, { id: "6", label: "Saturday" }]} label="Week starts on" onSelectionChange={(key) => key && updateField("weekStartsOn", String(key))} selectedKey={form.weekStartsOn} />
          </div>
        </form>
      </ControlledModalDialog> : null}
      <ConfirmationDialog body="Your edits have not been saved. Discard them and close the editor?" confirmLabel="Discard changes" isOpen={discardOpen} onConfirm={discardChanges} onOpenChange={setDiscardOpen} title="Discard unsaved changes?" />
      <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button isDisabled={isRemovingLogo} onPress={() => setRemoveLogoOpen(false)}>Keep logo</Button><Button isLoading={isRemovingLogo} onPress={removeLogo} variant="danger">Remove logo</Button></div>} isOpen={removeLogoOpen} onOpenChange={setRemoveLogoOpen} title="Remove company logo?">The initials fallback will replace the logo on the workspace and tenant sign-in screen.</ControlledModalDialog>
    </DesignSystemProvider>
  );
}
