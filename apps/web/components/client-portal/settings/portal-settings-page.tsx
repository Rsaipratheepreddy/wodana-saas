"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DesignSystemProvider, EmailInput, ErrorState, InlineNotice, PhoneField, SaveBar, SettingsPage, SettingsRow, SettingsSection, Skeleton, Switch, TextAreaField, TextInput,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { staffPortalApi } from "@/lib/client-portal/client";
import { PORTAL_SECTIONS, type PortalSection, type PortalSettings, type PortalSite } from "@/lib/client-portal/types";
import { joinPhone, splitPhone } from "@/lib/phone";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { usePortalLabels } from "../portal-labels";
import styles from "./portal-settings.module.css";

type Draft = Omit<PortalSettings, "support"> & { support: { phone: { country: string; national: string }; email: string; whatsapp: { country: string; national: string } } };

const toDraft = (settings: PortalSettings, country: string): Draft => ({
  ...settings,
  support: { phone: splitPhone(settings.support.phone, country), email: settings.support.email, whatsapp: splitPhone(settings.support.whatsapp, country) },
});

/** Settings → Client portal: whether clients can sign in, what they see, the welcome and support contacts, and a live preview in the real brand. */
export function PortalSettingsPage({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const labels = usePortalLabels();
  const api = useMemo(() => staffPortalApi(workspaceId, t), [workspaceId, t]);
  const [site, setSite] = useState<PortalSite | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await api.settings();
      const next = toDraft(result.settings, result.site.region.country ?? "");
      setSite(result.site); setSaved(next); setDraft(next); setCanManage(result.canManage); setError("");
    } catch (cause) { setError((cause as Error).message); }
  }, [api]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  if (error && !draft) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!draft || !saved || !site) return <Skeleton lines={8} shape="form" />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const editable = canManage && !busy;
  const change = (patch: Partial<Draft>) => { setNotice(""); setJustSaved(false); setDraft((current) => (current ? { ...current, ...patch } : current)); };
  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.saveSettings({
        version: draft.version, enabled: draft.enabled, sections: draft.sections, progress: draft.progress, invoiceAmounts: draft.invoiceAmounts,
        welcomeTitle: draft.welcomeTitle, welcomeText: draft.welcomeText,
        support: { phone: joinPhone(draft.support.phone.country, draft.support.phone.national), email: draft.support.email,
          whatsapp: joinPhone(draft.support.whatsapp.country, draft.support.whatsapp.national) },
      });
      const next = toDraft(result.settings, result.site.region.country ?? "");
      setSite(result.site); setSaved(next); setDraft(next); setJustSaved(true);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const progressRows: Array<[keyof Draft["progress"], string]> = [["stageNames", t("Stage names")], ["dates", t("Dates")], ["updates", t("Updates the team shares")],
    ["photos", t("Site photos the team shares")]];
  return <SettingsPage title={t("Client portal")}>
    {error ? <InlineNotice tone="error" message={error} /> : null}
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    <SettingsSection id="portal-access" title={t("Access")}>
      <SettingsRow label={t("Clients can sign in")} hint={saved.enabled ? <a className={styles.link} href={`/portal/${draft.slug}`} rel="noreferrer" target="_blank">{t("Open the portal")}<ArrowUpRight aria-hidden="true" data-directional="true" size={12} /></a> : undefined}>
        <Switch aria-label={t("Clients can sign in")} isDisabled={!editable} isSelected={draft.enabled} onChange={(enabled) => change({ enabled })} />
      </SettingsRow>
      <SettingsRow label={t("Logo, name, colours and fonts")}><Link className={styles.link} href="/workspace/company">{t("Edit brand")}</Link></SettingsRow>
    </SettingsSection>
    <SettingsSection id="portal-sections" title={t("What clients see")}>
      {PORTAL_SECTIONS.map((section: PortalSection) => <SettingsRow key={section} label={labels.sections[section]}>
        <Switch aria-label={labels.sections[section]} isDisabled={!editable} isSelected={draft.sections[section]} onChange={(on) => change({ sections: { ...draft.sections, [section]: on } })} />
      </SettingsRow>)}
    </SettingsSection>
    <SettingsSection id="portal-progress" title={t("Progress shows")}>
      {progressRows.map(([key, label]) => <SettingsRow key={key} label={label}>
        <Switch aria-label={label} isDisabled={!editable || !draft.sections.progress} isSelected={draft.progress[key]} onChange={(on) => change({ progress: { ...draft.progress, [key]: on } })} />
      </SettingsRow>)}
      <SettingsRow label={t("Invoice amounts")}>
        <Switch aria-label={t("Invoice amounts")} isDisabled={!editable || !draft.sections.payments} isSelected={draft.invoiceAmounts} onChange={(invoiceAmounts) => change({ invoiceAmounts })} />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection id="portal-welcome" title={t("Welcome")}>
      <div className={styles.fields}>
        <TextInput isDisabled={!editable} label={t("Welcome title")} value={draft.welcomeTitle} onChange={(welcomeTitle) => change({ welcomeTitle })} maxLength={120} />
        <TextAreaField isDisabled={!editable} label={t("Welcome text")} value={draft.welcomeText} onChange={(welcomeText) => change({ welcomeText })} maxLength={500} />
      </div>
    </SettingsSection>
    <SettingsSection id="portal-support" title={t("Support contacts")}>
      <div className={styles.fields}>
        <PhoneField kind="any" label={t("Phone")} value={draft.support.phone.national} countryCode={draft.support.phone.country} locale={site.region.locale}
          onChange={(national) => change({ support: { ...draft.support, phone: { ...draft.support.phone, national } } })}
          onCountryChange={(country) => change({ support: { ...draft.support, phone: { ...draft.support.phone, country } } })} />
        <PhoneField label={t("WhatsApp")} value={draft.support.whatsapp.national} countryCode={draft.support.whatsapp.country} locale={site.region.locale}
          onChange={(national) => change({ support: { ...draft.support, whatsapp: { ...draft.support.whatsapp, national } } })}
          onCountryChange={(country) => change({ support: { ...draft.support, whatsapp: { ...draft.support.whatsapp, country } } })} />
        <EmailInput isDisabled={!editable} label={t("Email")} value={draft.support.email} onChange={(email) => change({ support: { ...draft.support, email } })} maxLength={254} />
      </div>
    </SettingsSection>
    <SettingsSection id="portal-preview" title={t("Preview")}>
      <PortalPreview site={site} draft={draft} />
    </SettingsSection>
    {canManage ? <SaveBar isDirty={dirty} isSaving={busy} saved={justSaved} onDiscard={() => { setDraft(saved); setError(""); }} onSave={() => void save()} /> : null}
  </SettingsPage>;
}

/** The portal's first screen as a client will see it: the real logo, name, surface, colours and fonts (the portal is always light). */
function PortalPreview({ site, draft }: { site: PortalSite; draft: Draft }) {
  const t = useT();
  const labels = usePortalLabels();
  const style = workspacePrimaryColorStyle({ primaryColor: site.brand.primaryColor, secondaryColor: site.brand.secondaryColor, headingFont: site.brand.headingFont, bodyFont: site.brand.bodyFont });
  const tabs = ["overview" as const, ...PORTAL_SECTIONS.filter((section) => draft.sections[section])];
  return <div className={styles.preview}>
    <DesignSystemProvider theme="light" style={style}>
      <div aria-hidden="true" className={styles.previewFrame}>
        <div className={styles.previewHeader}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the tenant's own logo */}
          {site.brand.logoUrl ? <img alt="" className={styles.previewLogo} src={site.brand.logoUrl} /> : <span className={styles.previewName}>{site.brand.name}</span>}
        </div>
        <div className={styles.previewBody}>
          <p className={styles.previewTitle}>{draft.welcomeTitle || t("Welcome")}</p>
          <p className={styles.previewText}>{draft.welcomeText || t("Sign in to follow your project.")}</p>
          <div className={styles.previewTabs}>{tabs.map((tab, index) => <span className={styles.previewTab} data-selected={index === 0} key={tab}>{labels.sections[tab]}</span>)}</div>
          <div><span className={styles.previewAction}>{t("Send code by WhatsApp")}</span></div>
        </div>
        <div className={styles.previewFooter}>{t("Powered by Wodana")}</div>
      </div>
    </DesignSystemProvider>
  </div>;
}
