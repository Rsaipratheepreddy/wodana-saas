"use client";

// Country and currency flags are only shown while a workspace is set up.
import "flag-icons/css/flag-icons.min.css";
import Image from "next/image";
import { IntegrationsPage } from "@/components/workspace/integrations-page";
import type { IntegrationsPageData } from "@/lib/workspace/integrations";
import { WelcomeCelebration } from "./welcome-celebration";
import { WodanaLogo } from "@/components/brand";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Info, Building2, Landmark, Banknote, Clock3, Languages, Ruler, Globe2, CheckCircle2, CalendarDays, Trash2, Upload, UserPlus } from "lucide-react";
import {
  Button,
  Callout,
  ComboboxField,
  DesignSystemProvider,
  SelectField,
  TextInput,
} from "@/design-system";
import type { AuthProfile } from "@/lib/auth/server";
import type { CompanyProfileData, CompanyProfileUpdate } from "@/lib/workspace/company-profile";
import { countryOptions, currencyOptions, currencyFlagCode, localeOptions, timeZoneOptions } from "@/lib/workspace/regional-options";
import { languages, LANGUAGE_COOKIE, languageDirection, type AppLanguage } from '@/lib/i18n/languages';
import { translator, type MessageKey } from '@/lib/i18n/messages';
import styles from "./onboarding.module.css";

type Step = "workspace_profile" | "organization" | "team" | "integrations";
type Onboarding = AuthProfile["memberships"][number]["onboarding"];
type UploadSession = { assetId: string; uploadMode: "signed" | "application"; uploadUrl: string | null; uploadHeaders: Record<string, string> };
type Form = {
  countryCode: string;
  defaultCurrency: string;
  defaultLocale: string;
  defaultTimezone: string;
  name: string;
  registeredName: string;
  unitSystem: string;
  weekStartsOn: string;
};

const STEPS: Array<{ id: Step; label: MessageKey; shortLabel: MessageKey }> = [
  { id: "workspace_profile", label: "Tell us about your company", shortLabel: "Company" },
  { id: "organization", label: "Set your workspace defaults", shortLabel: "Preferences" },
  { id: "team", label: "Seats & people", shortLabel: "Seats" },
  { id: "integrations", label: "Connect the tools you use", shortLabel: "Connections" },
];

function formFrom(data: CompanyProfileData): Form {
  const entity = data.legalEntities[0];
  return {
    countryCode: entity.countryCode,
    defaultCurrency: data.workspace.defaultCurrency,
    defaultLocale: data.workspace.defaultLocale,
    defaultTimezone: data.workspace.defaultTimezone,
    name: data.workspace.name,
    registeredName: entity.registeredName,
    unitSystem: data.workspace.unitSystem,
    weekStartsOn: String(data.workspace.weekStartsOn),
  };
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string } | null;
  return payload?.message ?? fallback;
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("The logo preview could not be created."));
    reader.onerror = () => reject(new Error("The logo preview could not be created."));
    reader.readAsDataURL(file);
  });
}

function nextStep(step: Step): Step {
  return STEPS[Math.min(STEPS.findIndex((item) => item.id === step) + 1, STEPS.length - 1)].id;
}

export function OnboardingFlow({
  initialData,
  initialLanguage = "en",
  integrationData,
  oauthResult,
  seatCapacity = null,
  seatsUnavailable = false,
  availableRoles = [{ id: "member", label: "Member" }],
  initialInvites = [],
  initialOnboarding,
  isPreview = false,
  userName,
}: {
  initialData: CompanyProfileData;
  integrationData?: IntegrationsPageData;
  oauthResult?: { code?: string; result?: string };
  initialLanguage?: AppLanguage;
  availableRoles?: Array<{ id: string; label: string }>;
  initialInvites?: Array<{ email: string; roles: string[] }>;
  seatCapacity?: { allocated: number; reserved: number; pending: number } | null;
  /** Billing could not be read. A workspace without a seat plan is not an error. */
  seatsUnavailable?: boolean;
  initialOnboarding: Onboarding;
  isPreview?: boolean;
  userName: string;
}) {
  const [language, setLanguage] = useState(initialLanguage);
  const t = translator(language);
  const [newReservations, setNewReservations] = useState(0);
  const [data, setData] = useState(initialData);
  const [onboarding, setOnboarding] = useState(initialOnboarding);
  const [step, setStep] = useState<Step>(initialOnboarding.currentStep ?? "workspace_profile");
  const [form, setForm] = useState(() => formFrom(initialData));
  const [inviteEmail, setInviteEmail] = useState("");
  const [invited, setInvited] = useState<string[]>(initialInvites.map(invite => invite.email));
  const [inviteRole, setInviteRole] = useState(availableRoles.some(role => role.id === "member") ? "member" : availableRoles.some(role => role.id === "viewer") ? "viewer" : "");
  const [invitedRoles, setInvitedRoles] = useState<Record<string, string>>(Object.fromEntries(initialInvites.map(invite => [invite.email, invite.roles.map(code => availableRoles.find(role => role.id === code)?.label ?? code).join(", ")])));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState("");
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) stepHeading.current?.focus();
    previousStep.current = step;
  }, [step]);
  const [complete, setComplete] = useState(false);
  const [draggingLogo, setDraggingLogo] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isRemovingLogo, setIsRemovingLogo] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [previewLogoUrl, setPreviewLogoUrl] = useState<string | null>(null);
  const [previewLogoRemoved, setPreviewLogoRemoved] = useState(false);
  const [previewRestored, setPreviewRestored] = useState(false);
  const previewStorageKey = `wodana:onboarding-preview:${initialData.workspace.id}`;
  useEffect(() => {
    if (!isPreview) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(previewStorageKey) ?? "null");
      if (saved && STEPS.some(item => item.id === saved.step) && saved.form && saved.onboarding) {
        setStep(saved.step); setForm(current => ({ ...current, ...saved.form }));
        setOnboarding(saved.onboarding); setComplete(saved.complete === true);
        setInvited(saved.invited ?? []); setInvitedRoles(saved.invitedRoles ?? {});
        setNewReservations(saved.newReservations ?? 0); setInviteEmail(saved.inviteEmail ?? "");
        setPreviewLogoUrl(saved.previewLogoUrl ?? null); setPreviewLogoRemoved(saved.previewLogoRemoved === true);
      }
    } catch { /* A blocked or outdated preview cache must not prevent setup. */ }
    setPreviewRestored(true);
  }, [isPreview, previewStorageKey]);
  useEffect(() => {
    if (!isPreview || !previewRestored) return;
    try { sessionStorage.setItem(previewStorageKey, JSON.stringify({ step, form, onboarding, complete, invited, invitedRoles, newReservations, inviteEmail, previewLogoUrl, previewLogoRemoved })); }
    catch { /* Storage may be unavailable or full; setup remains usable. */ }
  }, [isPreview, previewRestored, previewStorageKey, step, form, onboarding, complete, invited, invitedRoles, newReservations, inviteEmail, previewLogoUrl, previewLogoRemoved]);
  const fileInput = useRef<HTMLInputElement>(null);
  const entity = data.legalEntities[0];
  const currentIndex = STEPS.findIndex((item) => item.id === step);
  const countries = useMemo(() => countryOptions(language).map(item => ({ ...item, icon: <span className={`fi fi-${item.id.toLowerCase()}`} /> })), [language]);
  const currencies = useMemo(() => currencyOptions(language).map(item => ({ ...item, icon: currencyFlagCode(item.id) ? <span className={`fi fi-${currencyFlagCode(item.id)}`} /> : <Globe2 size={16} /> })), [language]);
  const timeZones = useMemo(() => timeZoneOptions(), []);
  const logoUrl = previewLogoRemoved ? null : previewLogoUrl ?? data.branding.logoUrl;

  const update = (key: keyof Form, value: string | null) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFailure("");
  };

  const uploadLogo = async (file?: File) => {
    if (!file || isUploadingLogo || isRemovingLogo) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setLogoError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size === 0) {
      setLogoError("Choose a logo file that is not empty.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setLogoError("Logo must be 5 MB or smaller.");
      return;
    }
    setIsUploadingLogo(true);
    setLogoError("");
    setFailure("");
    setStatus("Uploading company logo…");
    try {
      const localPreview = await fileDataUrl(file);
      setPreviewLogoUrl(localPreview);
      setPreviewLogoRemoved(false);
      if (isPreview) {
        setStatus("Company logo ready");
        return;
      }
      const started = await fetch("/api/workspace/company-profile/logo-uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: data.workspace.id, filename: file.name, mimeType: file.type, byteSize: file.size }),
      });
      if (!started.ok) throw new Error(await responseMessage(started, "The logo upload could not be started."));
      const session = await started.json() as UploadSession;
      const uploadUrl = session.uploadMode === "signed" && session.uploadUrl
        ? session.uploadUrl
        : `/api/workspace/company-profile/logo-uploads/${session.assetId}/content?workspaceId=${data.workspace.id}`;
      const uploaded = await fetch(uploadUrl, { method: "PUT", headers: session.uploadHeaders, body: file });
      if (!uploaded.ok) throw new Error(await responseMessage(uploaded, "The logo could not be uploaded."));
      const completed = await fetch(`/api/workspace/company-profile/logo-uploads/${session.assetId}/complete?workspaceId=${data.workspace.id}`, { method: "POST" });
      if (!completed.ok) throw new Error(await responseMessage(completed, "The logo could not be verified."));
      const branding = await completed.json() as { assetId: string; logoUrl: string; updatedAt: string };
      setData((current) => ({
        ...current,
        branding: { ...current.branding, logoAssetId: branding.assetId, logoUrl: branding.logoUrl, logoUpdatedAt: branding.updatedAt },
      }));
      setPreviewLogoUrl(null);
      setStatus("Company logo saved");
    } catch (error) {
      setPreviewLogoUrl(null);
      setLogoError(error instanceof Error ? error.message : "The logo could not be uploaded.");
      setStatus("");
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const removeLogo = async () => {
    if (isUploadingLogo || isRemovingLogo) return;
    setIsRemovingLogo(true);
    setLogoError("");
    setFailure("");
    setStatus("Removing company logo…");
    try {
      if (!isPreview && data.branding.logoUrl) {
        const response = await fetch(`/api/workspace/company-profile/logo?workspaceId=${data.workspace.id}`, { method: "DELETE" });
        if (!response.ok) throw new Error(await responseMessage(response, "The logo could not be removed."));
      }
      setData((current) => ({
        ...current,
        branding: { ...current.branding, logoAssetId: null, logoUrl: null, logoUpdatedAt: null },
      }));
      setPreviewLogoUrl(null);
      setPreviewLogoRemoved(true);
      setStatus("Company logo removed");
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : "The logo could not be removed.");
      setStatus("");
    } finally {
      setIsRemovingLogo(false);
    }
  };

  const saveProfile = async (): Promise<CompanyProfileData> => {
    if (isPreview) {
      const updated: CompanyProfileData = {
        ...data,
        workspace: {
          ...data.workspace,
          name: form.name.trim(),
          defaultCurrency: form.defaultCurrency,
          defaultLocale: form.defaultLocale,
          defaultTimezone: form.defaultTimezone,
          unitSystem: form.unitSystem,
          weekStartsOn: Number(form.weekStartsOn),
          version: data.workspace.version + 1,
        },
        legalEntities: data.legalEntities.map((item) => item.id === entity.id ? {
          ...item,
          registeredName: form.registeredName.trim(),
          countryCode: form.countryCode,
          version: item.version + 1,
        } : item),
      };
      setData(updated);
      return updated;
    }
    const response = await fetch("/api/workspace/company-profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: data.workspace.id,
        workspaceVersion: data.workspace.version,
        legalEntityId: entity.id,
        legalEntityVersion: entity.version,
        name: form.name.trim(),
        registeredName: form.registeredName.trim(),
        countryCode: form.countryCode,
        defaultCurrency: form.defaultCurrency,
        defaultLocale: form.defaultLocale,
        defaultTimezone: form.defaultTimezone,
        unitSystem: form.unitSystem,
        weekStartsOn: Number(form.weekStartsOn),
        registrationNumber: entity.registrationNumber ?? "",
        taxRegistrationNumber: entity.taxRegistrationNumber ?? "",
        address: entity.address,
      }),
    });
    const payload = await response.json().catch(() => null) as (Partial<CompanyProfileUpdate> & { message?: string }) | null;
    if (!response.ok || !payload?.workspace || !payload.legalEntity) {
      throw new Error(payload?.message ?? "Company details could not be saved.");
    }
    const updated: CompanyProfileData = {
      ...data,
      workspace: payload.workspace,
      legalEntities: data.legalEntities.map((item) => item.id === payload.legalEntity?.id ? payload.legalEntity : item),
    };
    setData(updated);
    return updated;
  };

  const advance = async (completedStep: Step) => {
    const completedSteps = Array.from(new Set([...onboarding.completedSteps, completedStep]));
    const upcoming = nextStep(completedStep);
    if (isPreview) {
      setOnboarding((current) => ({
        ...current,
        status: "in_progress",
        currentStep: upcoming,
        completedSteps,
        version: current.version + 1,
      }));
      setStep(upcoming);
      setStatus("");
      return;
    }
    const response = await fetch("/api/onboarding", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: data.workspace.id,
        version: onboarding.version,
        currentStep: upcoming,
        completedSteps,
      }),
    });
    if (!response.ok) throw new Error(await responseMessage(response, "Setup progress could not be saved."));
    const updated = await response.json() as Onboarding;
    setOnboarding(updated);
    setStep(upcoming);
    setStatus(t("Progress saved"));
  };

  const continueFromProfile = async () => {
    if (busy || isUploadingLogo || isRemovingLogo) return;
    if (step === "workspace_profile" && (form.name.trim().length < 2 || form.registeredName.trim().length < 2 || !form.countryCode)) {
      setFailure("Enter the company and registered names, then choose a country.");
      return;
    }
    setBusy(true); setFailure(""); setStatus("Saving your workspace…");
    try {
      await saveProfile();
      await advance(step);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Workspace setup could not be saved.");
    } finally { setBusy(false); }
  };

  const inviteMember = async () => {
    if (busy || !availableRoles.some(role => role.id === inviteRole) || (seatCapacity && seatCapacity.reserved + newReservations >= seatCapacity.allocated)) return;
    if (!/^\S+@\S+\.\S+$/.test(inviteEmail)) {
      setFailure("Enter a valid work email.");
      return;
    }
    setBusy(true); setFailure(""); setStatus("Sending invitation…");
    try {
      if (isPreview) {
        setInvited((current) => [...current, inviteEmail.trim().toLowerCase()]);
        setInvitedRoles(current => ({ ...current, [inviteEmail.trim().toLowerCase()]: availableRoles.find(role => role.id === inviteRole)?.label ?? inviteRole }));
      setNewReservations(count => count + 1);
        setInviteEmail(""); setStatus("Invitation added for preview");
        return;
      }
      const response = await fetch("/api/workspace/members/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: data.workspace.id,
          email: inviteEmail.trim().toLowerCase(),
          roleCodes: [inviteRole],
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The invitation could not be sent."));
      const created = await response.json().catch(() => null) as { emailDelivery?: { status?: string } } | null;
      setInvited((current) => [...current, inviteEmail.trim().toLowerCase()]);
        setInvitedRoles(current => ({ ...current, [inviteEmail.trim().toLowerCase()]: availableRoles.find(role => role.id === inviteRole)?.label ?? inviteRole }));
      setNewReservations(count => count + 1);
      // Say "sent" only when the email went out; otherwise the link is shared from People.
      setInviteEmail(""); setStatus(created?.emailDelivery?.status === "sent" ? "Invitation sent" : "Invitation created · share the link from People");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The invitation could not be sent.");
    } finally { setBusy(false); }
  };

  const finish = async () => {
    if (busy) return;
    document.cookie = "wodana_onboarding_connect=; Path=/; Max-Age=0; SameSite=Lax";
    if (onboarding.status === "completed") {
      setComplete(true);
      return;
    }
    setBusy(true); setFailure(""); setStatus("Finishing setup…");
    try {
      if (isPreview) {
        setOnboarding((current) => ({
          ...current,
          status: "completed",
          currentStep: null,
          completedSteps: STEPS.map((item) => item.id),
          version: current.version + 1,
        }));
        setComplete(true);
        setStatus("");
        return;
      }
      const completedSteps = Array.from(new Set([...onboarding.completedSteps, "integrations" as const]));
      let version = onboarding.version;
      if (!onboarding.completedSteps.includes("integrations")) {
        const progress = await fetch("/api/onboarding", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId: data.workspace.id, version, currentStep: "integrations", completedSteps }),
        });
        if (!progress.ok) throw new Error(await responseMessage(progress, "Setup progress could not be saved."));
        const state = await progress.json() as Onboarding;
        version = state.version;
        setOnboarding(state);
      }
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: data.workspace.id, version }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Workspace setup could not be completed."));
      setOnboarding(await response.json() as Onboarding);
      setComplete(true);
      setStatus("");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Workspace setup could not be completed.");
    } finally { setBusy(false); }
  };

  const continueFromTeam = async () => {
    if (busy) return;
    setBusy(true); setFailure(""); setStatus("Saving progress…");
    try {
      await advance("team");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Progress could not be saved.");
    } finally { setBusy(false); }
  };

  const goBack = () => {
    if (currentIndex <= 0 || busy) return;
    setStep(STEPS[currentIndex - 1].id);
    setFailure(""); setStatus("");
  };

  if (complete) {
    return (
      <DesignSystemProvider className={styles.root} locale={language} direction={languageDirection(language)} timeZone={form.defaultTimezone}>
        <main className={styles.complete}>
          <WelcomeCelebration />
          <div className={styles.completionBack}><Button variant="secondary" onPress={() => { setComplete(false); setStep("integrations"); setFailure(""); setStatus(""); }}><ArrowLeft data-directional="true" aria-hidden="true" size={16} />{t("Back")}</Button></div>
          <WodanaLogo size="small" />
          <p className={styles.completionLabel}>{t("Setup complete")}</p>
          <h1>{t("Your workspace is ready, {name}.", { name: userName.split(" ")[0] })}</h1>
          <div className={styles.welcomeEnvelope}>
            <div className={styles.envelopeBack} aria-hidden="true" />
            <div className={styles.envelopeFlap} aria-hidden="true" />
            <article className={styles.welcomeLetter}>
              <p className={styles.letterFrom}>{t("A little note from Wodana")}</p>
              <h2>{t("Here’s to what we’ll build together.")}</h2>
              <p>{t("We’re happy you’re here. Thank you for making Wodana part of your journey.")}</p>
              <p>{t("Our promise: keep your work connected, make the everyday simpler, and keep improving with you.")}</p>
              <p className={styles.letterSignature}>{t("With you, every step of the way.")}<strong>Wodana</strong></p>
            </article>
            <div className={styles.envelopeFront} aria-hidden="true"><div className={styles.envelopeSeal}><WodanaLogo size="small" /></div></div>
          </div>
          <Button onPress={() => window.location.replace("/workspace")} variant="primary">
            {t("Enter workspace")}<ArrowRight data-directional="true" aria-hidden="true" size={16} />
          </Button>
        </main>
      </DesignSystemProvider>
    );
  }


  return (
    <DesignSystemProvider className={styles.root} currency={form.defaultCurrency} locale={language} direction={languageDirection(language)} timeZone={form.defaultTimezone}>
      <main className={styles.layout}>
        <header className={styles.topbar}>
          <div className={styles.brand}><WodanaLogo size="small" /></div>
          <div className={styles.languageChoice}><SelectField prefix={<Globe2 size={16} strokeWidth={2} aria-hidden="true" />} label={t("Language")} items={languages.map(item => ({ id: item.id, label: item.label }))} selectedKey={language} onSelectionChange={key => {
            const selected = languages.find(item => item.id === key);
            if (!selected) return;
            setLanguage(selected.id);
            document.cookie = `${LANGUAGE_COOKIE}=${selected.id}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
          }} /></div>
        </header>
        <section className={styles.panel}>
          <h1 className={styles.welcomeTitle}>{t("Happy to onboard")}</h1>
          <div className={styles.step} key={step}>
            <header className={styles.stepNavigation}>
              {currentIndex > 0 ? <Button isDisabled={busy || isUploadingLogo || isRemovingLogo} onPress={goBack} variant="quiet"><ArrowLeft data-directional="true" aria-hidden="true" size={15} />{t("Back")}</Button> : <span />}
              <div><h2 className={styles.accessibleHeading} ref={stepHeading} tabIndex={-1} aria-label={t(STEPS[currentIndex].label)}>{t(STEPS[currentIndex].shortLabel)}</h2><span>{t("Step {current} of {total}", { current: currentIndex + 1, total: STEPS.length })}</span></div>
            </header>
            {failure ? <Callout title={t("We couldn\u2019t save this step")} tone="danger">{failure}</Callout> : null}

            {step === "workspace_profile" ? <div className={styles.fields}>
              <TextInput isRequired prefix={<Building2 size={15} strokeWidth={1.7} aria-hidden="true" />} label={t("Company display name")} onChange={(value) => update("name", value)} value={form.name} />
              <TextInput isRequired prefix={<Landmark size={15} strokeWidth={1.7} aria-hidden="true" />} label={t("Registered company name")} onChange={(value) => update("registeredName", value)} value={form.registeredName} />
              <ComboboxField isRequired items={countries} prefix={<span className={`fi fi-${form.countryCode.toLowerCase()}`} aria-hidden="true" />} label={t("Country / region")} onSelectionChange={(key) => key && update("countryCode", String(key))} placeholder={t("Search countries")} selectedKey={form.countryCode} />
              <div className={styles.logoField}>
                <span>{t("Company logo")} <small>{t("Optional")}</small></span>
                <div className={styles.logoDrop} data-dragging={draggingLogo || undefined}
                  onDragOver={event => { event.preventDefault(); if (!isUploadingLogo && !isRemovingLogo) setDraggingLogo(true); }}
                  onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingLogo(false); }}
                  onDrop={event => { event.preventDefault(); setDraggingLogo(false); if (!isUploadingLogo && !isRemovingLogo) void uploadLogo(event.dataTransfer.files[0]); }}>
                  <button type="button" className={styles.uploadButton} disabled={isUploadingLogo || isRemovingLogo} onClick={() => fileInput.current?.click()} aria-label={logoUrl ? t("Replace logo") : t("Upload logo")} aria-busy={isUploadingLogo}>
                    <span className={styles.uploadVisual}>{logoUrl ? <Image alt={`${form.name || "Company"} logo`} fill sizes="40px" src={logoUrl} unoptimized /> : <Upload size={23} strokeWidth={1.6} aria-hidden="true" />}</span>
                    <span className={styles.uploadCopy}><strong>{isUploadingLogo ? t("Uploading…") : logoUrl ? t("Replace logo") : t("Upload logo")}</strong><small>PNG, JPG, WebP · 5 MB</small></span>
                  </button>
                  {logoUrl && <Button isDisabled={isUploadingLogo} isLoading={isRemovingLogo} onPress={() => void removeLogo()} size="compact" variant="quiet" aria-label={t("Remove")}><Trash2 size={16} aria-hidden="true" />{t("Remove")}</Button>}
                </div>
                <input accept="image/png,image/jpeg,image/webp" aria-label="Choose company logo" className={styles.fileInput} disabled={isUploadingLogo || isRemovingLogo} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void uploadLogo(file); }} ref={fileInput} type="file" />
                {logoError && <small className={styles.logoError} role="alert">{logoError}</small>}
              </div>
            </div> : null}

            {step === "organization" ? <div className={styles.fields}>
              <ComboboxField isRequired items={currencies} prefix={currencyFlagCode(form.defaultCurrency) ? <span className={`fi fi-${currencyFlagCode(form.defaultCurrency)}`} aria-hidden="true" /> : <Banknote size={16} aria-hidden="true" />} label={t("Base currency")} onSelectionChange={(key) => key && update("defaultCurrency", String(key))} placeholder={t("Search currencies")} selectedKey={form.defaultCurrency} />
              <ComboboxField isRequired items={timeZones} prefix={<Clock3 size={15} strokeWidth={1.7} aria-hidden="true" />} label={t("Time zone")} onSelectionChange={(key) => key && update("defaultTimezone", String(key))} placeholder={t("Search time zones")} selectedKey={form.defaultTimezone} />
              <SelectField items={localeOptions} prefix={<Languages size={15} strokeWidth={1.7} aria-hidden="true" />} label={t("Number & date format")} onSelectionChange={(key) => key && update("defaultLocale", String(key))} selectedKey={form.defaultLocale} />
              <div className={styles.splitFields}><SelectField items={[{ id: "metric", label: t("Metric") }, { id: "imperial", label: t("Imperial") }, { id: "mixed", label: t("Mixed") }]} prefix={<Ruler size={15} strokeWidth={1.7} aria-hidden="true" />} label={t("Measurement system")} onSelectionChange={(key) => key && update("unitSystem", String(key))} selectedKey={form.unitSystem} /><SelectField items={[{ id: "0", label: t("Sunday") }, { id: "1", label: t("Monday") }, { id: "6", label: t("Saturday") }]} prefix={<CalendarDays size={15} strokeWidth={1.7} aria-hidden="true" />} label={t("Week starts on")} onSelectionChange={(key) => key && update("weekStartsOn", String(key))} selectedKey={form.weekStartsOn} /></div>
            </div> : null}

            {step === "team" ? <div className={styles.teamStep}>
              {seatCapacity || seatsUnavailable ? <section className={styles.seats} aria-label={t("Seats")}>
                {seatCapacity ? <dl><div><dt>{t("Available")}</dt><dd>{Math.max(0, seatCapacity.allocated - seatCapacity.reserved - newReservations)}</dd></div><div><dt>{t("Pending invitations")}</dt><dd>{seatCapacity.pending + newReservations}</dd></div></dl> : <p>{t("Seat availability could not be loaded. Capacity is checked when you invite someone.")}</p>}
              </section> : null}
              <div className={styles.inviteFields}>
                <SelectField label={t("Role")} items={availableRoles} selectedKey={inviteRole || null} onSelectionChange={key => key && setInviteRole(String(key))} isDisabled={!availableRoles.length} />
                <TextInput inputType="email" dir="ltr" label={t("Work email")} onChange={(value) => { setInviteEmail(value); setFailure(""); }} placeholder="name@company.com" value={inviteEmail}
                  suffix={<Button isDisabled={busy || !inviteRole || Boolean(seatCapacity && seatCapacity.reserved + newReservations >= seatCapacity.allocated)} onPress={inviteMember} variant="primary" aria-label={t("Invite people")}>{t("Invite")}</Button>} />
              </div>
              {invited.length ? <ul className={styles.invited}>{invited.map((email) => <li key={email}><span className={styles.memberAvatar} aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span><div><bdi dir="ltr">{email}</bdi><small><CheckCircle2 size={12} aria-hidden="true" />{invitedRoles[email]}</small></div></li>)}</ul> : <div className={styles.optional}><p>{t("You can invite people later from Settings \u2192 People.")}</p></div>}

            </div> : null}

            {step === "integrations" ? <div className={styles.connectionStep}>
              {integrationData ? <IntegrationsPage initialData={integrationData} oauthResult={oauthResult} embedded onboarding /> : <Callout title="Connections unavailable" tone="warning">Connection setup could not be loaded. You can finish setup and connect later.</Callout>}
              <p className={styles.connectionHint}>{t("You will approve each provider separately.")}</p>
            </div> : null}

            <footer>
              {step === "workspace_profile" || step === "organization" ? <Button isDisabled={isUploadingLogo || isRemovingLogo} isLoading={busy} onPress={continueFromProfile} variant="primary">{t("Save and continue")}<ArrowRight data-directional="true" aria-hidden="true" size={15} /></Button>
                : step === "team" ? <Button isLoading={busy} onPress={continueFromTeam} variant="primary">{invited.length ? t("Continue") : t("Skip for now")}<ArrowRight data-directional="true" aria-hidden="true" size={15} /></Button>
                  : <Button isLoading={busy} onPress={() => finish()} variant="primary">{t("Finish setup")}<ArrowRight data-directional="true" aria-hidden="true" size={15} /></Button>}
              {step === "integrations" && <Button isDisabled={busy} onPress={() => finish()} variant="quiet">{t("Skip for now")}</Button>}
              {status && <span className={styles.saveStatus} role="status">{status}</span>}
            </footer>
          </div>
          {isPreview && <p className={styles.previewNotice} role="status"><Info size={15} strokeWidth={1.7} aria-hidden="true" /><span>{t("Sample workspace · Preview changes stay in this session.")}</span></p>}
        </section>

      </main>
    </DesignSystemProvider>
  );
}
