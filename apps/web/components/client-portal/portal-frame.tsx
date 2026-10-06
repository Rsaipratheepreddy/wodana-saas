"use client";

import { LogOut, Mail, MessageCircle, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { LanguageSelect } from "@/components/i18n/language-select";
import { Button } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalSite } from "@/lib/client-portal/types";
import { formatPhoneForDisplay, whatsappUrl } from "@/lib/phone";
import styles from "./portal.module.css";

/** The tenant's own page: their logo and name on top, their contacts at the foot, Wodana only as "Powered by". */
export function PortalFrame({ site, children, onSignOut, bare = false }: { site: PortalSite; children: ReactNode; onSignOut?: () => void;
  /** The signed-in dashboard brings its own sidebar and top bar. */
  bare?: boolean }) {
  const t = useT();
  const whatsapp = site.support.whatsapp ? whatsappUrl(site.support.whatsapp) : null;
  if (bare) return <div className={styles.page} data-bare="">{children}</div>;
  return <div className={styles.page}>
    <header className={styles.header}>
      <span className={styles.brand}>
        {site.brand.logoUrl
          // eslint-disable-next-line @next/next/no-img-element -- the tenant's logo, served by our own route or their HTTPS host
          ? <img alt={site.brand.name} className={styles.logo} src={site.brand.logoUrl} />
          : <span className={styles.brandName}>{site.brand.name}</span>}
      </span>
      <div className={styles.headerEnd}>
        <LanguageSelect className={styles.language} compact label={null} />
        {onSignOut ? <Button size="compact" variant="quiet" onPress={onSignOut}><LogOut aria-hidden="true" data-directional="true" size={15} /><span className={styles.signOutLabel}>{t("Sign out")}</span></Button> : null}
      </div>
    </header>
    <main className={styles.main}>{children}</main>
    <footer className={styles.footer}>
      <div className={styles.support}>
        {site.support.phone ? <a href={`tel:${site.support.phone}`}><Phone aria-hidden="true" size={14} /> <bdi dir="ltr">{formatPhoneForDisplay(site.support.phone)}</bdi></a> : null}
        {whatsapp ? <a href={whatsapp} rel="noreferrer" target="_blank"><MessageCircle aria-hidden="true" size={14} /> {t("WhatsApp")}</a> : null}
        {site.support.email ? <a href={`mailto:${site.support.email}`}><Mail aria-hidden="true" size={14} /> <bdi dir="ltr">{site.support.email}</bdi></a> : null}
        {site.gallerySlug ? <a href={`/gallery/${site.gallerySlug}`} rel="noreferrer" target="_blank">{t("Our work")}</a> : null}
      </div>
      <div className={styles.footerEnd}>
        <span className={styles.powered}>{t("Powered by Wodana")}</span>
      </div>
    </footer>
  </div>;
}

/** The tenant's logo (or name), for the dashboard's sidebar. */
export function PortalBrand({ site }: { site: PortalSite }) {
  return <span className={styles.brand}>
    {site.brand.logoUrl
      // eslint-disable-next-line @next/next/no-img-element -- the tenant's logo, served by our own route or their HTTPS host
      ? <img alt={site.brand.name} className={styles.logo} src={site.brand.logoUrl} />
      : <span className={styles.brandName}>{site.brand.name}</span>}
  </span>;
}

/** Language and sign out, for the dashboard's top bar. */
export function PortalActions({ onSignOut }: { onSignOut?: () => void }) {
  const t = useT();
  return <div className={styles.headerEnd}>
    <LanguageSelect className={styles.language} compact label={null} />
    {onSignOut ? <Button size="compact" variant="quiet" onPress={onSignOut}><LogOut aria-hidden="true" data-directional="true" size={15} /><span className={styles.signOutLabel}>{t("Sign out")}</span></Button> : null}
  </div>;
}

/** The firm's contacts and "Powered by", at the foot of the dashboard's sidebar. */
export function PortalSupport({ site }: { site: PortalSite }) {
  const t = useT();
  const whatsapp = site.support.whatsapp ? whatsappUrl(site.support.whatsapp) : null;
  return <div className={styles.sideSupport}>
    {site.support.phone ? <a href={`tel:${site.support.phone}`}><Phone aria-hidden="true" size={13} /> <bdi dir="ltr">{formatPhoneForDisplay(site.support.phone)}</bdi></a> : null}
    {whatsapp ? <a href={whatsapp} rel="noreferrer" target="_blank"><MessageCircle aria-hidden="true" size={13} /> {t("WhatsApp")}</a> : null}
    {site.support.email ? <a href={`mailto:${site.support.email}`}><Mail aria-hidden="true" size={13} /> <bdi dir="ltr">{site.support.email}</bdi></a> : null}
    <span className={styles.powered}>{t("Powered by Wodana")}</span>
  </div>;
}
