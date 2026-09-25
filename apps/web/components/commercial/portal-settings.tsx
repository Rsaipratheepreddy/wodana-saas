"use client";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button, InlineNotice, SelectField, SettingsPage, SettingsRow, SettingsSection, Switch, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import p from "./portal-settings.module.css";
import type { PortalBrand, PortalSettings } from "@/lib/commercial/types";
import { commercialPath, jsonRequest } from "@/lib/commercial/client";
import s from "./commercial.module.css";
export function BrandLogo({ brand }: { brand: PortalBrand }) {
  return (
    <div className={s.logo}>
      {brand.logo ? (
        <Image
          unoptimized
          src={brand.logo}
          alt={brand.name}
          width={160}
          height={48}
          style={{ objectFit: "contain", width: "auto", height: "auto" }}
        />
      ) : (
        <>
          <span
            className={s.logoMark}
            aria-hidden
            style={{
              background: brand.primaryColor,
            }}
          >
            {brand.name
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join("")
              .toUpperCase()}
          </span>
          <span>{brand.name}</span>
        </>
      )}
    </div>
  );
}
export function PortalSettingsPage({ initial }: { initial: PortalSettings }) {
  const t = useT();
  const [data, setData] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const editable = Boolean(data.canManage) && !busy;
  const dirty = JSON.stringify({ enabled: data.enabled, brand: data.brand }) !== JSON.stringify({ enabled: saved.enabled, brand: saved.brand });
  const patch = (value: Partial<PortalBrand>) => { setNotice(""); setData((current) => ({ ...current, brand: { ...current.brand, ...value } })); };
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      // Brand identity (name, logo, colours) comes from the tenant brand; the portal stores only its own content.
      const next = await jsonRequest<PortalSettings>(commercialPath(data.workspaceId, "portal-settings"), "PUT", { version: data.version, enabled: data.enabled, brand: data.brand });
      setData(next); setSaved(next); setNotice(t("Portal settings saved."));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsPage actions={data.canManage ? <Button variant="primary" size="compact" isDisabled={!dirty} isLoading={busy} onPress={() => void save()}>{t("Save")}</Button> : null} aria-label={t("Client portal")} title={t("Client portal")}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {notice ? <InlineNotice tone="success" message={notice} /> : null}
      <SettingsSection id="portal-access" title={t("Access")}>
        <SettingsRow hint={data.enabled ? <a className={p.link} href={`/portal/${data.slug}`} target="_blank" rel="noreferrer">{t("Open portal")}<ArrowUpRight size={12} aria-hidden="true" /></a> : undefined} label={t("Clients can sign in to the portal")}>
          <Switch aria-label={t("Clients can sign in to the portal")} isDisabled={!editable} isSelected={data.enabled} onChange={(enabled) => { setNotice(""); setData((current) => ({ ...current, enabled })); }} />
        </SettingsRow>
        <SettingsRow label={t("Logo, name and colours")}><Link className={p.link} href="/workspace/company">{t("Edit brand")}</Link></SettingsRow>
      </SettingsSection>
      <SettingsSection id="portal-welcome" title={t("Welcome")}>
        <div className={p.fields}>
          <TextInput isDisabled={!editable} label={t("Welcome title")} value={data.brand.welcomeTitle} onChange={(welcomeTitle) => patch({ welcomeTitle })} maxLength={120} />
          <TextAreaField isDisabled={!editable} label={t("Welcome message")} value={data.brand.welcomeText} onChange={(welcomeText) => patch({ welcomeText })} maxLength={500} />
          <TextInput isDisabled={!editable} inputType="tel" label={t("Support phone")} value={data.brand.supportPhone} onChange={(supportPhone) => patch({ supportPhone })} maxLength={40} />
          <SelectField isDisabled={!editable} label={t("Layout")} selectedKey={data.brand.layout} items={[{ id: "minimal", label: t("Minimal") }, { id: "soft", label: t("Soft") }]} onSelectionChange={(key) => key && patch({ layout: key as PortalBrand["layout"] })} />
        </div>
      </SettingsSection>
      <SettingsSection id="portal-preview" title={t("Preview")}>
        <aside className={p.preview} aria-label={t("Preview")} data-layout={data.brand.layout}>
          <BrandLogo brand={data.brand} />
          <h2>{data.brand.welcomeTitle}</h2>
          <p>{data.brand.welcomeText}</p>
          {data.brand.supportPhone ? <p className={p.hint}>{data.brand.supportPhone}</p> : null}
          <span className={p.previewAction} style={{ background: data.brand.primaryColor }}>{t("View project")}</span>
        </aside>
      </SettingsSection>
    </SettingsPage>
  );
}
