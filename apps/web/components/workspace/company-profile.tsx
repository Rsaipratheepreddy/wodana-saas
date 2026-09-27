"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";
import {
  Button, Callout, ComboboxField, ConfirmationDialog, ControlledModalDialog,
  DesignSystemProvider, SelectField, SettingsPage, SettingsRow, SettingsSection, TextInput, ValidationSummary, useDesignSystem,
} from "@/design-system";
import type { Translate } from "@/lib/i18n/keys";
import {
  type CompanyAddress, type CompanyProfileData, type CompanyProfileUpdate, type LegalEntityRecord,
} from "@/lib/workspace/company-profile";
import { countryOptions, currencyOptions, localeOptions, timeZoneOptions, type RegionalOption } from "@/lib/workspace/regional-options";
import styles from "./company-profile.module.css";
import { BrandColour } from "./brand-colour";
import { administrativeAreaLabel } from "@/lib/workspace/region-labels";
import { AiAssistanceSetting } from "./ai-assistance-setting";
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

function optionalValue(value: string | null | undefined, t: Translate): string { return value?.trim() || t("Not provided"); }
function displayName(code: string, type: "region" | "currency", locale: string): string {
  try { return new Intl.DisplayNames([locale], { type }).of(code) ?? code; } catch { return code; }
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

function measurementLabel(value: string, t: Translate): string {
  if (value === "metric") return t("Metric");
  if (value === "imperial") return t("Imperial");
  return t("Mixed");
}

function weekStartLabel(value: number, t: Translate): string {
  return ({ 0: t("Sunday"), 1: t("Monday"), 6: t("Saturday") } as Record<number, string>)[value] ?? t("Monday");
}

function validate(form: ProfileForm, t: Translate): FormErrors {
  const errors: FormErrors = {};
  if (form.name.trim().length < 2) errors.name = t("Enter a company name.");
  else if (form.name.trim().length > 160) errors.name = t("Company name must be 160 characters or fewer.");
  if (form.registeredName.trim().length < 2) errors.registeredName = t("Enter the registered company name.");
  else if (form.registeredName.trim().length > 200) errors.registeredName = t("Registered name must be 200 characters or fewer.");
  if (!/^[A-Z]{2}$/.test(form.countryCode)) errors.countryCode = t("Select the country where this company is registered.");
  if (form.registrationNumber.length > 100) errors.registrationNumber = t("Registration number must be 100 characters or fewer.");
  if (form.taxRegistrationNumber.length > 100) errors.taxRegistrationNumber = t("Tax registration number must be 100 characters or fewer.");
  if (!form.line1.trim()) errors.line1 = t("Enter the registered street address.");
  else if (form.line1.length > 160) errors.line1 = t("Address line must be 160 characters or fewer.");
  if (form.line2.length > 160) errors.line2 = t("Address line must be 160 characters or fewer.");
  if (!form.city.trim()) errors.city = t("Enter the city.");
  else if (form.city.length > 100) errors.city = t("City must be 100 characters or fewer.");
  if (form.countryCode === "AE" && !form.region.trim()) errors.region = t("Select an emirate.");
  else if (form.region.length > 100) errors.region = t("State or region must be 100 characters or fewer.");
  if (form.countryCode !== "AE" && form.postalCode.length > 32) errors.postalCode = t("Postal code must be 32 characters or fewer.");
  if (!/^[A-Z]{3}$/.test(form.defaultCurrency)) errors.defaultCurrency = t("Select a base currency.");
  if (!form.defaultLocale) errors.defaultLocale = t("Select a language and format.");
  if (!form.defaultTimezone) errors.defaultTimezone = t("Select a time zone.");
  return errors;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  return payload?.message ?? fallback;
}

async function loadLocationOptions(countryCode: string, region: string | undefined, signal: AbortSignal, t: Translate): Promise<RegionalOption[]> {
  const params = new URLSearchParams({ countryCode });
  if (region) params.set("region", region);
  const response = await fetch(`/api/geo/locations?${params}`, { signal });
  const payload = await response.json().catch(() => null) as { items?: RegionalOption[]; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? t("Location suggestions are unavailable."));
  return Array.isArray(payload?.items) ? payload.items : [];
}


export function CompanyProfile({
  canManage,
  initialData,
}: {
  canManage: boolean;
  initialData: CompanyProfileData;
}) {
  const t = useT();
  const { locale } = useDesignSystem();
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
  const areaLabel = t(administrativeAreaLabel(form.countryCode) as never);
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
        return loadLocationOptions(form.countryCode, undefined, controller.signal, t);
      })
      .then((items) => {
        if (controller.signal.aborted) return;
        setRegions(items);
        setRegionLookupFailed(items.length === 0);
      })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setRegionLookupFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setIsLoadingRegions(false); });
    return () => controller.abort();
  }, [form.countryCode, isOpen, t]);

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
        return loadLocationOptions(form.countryCode, form.region, controller.signal, t);
      })
      .then((items) => {
        if (items === null || controller.signal.aborted) return;
        setCities(items);
        setCityLookupFailed(items.length === 0);
      })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setCityLookupFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setIsLoadingCities(false); });
    return () => controller.abort();
  }, [form.countryCode, form.region, isOpen, regionLookupFailed, t]);

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
    const nextErrors = validate(form, t);
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
      if (!response.ok || !payload?.workspace || !payload.legalEntity) { setSaveError(payload?.message ?? t("The company profile could not be saved.")); return; }
      const updated: CompanyProfileData = { ...data, workspace: payload.workspace, legalEntities: data.legalEntities.map((item) => item.id === payload.legalEntity?.id ? payload.legalEntity : item) };
      setData(updated); setForm(formFromProfile(updated, payload.legalEntity)); setStatus(t("Company profile saved.")); setIsOpen(false); router.refresh();
    } catch { setSaveError(t("The company profile service is unavailable. Try again.")); }
    finally { setIsSaving(false); }
  };

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || isUploadingLogo) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setLogoError(t("Choose a PNG, JPEG, or WebP image.")); return; }
    if (file.size > 5 * 1024 * 1024) { setLogoError(t("Logo must be 5 MB or smaller.")); return; }
    setIsUploadingLogo(true); setLogoError(""); setStatus("");
    try {
      const started = await fetch("/api/workspace/company-profile/logo-uploads", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: data.workspace.id, filename: file.name, mimeType: file.type, byteSize: file.size }),
      });
      if (!started.ok) throw new Error(await responseMessage(started, t("The logo upload could not be started.")));
      const session = await started.json() as UploadSession;
      const uploadUrl = session.uploadMode === "signed" && session.uploadUrl ? session.uploadUrl : `/api/workspace/company-profile/logo-uploads/${session.assetId}/content?workspaceId=${data.workspace.id}`;
      const uploaded = await fetch(uploadUrl, { method: "PUT", headers: session.uploadHeaders, body: file });
      if (!uploaded.ok) throw new Error(await responseMessage(uploaded, t("The logo could not be uploaded.")));
      const completed = await fetch(`/api/workspace/company-profile/logo-uploads/${session.assetId}/complete?workspaceId=${data.workspace.id}`, { method: "POST" });
      if (!completed.ok) throw new Error(await responseMessage(completed, t("The logo could not be verified.")));
      const branding = await completed.json() as { assetId: string; logoUrl: string; updatedAt: string };
      setData((current) => ({ ...current, branding: { ...current.branding, logoAssetId: branding.assetId, logoUrl: branding.logoUrl, logoUpdatedAt: branding.updatedAt } }));
      setStatus(t("Company logo updated.")); router.refresh();
    } catch (error) { setLogoError(error instanceof Error ? error.message : t("The logo could not be uploaded.")); }
    finally { setIsUploadingLogo(false); }
  };

  const removeLogo = async () => {
    if (isRemovingLogo) return;
    setIsRemovingLogo(true); setLogoError("");
    try {
      const response = await fetch(`/api/workspace/company-profile/logo?workspaceId=${data.workspace.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseMessage(response, t("The logo could not be removed.")));
      setData((current) => ({ ...current, branding: { ...current.branding, logoAssetId: null, logoUrl: null, logoUpdatedAt: null } }));
      setRemoveLogoOpen(false); setStatus(t("Company logo removed.")); router.refresh();
    } catch (error) { setLogoError(error instanceof Error ? error.message : t("The logo could not be removed.")); setRemoveLogoOpen(false); }
    finally { setIsRemovingLogo(false); }
  };

  return (
    <DesignSystemProvider className={styles.provider} currency={data.workspace.defaultCurrency} locale={data.workspace.defaultLocale} portalContainer={portalContainer} ref={setPortalContainer} timeZone={data.workspace.defaultTimezone}>
      <SettingsPage aria-label={t("Company profile")} actions={canManage && entity ? <Button onPress={openEditor} size="compact">{t("Edit profile")}</Button> : null} title={t("Company profile")}>
        {status ? <div aria-live="polite" className={styles.liveStatus}><CheckCircle2 aria-hidden="true" size={15} />{status}</div> : null}
        {logoError ? <Callout title={t("Could not update brand")} tone="danger">{logoError}</Callout> : null}

        {!entity ? <Callout title={t("Business details required")} tone="warning">{t("Add business details before editing company settings.")}</Callout> : <>
          <SettingsSection id="company-information" title={t("Brand")}>
            <SettingsRow hint={t("PNG, JPG or WebP · 5 MB")} label={t("Logo")}>
              <span className={styles.logoThumb} data-has-logo={data.branding.logoUrl ? true : undefined} style={data.branding.logoUrl ? undefined : identityStyle(data.workspace.id)}>
                {data.branding.logoUrl ? <Image alt={t("{name} logo", { name: data.workspace.name })} height={32} src={data.branding.logoUrl} unoptimized width={32} /> : <span aria-hidden="true">{identityInitials(data.workspace.name)}</span>}
              </span>
              {canManage ? <Button isLoading={isUploadingLogo} onPress={() => fileInput.current?.click()} size="compact" variant="quiet">{data.branding.logoUrl ? t("Replace") : t("Upload logo")}</Button> : null}
              {canManage && data.branding.logoUrl ? <Button isDisabled={isUploadingLogo} onPress={() => setRemoveLogoOpen(true)} size="compact" variant="quiet"><Trash2 aria-hidden="true" size={14} />{t("Remove")}</Button> : null}
            </SettingsRow>
            <SettingsRow label={t("Company name")}>{data.workspace.name}</SettingsRow>
            <SettingsRow hint={t("Buttons, links and highlights follow this colour.")} label={t("Brand colour")}>
              <BrandColour
                bare
                canManage={canManage}
                onError={setLogoError}
                onSaved={({ primaryColor, workspaceVersion }) => { setData((current) => ({ ...current, workspace: { ...current.workspace, version: workspaceVersion }, branding: { ...current.branding, primaryColor } })); setStatus(t("Brand colour updated.")); router.refresh(); }}
                primaryColor={data.branding.primaryColor}
                workspaceId={data.workspace.id}
                workspaceVersion={data.workspace.version}
              />
            </SettingsRow>
            <SettingsRow hint={t("AI suggests; nothing changes until someone accepts.")} label={t("AI assistance")}><AiAssistanceSetting bare canManage={canManage} workspaceId={data.workspace.id} /></SettingsRow>
            <input accept="image/png,image/jpeg,image/webp" aria-label={t("Choose company logo")} className={styles.fileInput} onChange={uploadLogo} ref={fileInput} type="file" />
          </SettingsSection>

          <SettingsSection id="legal-details" title={t("Legal & tax")}>
            <SettingsRow label={t("Registered name")}>{entity.registeredName}</SettingsRow>
            <SettingsRow label={t("Company code")}>{entity.code}</SettingsRow>
            <SettingsRow label={t("Registered country")}>{displayName(entity.countryCode, "region", locale)}</SettingsRow>
            <SettingsRow label={t("Registration number")}>{optionalValue(entity.registrationNumber, t)}</SettingsRow>
            <SettingsRow label={t("Tax registration number")}>{optionalValue(entity.taxRegistrationNumber, t)}</SettingsRow>
          </SettingsSection>

          <SettingsSection id="registered-office" title={t("Registered office")}>
            <SettingsRow label={t("Street address")}>{hasAddress ? optionalValue(address, t) : t("Not provided")}</SettingsRow>
            <SettingsRow label={t("City")}>{optionalValue(entity.address.city, t)}</SettingsRow>
            <SettingsRow label={t("State / region")}>{optionalValue(entity.address.region, t)}</SettingsRow>
            <SettingsRow label={t("Postal code")}>{optionalValue(entity.address.postalCode, t)}</SettingsRow>
          </SettingsSection>

          <SettingsSection id="regional-settings" title={t("Regional defaults")}>
            <SettingsRow label={t("Base currency")}>{`${data.workspace.defaultCurrency} · ${displayName(data.workspace.defaultCurrency, "currency", locale)}`}</SettingsRow>
            <SettingsRow label={t("Language & format")}>{defaultLocaleLabel}</SettingsRow>
            <SettingsRow label={t("Time zone")}>{data.workspace.defaultTimezone}</SettingsRow>
            <SettingsRow label={t("Measurements")}>{measurementLabel(data.workspace.unitSystem, t)}</SettingsRow>
            <SettingsRow label={t("Week starts on")}>{weekStartLabel(data.workspace.weekStartsOn, t)}</SettingsRow>
          </SettingsSection>
        </>}
        {!canManage ? <p className={styles.permissionNote}>{t("Only workspace owners and administrators can edit this profile.")}</p> : null}
      </SettingsPage>

      {entity ? <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button isDisabled={isSaving} onPress={() => requestEditorChange(false)}>{t("Cancel")}</Button><Button form="company-profile-form" isLoading={isSaving} type="submit" variant="primary">{t("Save")}</Button></div>} isOpen={isOpen} onOpenChange={requestEditorChange} size="lg" title={t("Edit profile")}>
        <form className={styles.editor} data-wd-density="compact" id="company-profile-form" noValidate onSubmit={submit}>
          <ValidationSummary errors={Object.values(errors).filter((error): error is string => Boolean(error))} />
          {saveError ? <Callout title={t("Could not save changes")} tone="danger">{saveError}</Callout> : null}
          {logoError ? <Callout title={t("Could not update logo")} tone="danger">{logoError}</Callout> : null}
          <div className={styles.formGrid}>
            <div className={styles.fullField}><div className={styles.logoFormActions}><div className={styles.logoFormPreview} data-has-logo={data.branding.logoUrl ? true : undefined} style={data.branding.logoUrl ? undefined : identityStyle(data.workspace.id)}>{data.branding.logoUrl ? <Image alt={t("{name} logo", { name: data.workspace.name })} height={56} src={data.branding.logoUrl} unoptimized width={56} /> : <span aria-hidden="true">{identityInitials(data.workspace.name)}</span>}</div><Button isDisabled={isUploadingLogo} isLoading={isUploadingLogo} onPress={() => fileInput.current?.click()}>{t("Upload logo")}</Button>{data.branding.logoUrl ? <Button isDisabled={isUploadingLogo} onPress={() => setRemoveLogoOpen(true)} variant="quiet"><Trash2 aria-hidden="true" size={15} />{t("Remove")}</Button> : null}</div></div>
            <div className={styles.fullField}><TextInput autoFocus errorMessage={errors.name} isInvalid={Boolean(errors.name)} isRequired label={t("Company name")} onChange={(value) => updateField("name", value)} value={form.name} /></div>
            <div className={styles.fullField}><TextInput errorMessage={errors.registeredName} isInvalid={Boolean(errors.registeredName)} isRequired label={t("Registered company name")} onChange={(value) => updateField("registeredName", value)} value={form.registeredName} /></div>
            <ComboboxField errorMessage={errors.countryCode} isInvalid={Boolean(errors.countryCode)} isRequired items={countries} label={t("Country / region")} onSelectionChange={(key) => key && updateField("countryCode", String(key))} placeholder={t("Search countries")} selectedKey={form.countryCode} />
            <TextInput errorMessage={errors.registrationNumber} isInvalid={Boolean(errors.registrationNumber)} label={t("Registration number")} onChange={(value) => updateField("registrationNumber", value)} value={form.registrationNumber} />
            <TextInput errorMessage={errors.taxRegistrationNumber} isInvalid={Boolean(errors.taxRegistrationNumber)} label={t("Tax registration number")} onChange={(value) => updateField("taxRegistrationNumber", value)} value={form.taxRegistrationNumber} />
            <div className={styles.fullField}><TextInput errorMessage={errors.line1} isInvalid={Boolean(errors.line1)} isRequired label={t("Address line 1")} onChange={(value) => updateField("line1", value)} value={form.line1} /></div>
            <div className={styles.fullField}><TextInput errorMessage={errors.line2} isInvalid={Boolean(errors.line2)} label={t("Address line 2")} onChange={(value) => updateField("line2", value)} value={form.line2} /></div>
            {regionLookupFailed ? <TextInput description={t("Location suggestions are unavailable; enter the local administrative area.")} errorMessage={errors.region} isInvalid={Boolean(errors.region)} isRequired={form.countryCode === "AE"} label={areaLabel} onChange={(value) => updateField("region", value)} value={form.region} /> : <ComboboxField description={isLoadingRegions ? t("Loading locations for {country}…", { country: displayName(form.countryCode, "region", locale) }) : t("Only locations in {country} are shown.", { country: displayName(form.countryCode, "region", locale) })} errorMessage={errors.region} isDisabled={isLoadingRegions} isInvalid={Boolean(errors.region)} isRequired={form.countryCode === "AE"} items={regions} label={areaLabel} onSelectionChange={(key) => { if (!key) return; const value = String(key); if (value !== form.region) updateField("city", ""); updateField("region", value); }} placeholder={isLoadingRegions ? t("Loading…") : t("Select {area}", { area: areaLabel.toLowerCase() })} selectedKey={form.region || null} />}
            {cityLookupFailed ? <TextInput description={t("City suggestions are unavailable; enter the city manually.")} errorMessage={errors.city} isInvalid={Boolean(errors.city)} isRequired label={t("City")} onChange={(value) => updateField("city", value)} value={form.city} /> : <ComboboxField description={!form.region ? t("Select {area} first.", { area: areaLabel.toLowerCase() }) : isLoadingCities ? t("Loading cities in {region}…", { region: form.region }) : t("Only cities in {region} are shown.", { region: form.region })} errorMessage={errors.city} isDisabled={!form.region || isLoadingCities} isInvalid={Boolean(errors.city)} isRequired items={cities} label={t("City")} onSelectionChange={(key) => key && updateField("city", String(key))} placeholder={!form.region ? t("Select {area} first", { area: areaLabel.toLowerCase() }) : isLoadingCities ? t("Loading…") : t("Select city")} selectedKey={form.city || null} />}
            {form.countryCode === "AE" ? null : <TextInput errorMessage={errors.postalCode} isInvalid={Boolean(errors.postalCode)} label={t("Postal code")} onChange={(value) => updateField("postalCode", value)} value={form.postalCode} />}
            <ComboboxField errorMessage={errors.defaultCurrency} isInvalid={Boolean(errors.defaultCurrency)} isRequired items={currencies} label={t("Base currency")} onSelectionChange={(key) => key && updateField("defaultCurrency", String(key))} placeholder={t("Search currencies")} selectedKey={form.defaultCurrency} />
            <SelectField errorMessage={errors.defaultLocale} isInvalid={Boolean(errors.defaultLocale)} isRequired items={locales} label={t("Language & number format")} onSelectionChange={(key) => key && updateField("defaultLocale", String(key))} selectedKey={form.defaultLocale} />
            <div className={styles.fullField}><ComboboxField errorMessage={errors.defaultTimezone} isInvalid={Boolean(errors.defaultTimezone)} isRequired items={timeZones} label={t("Time zone")} onSelectionChange={(key) => key && updateField("defaultTimezone", String(key))} placeholder={t("Search time zones")} selectedKey={form.defaultTimezone} /></div>
            <SelectField items={[{ id: "metric", label: t("Metric") }, { id: "imperial", label: t("Imperial") }, { id: "mixed", label: t("Mixed") }]} label={t("Measurement system")} onSelectionChange={(key) => key && updateField("unitSystem", String(key))} selectedKey={form.unitSystem} />
            <SelectField items={[{ id: "0", label: t("Sunday") }, { id: "1", label: t("Monday") }, { id: "6", label: t("Saturday") }]} label={t("Week starts on")} onSelectionChange={(key) => key && updateField("weekStartsOn", String(key))} selectedKey={form.weekStartsOn} />
          </div>
        </form>
      </ControlledModalDialog> : null}
      <ConfirmationDialog body={t("Your edits have not been saved. Discard them and close the editor?")} confirmLabel={t("Discard changes")} isOpen={discardOpen} onConfirm={discardChanges} onOpenChange={setDiscardOpen} title={t("Discard unsaved changes?")} />
      <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button isDisabled={isRemovingLogo} onPress={() => setRemoveLogoOpen(false)}>{t("Keep logo")}</Button><Button isLoading={isRemovingLogo} onPress={removeLogo} variant="danger">{t("Remove logo")}</Button></div>} isOpen={removeLogoOpen} onOpenChange={setRemoveLogoOpen} title={t("Remove company logo?")}>{t("The initials fallback will replace the logo on the workspace and tenant sign-in screen.")}</ControlledModalDialog>
    </DesignSystemProvider>
  );
}
