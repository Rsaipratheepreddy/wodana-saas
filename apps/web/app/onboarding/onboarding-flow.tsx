"use client";

import Image from "next/image";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Link2, Sparkles, Trash2, Upload, UserPlus } from "lucide-react";
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
import { identityInitials, identityStyle } from "@/lib/brand/identity";
import { countryOptions, currencyOptions, localeOptions, timeZoneOptions } from "@/lib/workspace/regional-options";
import {
  announceWorkspacePrimaryColor,
  DEFAULT_WORKSPACE_PRIMARY_COLOR,
  workspacePrimaryColorStyle,
} from "@/lib/workspace/primary-color";
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
  primaryColor: string | null;
  registeredName: string;
  unitSystem: string;
  weekStartsOn: string;
};

const STEPS: Array<{ id: Step; label: string; shortLabel: string }> = [
  { id: "workspace_profile", label: "Tell us about your company", shortLabel: "Company" },
  { id: "organization", label: "Set your workspace defaults", shortLabel: "Preferences" },
  { id: "team", label: "Bring your team with you", shortLabel: "Team" },
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
    primaryColor: data.branding.primaryColor,
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
  initialOnboarding,
  isPreview = false,
  userName,
}: {
  initialData: CompanyProfileData;
  initialOnboarding: Onboarding;
  isPreview?: boolean;
  userName: string;
}) {
  const [data, setData] = useState(initialData);
  const [onboarding, setOnboarding] = useState(initialOnboarding);
  const [step, setStep] = useState<Step>(initialOnboarding.currentStep ?? "workspace_profile");
  const [form, setForm] = useState(() => formFrom(initialData));
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invited, setInvited] = useState<string[]>([]);
  const [openConnections, setOpenConnections] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [status, setStatus] = useState("");
  const [complete, setComplete] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(
    initialOnboarding.status === "not_started" && initialOnboarding.completedSteps.length === 0,
  );
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isRemovingLogo, setIsRemovingLogo] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [previewLogoUrl, setPreviewLogoUrl] = useState<string | null>(null);
  const [previewLogoRemoved, setPreviewLogoRemoved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const entity = data.legalEntities[0];
  const currentIndex = STEPS.findIndex((item) => item.id === step);
  const countries = useMemo(() => countryOptions(form.defaultLocale), [form.defaultLocale]);
  const currencies = useMemo(() => currencyOptions(form.defaultLocale), [form.defaultLocale]);
  const timeZones = useMemo(() => timeZoneOptions(), []);
  const logoUrl = previewLogoRemoved ? null : previewLogoUrl ?? data.branding.logoUrl;

  const beginSetup = () => {
    setWelcomeOpen(false);
  };

  const update = (key: keyof Form, value: string | null) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFailure("");
  };

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
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
        branding: { ...data.branding, primaryColor: form.primaryColor },
      };
      setData(updated);
      announceWorkspacePrimaryColor(form.primaryColor);
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
    let updated: CompanyProfileData = {
      ...data,
      workspace: payload.workspace,
      legalEntities: data.legalEntities.map((item) => item.id === payload.legalEntity?.id ? payload.legalEntity : item),
    };
    setData(updated);
    if (form.primaryColor !== data.branding.primaryColor) {
      const appearance = await fetch("/api/workspace/appearance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: data.workspace.id,
          workspaceVersion: payload.workspace.version,
          primaryColor: form.primaryColor,
        }),
      });
      const appearancePayload = await appearance.json().catch(() => null) as {
        message?: string;
        primaryColor?: string | null;
        workspace?: CompanyProfileData["workspace"];
      } | null;
      if (!appearance.ok || !appearancePayload?.workspace || appearancePayload.primaryColor === undefined) {
        throw new Error(appearancePayload?.message ?? "Workspace colour could not be saved.");
      }
      updated = {
        ...updated,
        workspace: appearancePayload.workspace,
        branding: { ...updated.branding, primaryColor: appearancePayload.primaryColor ?? null },
      };
      announceWorkspacePrimaryColor(appearancePayload.primaryColor ?? null);
      setData(updated);
    }
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
      setStatus("Progress saved");
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
    setStatus("Progress saved");
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
    if (busy) return;
    if (inviteName.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(inviteEmail)) {
      setFailure("Enter the team member’s name and a valid work email.");
      return;
    }
    setBusy(true); setFailure(""); setStatus("Sending invitation…");
    try {
      if (isPreview) {
        setInvited((current) => [...current, inviteEmail.trim().toLowerCase()]);
        setInviteName(""); setInviteEmail(""); setStatus("Invitation added for preview");
        return;
      }
      const response = await fetch("/api/workspace/members/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: data.workspace.id,
          displayName: inviteName.trim(),
          email: inviteEmail.trim().toLowerCase(),
          roleCodes: ["member"],
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The invitation could not be sent."));
      setInvited((current) => [...current, inviteEmail.trim().toLowerCase()]);
      setInviteName(""); setInviteEmail(""); setStatus("Invitation sent");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The invitation could not be sent.");
    } finally { setBusy(false); }
  };

  const finish = async () => {
    if (busy) return;
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
      <DesignSystemProvider className={styles.root} locale={form.defaultLocale} style={workspacePrimaryColorStyle(form.primaryColor)} timeZone={form.defaultTimezone}>
        <main className={styles.complete}>
          <div className={styles.completeGlow} aria-hidden="true" />
          <span className={styles.completeMark}><Check aria-hidden="true" size={26} /></span>
          <p>Setup complete</p>
          <h1>Your workspace is ready, {userName.split(" ")[0]}.</h1>
          <p>{data.workspace.name} now has the essentials in place. You can refine every setting later.</p>
          <Button onPress={() => window.location.replace(openConnections ? "/workspace/integrations" : "/workspace")} size="large" variant="primary">
            {openConnections ? "Connect your tools" : "Enter workspace"}<ArrowRight aria-hidden="true" size={16} />
          </Button>
        </main>
      </DesignSystemProvider>
    );
  }

  if (welcomeOpen) {
    return (
      <DesignSystemProvider className={styles.root} locale={form.defaultLocale} style={workspacePrimaryColorStyle(form.primaryColor)} timeZone={form.defaultTimezone}>
        <main className={styles.welcome}>
          <div className={styles.welcomeAura} aria-hidden="true" />
          <div className={styles.welcomeContent}>
            <div className={styles.welcomeMark} aria-hidden="true">W</div>
            <p>Welcome to</p>
            <h1>{form.name || "your new workspace"}</h1>
            <span>Let’s make great work feel effortless.</span>
            <Button onPress={beginSetup} size="large" variant="primary">Begin setup<ArrowRight aria-hidden="true" size={16} /></Button>
          </div>
        </main>
      </DesignSystemProvider>
    );
  }

  return (
    <DesignSystemProvider className={styles.root} currency={form.defaultCurrency} locale={form.defaultLocale} style={workspacePrimaryColorStyle(form.primaryColor)} timeZone={form.defaultTimezone}>
      <main className={styles.layout}>
        <aside className={styles.story}>
          <div className={styles.wordmark}><span>W</span><strong>Wodana</strong></div>
          <div className={styles.storyBody}>
            <div className={styles.storyCopy}>
              <p>Workspace setup</p>
              <h1>{form.name || "Your workspace"}</h1>
              <div aria-hidden="true"><span style={{ inlineSize: `${((currentIndex + 1) / STEPS.length) * 100}%` }} /></div>
            </div>
            <ol className={styles.progress} aria-label="Setup progress">
              {STEPS.map((item, index) => {
                const done = onboarding.completedSteps.includes(item.id);
                const active = item.id === step;
                const state = done ? "complete" : active ? "current" : "upcoming";
                return <li aria-current={active ? "step" : undefined} aria-label={`${item.shortLabel}, ${state}`} data-active={active || undefined} data-done={done || undefined} key={item.id}><span>{done ? <Check size={13} /> : index + 1}</span><strong>{item.shortLabel}</strong></li>;
              })}
            </ol>
          </div>
          <small className={styles.stepCount}>Step {currentIndex + 1} of {STEPS.length}</small>
        </aside>

        <section className={styles.panel}>
          <div className={styles.mobileProgress}><span>Step {currentIndex + 1} of {STEPS.length}</span><i><b style={{ inlineSize: `${((currentIndex + 1) / STEPS.length) * 100}%` }} /></i></div>
          <div className={styles.step} key={step}>
            <header><p>{STEPS[currentIndex].shortLabel}</p><h2>{STEPS[currentIndex].label}</h2>
              <span>{step === "workspace_profile" ? "Start with the identity clients and your team will recognize."
                : step === "organization" ? "These defaults keep dates, prices, and measurements consistent."
                  : step === "team" ? "Invite one person now, more later, or continue on your own."
                    : "Choose whether to open Connections after setup. Nothing connects without your approval."}</span></header>
            {failure ? <Callout title="We couldn’t save this step" tone="danger">{failure}</Callout> : null}

            {step === "workspace_profile" ? <div className={styles.fields}>
              <TextInput isRequired label="Company display name" onChange={(value) => update("name", value)} value={form.name} />
              <TextInput isRequired label="Registered company name" onChange={(value) => update("registeredName", value)} value={form.registeredName} />
              <ComboboxField isRequired items={countries} label="Country / region" onSelectionChange={(key) => key && update("countryCode", String(key))} placeholder="Search countries" selectedKey={form.countryCode} />
              <div className={styles.logoField}>
                <span>Company logo <small>Optional</small></span>
                <div className={styles.logoControl}>
                  <div className={styles.logoPreview} data-has-logo={logoUrl ? true : undefined} style={logoUrl ? undefined : identityStyle(data.workspace.id)}>
                    {logoUrl ? <Image alt={`${form.name || "Company"} logo`} fill sizes="72px" src={logoUrl} unoptimized /> : <span aria-hidden="true">{identityInitials(form.name || "Company")}</span>}
                  </div>
                  <div className={styles.logoActions}>
                    <strong>{logoUrl ? "Logo ready" : "Add your company mark"}</strong>
                    <small>Shown on your sign-in screen and throughout the workspace.</small>
                    <div>
                      <Button isDisabled={isRemovingLogo} isLoading={isUploadingLogo} onPress={() => fileInput.current?.click()} size="compact" variant="quiet"><Upload aria-hidden="true" size={14} />{logoUrl ? "Replace logo" : "Choose logo"}</Button>
                      {logoUrl ? <Button isDisabled={isUploadingLogo} isLoading={isRemovingLogo} onPress={() => void removeLogo()} size="compact" variant="quiet"><Trash2 aria-hidden="true" size={14} />Remove</Button> : null}
                    </div>
                  </div>
                </div>
                <input accept="image/png,image/jpeg,image/webp" aria-label="Choose company logo" className={styles.fileInput} disabled={isUploadingLogo || isRemovingLogo} onChange={(event) => void uploadLogo(event)} ref={fileInput} type="file" />
                {logoError ? <small className={styles.logoError} role="alert">{logoError}</small> : <small>PNG, JPEG, or WebP · 64–4096 px · up to 5 MB</small>}
              </div>
              <div className={styles.colourField}><label htmlFor="onboarding-primary-colour">Primary colour</label><div><input aria-label="Primary colour" id="onboarding-primary-colour" onChange={(event) => update("primaryColor", event.target.value.toUpperCase())} type="color" value={form.primaryColor ?? DEFAULT_WORKSPACE_PRIMARY_COLOR} /><code>{form.primaryColor ?? DEFAULT_WORKSPACE_PRIMARY_COLOR}</code><Button isDisabled={!form.primaryColor} onPress={() => update("primaryColor", null)} size="compact" variant="quiet">Use default</Button></div><small>Used for actions and selected states. Accessible shades are created automatically.</small></div>
            </div> : null}

            {step === "organization" ? <div className={styles.fields}>
              <ComboboxField isRequired items={currencies} label="Base currency" onSelectionChange={(key) => key && update("defaultCurrency", String(key))} placeholder="Search currencies" selectedKey={form.defaultCurrency} />
              <ComboboxField isRequired items={timeZones} label="Time zone" onSelectionChange={(key) => key && update("defaultTimezone", String(key))} placeholder="Search time zones" selectedKey={form.defaultTimezone} />
              <SelectField items={localeOptions} label="Language & number format" onSelectionChange={(key) => key && update("defaultLocale", String(key))} selectedKey={form.defaultLocale} />
              <div className={styles.splitFields}><SelectField items={[{ id: "metric", label: "Metric" }, { id: "imperial", label: "Imperial" }, { id: "mixed", label: "Mixed" }]} label="Measurement system" onSelectionChange={(key) => key && update("unitSystem", String(key))} selectedKey={form.unitSystem} /><SelectField items={[{ id: "0", label: "Sunday" }, { id: "1", label: "Monday" }, { id: "6", label: "Saturday" }]} label="Week starts on" onSelectionChange={(key) => key && update("weekStartsOn", String(key))} selectedKey={form.weekStartsOn} /></div>
            </div> : null}

            {step === "team" ? <div className={styles.teamStep}>
              <div className={styles.inviteFields}><TextInput label="Team member name" onChange={(value) => { setInviteName(value); setFailure(""); }} placeholder="Full name" value={inviteName} /><TextInput inputType="email" label="Work email" onChange={(value) => { setInviteEmail(value); setFailure(""); }} placeholder="name@company.com" value={inviteEmail} /><Button isDisabled={busy} onPress={inviteMember} variant="quiet"><UserPlus size={15} />Send invitation</Button></div>
              {invited.length ? <ul className={styles.invited}>{invited.map((email) => <li key={email}><CheckCircle2 size={15} /><span>{email}</span><small>Invited as member</small></li>)}</ul> : <div className={styles.optional}><UserPlus size={19} /><p>You can skip this step and invite your team from Workspace settings at any time.</p></div>}
            </div> : null}

            {step === "integrations" ? <div className={styles.connectionStep}>
              <div className={styles.connectionList}><div><span><Link2 size={17} /></span><p><strong>Google Workspace</strong><small>Calendar, Gmail, and Drive</small></p></div><div><span><Link2 size={17} /></span><p><strong>WhatsApp Business</strong><small>Customer conversations</small></p></div><div><span><Link2 size={17} /></span><p><strong>Accounting</strong><small>QuickBooks or Zoho Books</small></p></div></div>
              <label className={styles.connectionChoice}><input checked={openConnections} onChange={(event) => setOpenConnections(event.target.checked)} type="checkbox" /><span><strong>Open Connections after setup</strong><small>You will approve each provider separately.</small></span></label>
            </div> : null}

            <footer>
              <Button isDisabled={currentIndex === 0 || busy || isUploadingLogo || isRemovingLogo} onPress={goBack} variant="quiet"><ArrowLeft aria-hidden="true" size={15} />Back</Button>
              <span aria-live="polite">{status}</span>
              {step === "workspace_profile" || step === "organization" ? <Button isDisabled={isUploadingLogo || isRemovingLogo} isLoading={busy} onPress={continueFromProfile} variant="primary">Save and continue<ArrowRight aria-hidden="true" size={15} /></Button>
                : step === "team" ? <Button isLoading={busy} onPress={continueFromTeam} variant="primary">Continue<ArrowRight aria-hidden="true" size={15} /></Button>
                  : <Button isLoading={busy} onPress={finish} variant="primary"><Sparkles aria-hidden="true" size={15} />Finish setup</Button>}
            </footer>
          </div>
        </section>
      </main>
    </DesignSystemProvider>
  );
}
