"use client";

import { LogOut, Mail, MessageCircle, Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Button, SelectField } from "@/design-system";
import { useLanguage, useT } from "@/lib/i18n/i18n-provider";
import { LANGUAGE_COOKIE, languages } from "@/lib/i18n/languages";
import type { PortalSite } from "@/lib/client-portal/types";
import { whatsappUrl } from "@/lib/phone";
import styles from "./portal.module.css";

/** The tenant's own page: their logo and name on top, their contacts at the foot, Wodana only as "Powered by". */
export function PortalFrame({ site, children, onSignOut }: { site: PortalSite; children: ReactNode; onSignOut?: () => void }) {
  const t = useT();
  const router = useRouter();
  const { language } = useLanguage();
  const whatsapp = site.support.whatsapp ? whatsappUrl(site.support.whatsapp) : null;
  const chooseLanguage = (key: string) => {
    document.cookie = `${LANGUAGE_COOKIE}=${key}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    router.refresh();
  };
  return <div className={styles.page}>
    <header className={styles.header}>
      <span className={styles.brand}>
        {site.brand.logoUrl
          // eslint-disable-next-line @next/next/no-img-element -- the tenant's logo, served by our own route or their HTTPS host
          ? <img alt={site.brand.name} className={styles.logo} src={site.brand.logoUrl} />
          : <span className={styles.brandName}>{site.brand.name}</span>}
      </span>
      {onSignOut ? <Button size="compact" variant="quiet" onPress={onSignOut}><LogOut aria-hidden="true" data-directional="true" size={15} />{t("Sign out")}</Button> : null}
    </header>
    <main className={styles.main}>{children}</main>
    <footer className={styles.footer}>
      <div className={styles.support}>
        {site.support.phone ? <a href={`tel:${site.support.phone}`}><Phone aria-hidden="true" size={14} /> {site.support.phone}</a> : null}
        {whatsapp ? <a href={whatsapp} rel="noreferrer" target="_blank"><MessageCircle aria-hidden="true" size={14} /> {t("WhatsApp")}</a> : null}
        {site.support.email ? <a href={`mailto:${site.support.email}`}><Mail aria-hidden="true" size={14} /> {site.support.email}</a> : null}
        {site.gallerySlug ? <a href={`/gallery/${site.gallerySlug}`} rel="noreferrer" target="_blank">{t("Our work")}</a> : null}
      </div>
      <div className={styles.footerEnd}>
        <div className={styles.language}>
          <SelectField aria-label={t("Language")} label={null} selectedKey={language} onSelectionChange={(key) => key && chooseLanguage(String(key))}
            items={languages.map((item) => ({ id: item.id, label: item.label }))} />
        </div>
        <span className={styles.powered}>{t("Powered by Wodana")}</span>
      </div>
    </footer>
  </div>;
}
