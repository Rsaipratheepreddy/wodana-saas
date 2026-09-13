"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { CheckCircle2, LockKeyhole, Pencil, Trash2, Upload } from "lucide-react";
import {
  Badge, Button, Callout, ComboboxField, ConfirmationDialog, ControlledModalDialog,
  DesignSystemProvider, IconButton, SelectField, TextInput, ValidationSummary,
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
type EditorSection = "all" | "identity" | "legal" | "address" | "regional";

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

function validate(form: ProfileForm, section: EditorSection = "all"): FormErrors {
  const errors: FormErrors = {};
  if (section === "all" || section === "identity") {
    if (form.name.trim().length < 2) errors.name = "Enter a company name.";
    else if (form.name.trim().length > 160) errors.name = "Company name must be 160 characters or fewer.";
  }
  if (section === "all" || section === "legal") {
    if (form.registeredName.trim().length < 2) errors.registeredName = "Enter the registered company name.";
    else if (form.registeredName.trim().length > 200) errors.registeredName = "Registered name must be 200 characters or fewer.";
    if (!/^[A-Z]{2}$/.test(form.countryCode)) errors.countryCode = "Select the country where this company is registered.";
    if (form.registrationNumber.length > 100) errors.registrationNumber = "Registration number must be 100 characters or fewer.";
    if (form.taxRegistrationNumber.length > 100) errors.taxRegistrationNumber = "Tax registration number must be 100 characters or fewer.";
  }
  if (section === "all" || section === "address") {
    if (!form.line1.trim()) errors.line1 = "Enter the registered street address.";
    else if (form.line1.length > 160) errors.line1 = "Address line must be 160 characters or fewer.";
    if (form.line2.length > 160) errors.line2 = "Address line must be 160 characters or fewer.";
    if (!form.city.trim()) errors.city = "Enter the city.";
    else if (form.city.length > 100) errors.city = "City must be 100 characters or fewer.";
    if (form.countryCode === "AE" && !form.region.trim()) errors.region = "Select an emirate.";
    else if (form.region.length > 100) errors.region = "State or region must be 100 characters or fewer.";
    if (form.countryCode !== "AE" && form.postalCode.length > 32) errors.postalCode = "Postal code must be 32 characters or fewer.";
  }
  if (section === "all" || section === "regional") {
    if (!/^[A-Z]{3}$/.test(form.defaultCurrency)) errors.defaultCurrency = "Select a base currency.";
    if (!form.defaultLocale) errors.defaultLocale = "Select a language and format.";
    if (!form.defaultTimezone) errors.defaultTimezone = "Select a time zone.";
  }
  return errors;
}

function Detail({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  const missing = value === "Not provided";
  return <div className={styles.detail}><dt>{label}</dt><dd className={missing ? styles.missing : undefined} data-ltr={ltr || undefined}>{value}</dd></div>;
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

export function CompanyProfile({ canManage, initialData }: { canManage: boolean; initialData: CompanyProfileData }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [data, setData] = useState(initialData);
  const entity = data.legalEntities[0];
  const [form, setForm] = useState<ProfileForm>(() => entity ? formFromProfile(initialData, entity) : emptyForm(initialData));
  const [errors, setErrors] = useState<FormErrors>({});
  const [isOpen, setIsOpen] = useState(false);
  const [editorSection, setEditorSection] = useState<EditorSection>("all");
  const [logoEditorOpen, setLogoEditorOpen] = useState(false);
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

  useEffect(() => {
    if (!isOpen || editorSection !== "address" || !form.countryCode) return;
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
  }, [editorSection, form.countryCode, isOpen]);

  useEffect(() => {
    if (!isOpen || editorSection !== "address") return;
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
  }, [editorSection, form.countryCode, form.region, isOpen, regionLookupFailed]);

  const updateField = (key: keyof ProfileForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSaveError("");
  };
  const openEditor = (section: EditorSection = "all") => {
    if (!entity) return;
    setForm(formFromProfile(data, entity)); setErrors({}); setSaveError(""); setEditorSection(section); setIsOpen(true);
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
    const nextErrors = validate(form, editorSection);
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
      setData(updated); setForm(formFromProfile(updated, payload.legalEntity)); setStatus("Org profile saved."); setIsOpen(false); router.refresh();
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
      setData((current) => ({ ...current, branding: { logoAssetId: branding.assetId, logoUrl: branding.logoUrl, logoUpdatedAt: branding.updatedAt } }));
      setStatus("Company logo updated."); setLogoEditorOpen(false); router.refresh();
    } catch (error) { setLogoError(error instanceof Error ? error.message : "The logo could not be uploaded."); }
    finally { setIsUploadingLogo(false); }
  };

  const removeLogo = async () => {
    if (isRemovingLogo) return;
    setIsRemovingLogo(true); setLogoError("");
    try {
      const response = await fetch(`/api/workspace/company-profile/logo?workspaceId=${data.workspace.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseMessage(response, "The logo could not be removed."));
      setData((current) => ({ ...current, branding: { logoAssetId: null, logoUrl: null, logoUpdatedAt: null } }));
      setRemoveLogoOpen(false); setStatus("Company logo removed."); router.refresh();
    } catch (error) { setLogoError(error instanceof Error ? error.message : "The logo could not be removed."); setRemoveLogoOpen(false); }
    finally { setIsRemovingLogo(false); }
  };

  const editorTitle: Record<EditorSection, string> = {
    all: "Edit company profile",
    identity: "Edit company information",
    legal: "Edit legal and tax details",
    address: "Edit registered office",
    regional: "Edit regional settings",
  };

  return (
    <DesignSystemProvider className={styles.provider} currency={data.workspace.defaultCurrency} locale={data.workspace.defaultLocale} portalContainer={portalContainer} ref={setPortalContainer} timeZone={data.workspace.defaultTimezone}>
      <section aria-label="Org profile workspace" className={styles.page}>
        <h1 className="wd-visually-hidden">Org profile</h1>
        {status ? <div aria-live="polite" className={styles.liveStatus}><CheckCircle2 aria-hidden="true" size={15} />{status}</div> : null}
        {logoError ? <Callout title="Could not update logo" tone="danger">{logoError}</Callout> : null}

        <section aria-labelledby="brand-heading" className={styles.brandSection}>
          <div className={styles.logoControl}>
            <div className={styles.logoPreview} data-has-logo={data.branding.logoUrl ? true : undefined} style={data.branding.logoUrl ? undefined : identityStyle(data.workspace.id)}>
              {data.branding.logoUrl ? <Image alt={`${data.workspace.name} logo`} height={88} src={data.branding.logoUrl} unoptimized width={88} /> : <span aria-hidden="true">{identityInitials(data.workspace.name)}</span>}
            </div>
            {canManage ? <IconButton aria-label="Edit company logo" className={styles.logoEdit} isDisabled={isUploadingLogo} onPress={() => setLogoEditorOpen(true)}><Pencil aria-hidden="true" size={14} /></IconButton> : null}
            <input accept="image/png,image/jpeg,image/webp" aria-label="Choose company logo" className={styles.fileInput} onChange={uploadLogo} ref={fileInput} type="file" />
          </div>
          <div className={styles.brandIdentity}>
            <div className={styles.brandTitle}><h2 id="brand-heading">{data.workspace.name}</h2><Badge tone={data.workspace.status === "active" ? "success" : "neutral"}>{data.workspace.status === "active" ? "Active" : data.workspace.status}</Badge></div>
            <p>{entity?.registeredName ?? "Legal company details have not been configured."}</p>
            <small>Tenant ID: <span data-ltr>{data.workspace.slug}</span>{entity ? <><i aria-hidden="true" />Entity code: <span data-ltr>{entity.code}</span></> : null}</small>
          </div>
        </section>

        {!entity ? <Callout title="Legal entity required" tone="warning">Complete organization setup before editing the company profile.</Callout> : <div className={styles.sections}>
          <section aria-labelledby="identity-details-heading" className={styles.detailSection} id="company-information"><header><h2 id="identity-details-heading">Company information</h2>{canManage ? <IconButton aria-label="Edit company information" onPress={() => openEditor("identity")}><Pencil aria-hidden="true" size={16} /></IconButton> : null}</header><dl className={styles.detailGrid}><Detail label="Display name" value={data.workspace.name} /><Detail label="Registered name" value={entity.registeredName} /><Detail label="Tenant login ID" ltr value={data.workspace.slug} /><Detail label="Legal entity code" ltr value={entity.code} /></dl></section>
          <section aria-labelledby="legal-details-heading" className={styles.detailSection} id="legal-tax"><header><h2 id="legal-details-heading">Legal &amp; tax</h2>{canManage ? <IconButton aria-label="Edit legal and tax details" onPress={() => openEditor("legal")}><Pencil aria-hidden="true" size={16} /></IconButton> : null}</header><dl className={styles.detailGrid}><Detail label="Country / region" value={`${displayName(entity.countryCode, "region")} · ${entity.countryCode}`} /><Detail label="Entity status" value={entity.status === "active" ? "Active" : entity.status} /><Detail label="Registration number" ltr value={optionalValue(entity.registrationNumber)} /><Detail label="Tax registration number" ltr value={optionalValue(entity.taxRegistrationNumber)} /></dl></section>
          <section aria-labelledby="address-details-heading" className={styles.detailSection} id="registered-office"><header><h2 id="address-details-heading">Registered office</h2>{canManage ? <IconButton aria-label="Edit registered office" onPress={() => openEditor("address")}><Pencil aria-hidden="true" size={16} /></IconButton> : null}</header>{hasAddress ? <dl className={styles.detailGrid}><Detail label="Address" value={optionalValue(address)} /><Detail label="City" value={optionalValue(entity.address.city)} /><Detail label={administrativeAreaLabel(entity.countryCode)} value={optionalValue(entity.address.region)} />{entity.countryCode === "AE" ? null : <Detail label="Postal code" ltr value={optionalValue(entity.address.postalCode)} />}<Detail label="Country / region" value={displayName(entity.countryCode, "region")} /></dl> : <p className={styles.missing}>Not provided</p>}</section>
          <section aria-labelledby="defaults-heading" className={styles.detailSection} id="regional-settings"><header><h2 id="defaults-heading">Regional settings</h2>{canManage ? <IconButton aria-label="Edit regional settings" onPress={() => openEditor("regional")}><Pencil aria-hidden="true" size={16} /></IconButton> : null}</header><dl className={styles.detailGrid}><Detail label="Base currency" ltr value={`${data.workspace.defaultCurrency} · ${displayName(data.workspace.defaultCurrency, "currency")}`} /><Detail label="Language & format" ltr value={data.workspace.defaultLocale} /><Detail label="Time zone" ltr value={data.workspace.defaultTimezone} /><Detail label="Measurement system" value={data.workspace.unitSystem[0].toUpperCase() + data.workspace.unitSystem.slice(1)} /><Detail label="Week starts on" value={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][data.workspace.weekStartsOn] ?? "Monday"} /></dl></section>
        </div>}
        {!canManage ? <p className={styles.permissionNote}>Only workspace owners and administrators can edit this profile.</p> : null}
      </section>

      {entity ? <ControlledModalDialog description="Changes apply across the workspace and tenant sign-in." footer={<div className="wd-dialog-actions"><Button isDisabled={isSaving} onPress={() => requestEditorChange(false)}>Cancel</Button><Button form="company-profile-form" isLoading={isSaving} type="submit" variant="primary">Save changes</Button></div>} isOpen={isOpen} onOpenChange={requestEditorChange} size={editorSection === "all" ? "lg" : undefined} title={editorTitle[editorSection]}>
        <form className={styles.editor} data-wd-density="compact" id="company-profile-form" noValidate onSubmit={submit}>
          <ValidationSummary errors={Object.values(errors).filter((error): error is string => Boolean(error))} />
          {saveError ? <Callout title="Could not save changes" tone="danger">{saveError}</Callout> : null}
          {editorSection === "all" || editorSection === "identity" ? <fieldset><legend>Company information</legend><div className={styles.formGrid}><TextInput errorMessage={errors.name} isInvalid={Boolean(errors.name)} isRequired label="Company display name" onChange={(value) => updateField("name", value)} value={form.name} /><div className={styles.lockedField}><span>Tenant login ID</span><div><code data-ltr>{data.workspace.slug}</code><span><LockKeyhole aria-hidden="true" size={13} />Locked</span></div><small>Created during tenant provisioning and cannot be changed.</small></div></div></fieldset> : null}
          {editorSection === "all" || editorSection === "legal" ? <fieldset><legend>Legal &amp; tax</legend><div className={styles.formGrid}><div className={styles.fullField}><TextInput errorMessage={errors.registeredName} isInvalid={Boolean(errors.registeredName)} isRequired label="Registered company name" onChange={(value) => updateField("registeredName", value)} value={form.registeredName} /></div><ComboboxField errorMessage={errors.countryCode} isInvalid={Boolean(errors.countryCode)} isRequired items={countries} label="Country / region" onSelectionChange={(key) => key && updateField("countryCode", String(key))} placeholder="Search countries" selectedKey={form.countryCode} /><TextInput errorMessage={errors.registrationNumber} isInvalid={Boolean(errors.registrationNumber)} label="Registration number" onChange={(value) => updateField("registrationNumber", value)} value={form.registrationNumber} /><TextInput errorMessage={errors.taxRegistrationNumber} isInvalid={Boolean(errors.taxRegistrationNumber)} label="Tax registration number" onChange={(value) => updateField("taxRegistrationNumber", value)} value={form.taxRegistrationNumber} /></div></fieldset> : null}
          {editorSection === "all" || editorSection === "address" ? <fieldset><legend>Registered office</legend><div className={styles.formGrid}><div className={styles.fullField}><TextInput errorMessage={errors.line1} isInvalid={Boolean(errors.line1)} isRequired label="Address line 1" onChange={(value) => updateField("line1", value)} value={form.line1} /></div><div className={styles.fullField}><TextInput errorMessage={errors.line2} isInvalid={Boolean(errors.line2)} label="Address line 2" onChange={(value) => updateField("line2", value)} value={form.line2} /></div>{regionLookupFailed ? <TextInput description="Location suggestions are unavailable; enter the local administrative area." errorMessage={errors.region} isInvalid={Boolean(errors.region)} isRequired={form.countryCode === "AE"} label={administrativeAreaLabel(form.countryCode)} onChange={(value) => updateField("region", value)} value={form.region} /> : <ComboboxField description={isLoadingRegions ? `Loading locations for ${displayName(form.countryCode, "region")}…` : `Only locations in ${displayName(form.countryCode, "region")} are shown.`} errorMessage={errors.region} isDisabled={isLoadingRegions} isInvalid={Boolean(errors.region)} isRequired={form.countryCode === "AE"} items={regions} label={administrativeAreaLabel(form.countryCode)} onSelectionChange={(key) => { if (!key) return; const value = String(key); if (value !== form.region) updateField("city", ""); updateField("region", value); }} placeholder={isLoadingRegions ? "Loading…" : `Select ${administrativeAreaLabel(form.countryCode).toLowerCase()}`} selectedKey={form.region || null} />}{cityLookupFailed ? <TextInput description="City suggestions are unavailable; enter the city manually." errorMessage={errors.city} isInvalid={Boolean(errors.city)} isRequired label="City" onChange={(value) => updateField("city", value)} value={form.city} /> : <ComboboxField description={!form.region ? `Select ${administrativeAreaLabel(form.countryCode).toLowerCase()} first.` : isLoadingCities ? `Loading cities in ${form.region}…` : `Only cities in ${form.region} are shown.`} errorMessage={errors.city} isDisabled={!form.region || isLoadingCities} isInvalid={Boolean(errors.city)} isRequired items={cities} label="City" onSelectionChange={(key) => key && updateField("city", String(key))} placeholder={!form.region ? `Select ${administrativeAreaLabel(form.countryCode).toLowerCase()} first` : isLoadingCities ? "Loading…" : "Select city"} selectedKey={form.city || null} />}{form.countryCode === "AE" ? null : <TextInput errorMessage={errors.postalCode} isInvalid={Boolean(errors.postalCode)} label="Postal code" onChange={(value) => updateField("postalCode", value)} value={form.postalCode} />}</div></fieldset> : null}
          {editorSection === "all" || editorSection === "regional" ? <fieldset><legend>Regional settings</legend><p className={styles.fieldsetDescription}>Applied to new records. Existing documents keep their saved values.</p><div className={styles.formGrid}><ComboboxField errorMessage={errors.defaultCurrency} isInvalid={Boolean(errors.defaultCurrency)} isRequired items={currencies} label="Base currency" onSelectionChange={(key) => key && updateField("defaultCurrency", String(key))} placeholder="Search currencies" selectedKey={form.defaultCurrency} /><SelectField errorMessage={errors.defaultLocale} isInvalid={Boolean(errors.defaultLocale)} isRequired items={locales} label="Language & number format" onSelectionChange={(key) => key && updateField("defaultLocale", String(key))} selectedKey={form.defaultLocale} /><div className={styles.fullField}><ComboboxField errorMessage={errors.defaultTimezone} isInvalid={Boolean(errors.defaultTimezone)} isRequired items={timeZones} label="Time zone" onSelectionChange={(key) => key && updateField("defaultTimezone", String(key))} placeholder="Search time zones" selectedKey={form.defaultTimezone} /></div><SelectField items={[{ id: "metric", label: "Metric" }, { id: "imperial", label: "Imperial" }, { id: "mixed", label: "Mixed" }]} label="Measurement system" onSelectionChange={(key) => key && updateField("unitSystem", String(key))} selectedKey={form.unitSystem} /><SelectField items={[{ id: "0", label: "Sunday" }, { id: "1", label: "Monday" }, { id: "6", label: "Saturday" }]} label="Week starts on" onSelectionChange={(key) => key && updateField("weekStartsOn", String(key))} selectedKey={form.weekStartsOn} /></div></fieldset> : null}
        </form>
      </ControlledModalDialog> : null}
      <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button onPress={() => setLogoEditorOpen(false)}>Done</Button></div>} isOpen={logoEditorOpen} onOpenChange={setLogoEditorOpen} title="Company logo">
        <div className={styles.logoEditor}>
          <div className={styles.logoDialogPreview} style={data.branding.logoUrl ? undefined : identityStyle(data.workspace.id)}>{data.branding.logoUrl ? <Image alt={`${data.workspace.name} logo`} height={120} src={data.branding.logoUrl} unoptimized width={120} /> : <span aria-hidden="true">{identityInitials(data.workspace.name)}</span>}</div>
          <p>This logo appears on tenant sign-in and throughout the workspace.</p>
          <Button isLoading={isUploadingLogo} onPress={() => fileInput.current?.click()} variant="primary"><Upload aria-hidden="true" size={15} />{data.branding.logoUrl ? "Choose a new logo" : "Choose logo"}</Button>
          {data.branding.logoUrl ? <Button isDisabled={isUploadingLogo} onPress={() => { setLogoEditorOpen(false); setRemoveLogoOpen(true); }} variant="quiet"><Trash2 aria-hidden="true" size={15} />Remove logo</Button> : null}
          <small>PNG, JPEG, or WebP · 64–4096 px · up to 5 MB</small>
        </div>
      </ControlledModalDialog>
      <ConfirmationDialog body="Your edits have not been saved. Discard them and close the editor?" confirmLabel="Discard changes" isOpen={discardOpen} onConfirm={discardChanges} onOpenChange={setDiscardOpen} title="Discard unsaved changes?" />
      <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button isDisabled={isRemovingLogo} onPress={() => setRemoveLogoOpen(false)}>Keep logo</Button><Button isLoading={isRemovingLogo} onPress={removeLogo} variant="danger">Remove logo</Button></div>} isOpen={removeLogoOpen} onOpenChange={setRemoveLogoOpen} title="Remove company logo?">The initials fallback will replace the logo on the workspace and tenant sign-in screen.</ControlledModalDialog>
    </DesignSystemProvider>
  );
}
