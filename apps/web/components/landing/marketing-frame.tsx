import type { ReactNode } from "react";
import Link from "next/link";
import { WodanaLogo } from "@/components/brand";
import { getServerT } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/keys";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { LandingHeader } from "./landing-header";
import { COMPANY_LINKS, LEGAL_LINKS, PRODUCT_LINKS, SOLUTION_LINKS, type MarketingLink } from "./marketing-links";
import { MarketingSurface } from "./marketing-surface";
import styles from "./marketing.module.css";

/** Wodana's brand green (the house in the logo). Actions use its accessible shade from the brand tokens. */
export const WODANA_GREEN = "#01A92D";

function FooterColumn({ title, links, extra, t }: { title: string; links: MarketingLink[]; extra?: ReactNode; t: Translate }) {
  return <div className={styles.footerColumn}>
    <h2 className={styles.footerHeading}>{title}</h2>
    <ul>
      {links.map((link) => <li key={link.id}><a href={link.href}>{t(link.label)}</a></li>)}
      {extra}
    </ul>
  </div>;
}

function MarketingFooter({ t }: { t: Translate }) {
  return <footer className={styles.footer}>
    <div className={styles.footerInner}>
      <div className={styles.footerBrand}>
        <Link aria-label={t("Wodana home")} className={styles.footerLogo} href="/"><WodanaLogo /></Link>
        <p>{t("Sales, projects, purchasing and site work for interior, fit-out and joinery firms.")}</p>
      </div>
      <nav aria-label={t("Footer")} className={styles.footerColumns}>
        <FooterColumn links={PRODUCT_LINKS} t={t} title={t("Product")}
          // eslint-disable-next-line @next/next/no-html-link-for-pages -- a hash link on the landing page, like the others here
          extra={<li><a href="/#woddy">{t("Woddy AI")}</a></li>} />
        <FooterColumn links={SOLUTION_LINKS} t={t} title={t("Solutions")} />
        <FooterColumn links={COMPANY_LINKS} t={t} title={t("Company")} />
        <div className={styles.footerColumn}>
          <h2 className={styles.footerHeading}>{t("Get started")}</h2>
          <ul>
            <li><Link href="/contact-sales">{t("Contact sales")}</Link></li>
            <li><Link href="/login">{t("Sign in")}</Link></li>
          </ul>
        </div>
      </nav>
    </div>
    <div className={styles.footerBase}>
      <small>{t("© {year} Wodana", { year: new Date().getFullYear() })}</small>
      <nav aria-label={t("Legal and contact")} className={styles.footerLegal}>
        {LEGAL_LINKS.map((link) => <Link href={link.href} key={link.id}>{t(link.label)}</Link>)}
      </nav>
      <small>{t("Works in English and Arabic, in any currency.")}</small>
    </div>
  </footer>;
}

/** The frame every public page shares: brand tokens in the visitor's theme, the header with its menus, and the footer. */
export async function MarketingFrame({ children, onLanding = false }: { children: ReactNode; onLanding?: boolean }) {
  const t = await getServerT();
  return <MarketingSurface className={styles.page} style={workspacePrimaryColorStyle(WODANA_GREEN)}>
    <a className={styles.skip} href="#main">{t("Skip to content")}</a>
    <LandingHeader onLanding={onLanding} />
    <main id="main">{children}</main>
    <MarketingFooter t={t} />
  </MarketingSurface>;
}

/** The top of a company page: its one title and a short line. */
export function MarketingIntro({ title, lead }: { title: string; lead: string }) {
  return <section aria-labelledby="page-title" className={styles.intro}>
    <h1 className={styles.introTitle} id="page-title">{title}</h1>
    <p className={styles.introLead}>{lead}</p>
  </section>;
}

/** A calm panel for a company page's content, or its "coming soon" state. */
export function MarketingPanel({ children, label }: { children: ReactNode; label: string }) {
  return <section aria-label={label} className={styles.panel}>{children}</section>;
}
