import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { WodanaLogo } from "@/components/brand";
import { ContactSalesForm } from "@/components/sales/contact-sales-form";
import { DesignSystemProvider } from "@/design-system";
import { getServerT } from "@/lib/i18n/server";
import type { PublicSalesForm } from "@/lib/sales/contact-form";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { LandingHeader } from "./landing-header";
import { SHOTS, shotReady, type Shot } from "./landing-shots";
import styles from "./landing.module.css";

/** Wodana's brand green (the house in the logo). Actions use its accessible shade from the brand tokens. */
export const WODANA_GREEN = "#01A92D";

type T = Awaited<ReturnType<typeof getServerT>>;

/** A screenshot in a soft frame; the size is known up front so nothing shifts while it loads. */
function Frame({ shot, t, sizes, priority = false, className }: { shot: Shot; t: T; sizes: string; priority?: boolean; className?: string }) {
  return <div className={[styles.frame, className].filter(Boolean).join(" ")}>
    <Image alt={t(shot.alt)} height={shot.height} priority={priority} sizes={sizes} src={shot.src} width={shot.width} />
  </div>;
}

function Phone({ shot, t }: { shot: Shot; t: T }) {
  return <div className={styles.phone}>
    <div className={styles.phoneScreen}>
      <Image alt={t(shot.alt)} height={shot.height} sizes="(max-width: 720px) 70vw, 280px" src={shot.src} width={shot.width} />
    </div>
  </div>;
}

/** A row's screenshot, with an optional second one layered in front; nothing until the main one exists. */
function Visual({ main, front, t }: { main: Shot; front?: Shot; t: T }) {
  if (!shotReady(main)) return null;
  return <div className={styles.featureVisual}>{front && shotReady(front)
    ? <div className={styles.stack}>
      <Frame shot={main} sizes="(max-width: 960px) 100vw, 720px" t={t} />
      <Frame className={styles.stackFront} shot={front} sizes="(max-width: 960px) 60vw, 420px" t={t} />
    </div>
    : <Frame shot={main} sizes="(max-width: 960px) 100vw, 720px" t={t} />}</div>;
}

function Feature({ id, tag, title, copy, visual, flip = false }: { id: string; tag: string; title: string; copy: string; visual: ReactNode; flip?: boolean }) {
  return <article aria-labelledby={`${id}-title`} className={styles.feature} data-flip={flip || undefined} data-plain={visual ? undefined : true}>
    <div className={styles.featureCopy}>
      <span className={styles.tag}>{tag}</span>
      <h2 className={styles.featureTitle} id={`${id}-title`}>{title}</h2>
      <p className={styles.featureText}>{copy}</p>
    </div>
    {visual}
  </article>;
}

/** The page frame shared by the landing page and /contact-sales: brand tokens, header and footer. */
export async function MarketingFrame({ children, onLanding = true }: { children: ReactNode; onLanding?: boolean }) {
  const t = await getServerT();
  return <DesignSystemProvider className={styles.page} style={workspacePrimaryColorStyle(WODANA_GREEN)} theme="light">
    <a className={styles.skip} href="#main">{t("Skip to content")}</a>
    <LandingHeader onLanding={onLanding} />
    <main id="main">{children}</main>
    <LandingFooter t={t} onLanding={onLanding} />
  </DesignSystemProvider>;
}

function LandingFooter({ t, onLanding }: { t: T; onLanding: boolean }) {
  const base = onLanding ? "" : "/";
  return <footer className={styles.footer}>
    <div className={styles.footerInner}>
      <Link aria-label={t("Wodana home")} className={styles.brand} href="/"><WodanaLogo size="small" /></Link>
      <nav aria-label={t("Footer")} className={styles.footerLinks}>
        <a href={`${base}#product`}>{t("Product")}</a>
        <a href={`${base}#mobile`}>{t("Mobile app")}</a>
        <Link href="/contact-sales">{t("Contact sales")}</Link>
        <Link href="/login">{t("Sign in")}</Link>
      </nav>
      <small className={styles.copyright}>{t("© {year} Wodana", { year: new Date().getFullYear() })}</small>
    </div>
  </footer>;
}

/** The "Contact sales" section: a short promise and the form operators configure in Wodana Control. */
export async function ContactSection({ form, source, headingLevel = 2 }: { form: PublicSalesForm; source: string; headingLevel?: 1 | 2 }) {
  const t = await getServerT();
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return <section aria-labelledby="contact-title" className={styles.contact} data-standalone={headingLevel === 1 || undefined} id="contact">
    <div className={styles.contactInner}>
      <div className={styles.contactCopy}>
        <Heading className={styles.sectionTitle} id="contact-title">{t("Talk to sales")}</Heading>
        <p className={styles.lead}>{t("Tell us about your firm. We'll show you Wodana with work like yours.")}</p>
      </div>
      <div className={styles.contactForm}><ContactSalesForm form={form} source={source} /></div>
    </div>
  </section>;
}

/** Wodana's public landing page: minimal, white, one green accent, real product screenshots. */
export async function LandingPage({ form }: { form: PublicSalesForm }) {
  const t = await getServerT();
  const phones = [SHOTS.mobileTasks, SHOTS.mobileReport, SHOTS.mobileMe].filter(shotReady);
  return <MarketingFrame>
    <section aria-labelledby="hero-title" className={styles.hero}>
      <h1 className={styles.heroTitle} id="hero-title">{t("Every job, from enquiry to handover.")}</h1>
      <p className={styles.heroLead}>{t("Wodana runs sales, projects, purchasing and site work for interior and fit-out firms.")}</p>
      <div className={styles.heroActions}>
        <a className={styles.pillPrimary} href="#contact">{t("Contact sales")}</a>
        <Link className={styles.pillSecondary} href="/login">{t("Sign in")}</Link>
      </div>
      {shotReady(SHOTS.home) ? <div className={styles.heroVisual}>
        <Frame priority shot={SHOTS.home} sizes="(max-width: 1280px) 100vw, 1200px" t={t} />
      </div> : null}
    </section>

    <section aria-label={t("Product")} className={styles.features} id="product">
      <Feature id="sales" tag={t("Sales")} title={t("Win the work.")}
        copy={t("Every enquiry on one board, and priced proposals clients can accept online.")}
        visual={<Visual front={SHOTS.quotation} main={SHOTS.pipeline} t={t} />} />
      <Feature flip id="projects" tag={t("Projects")} title={t("Plan every stage.")}
        copy={t("Turn the signed scope into tasks, owners and dates on one shared timeline.")}
        visual={<Visual main={SHOTS.plan} t={t} />} />
      <Feature id="operations" tag={t("Purchasing and factory")} title={t("Order, make, deliver.")}
        copy={t("Buy from suppliers, receive into stock and follow factory work for each project.")}
        visual={<Visual front={SHOTS.factory} main={SHOTS.purchasing} t={t} />} />
      <Feature flip id="portal" tag={t("Client portal")} title={t("Keep clients close.")}
        copy={t("Clients follow progress, approve choices and see what's next on their own page.")}
        visual={<Visual main={SHOTS.portal} t={t} />} />
    </section>

    <section aria-labelledby="mobile-title" className={styles.mobile} id="mobile">
      <div className={styles.centered}>
        <span className={styles.tag}>{t("Mobile app")}</span>
        <h2 className={styles.sectionTitle} id="mobile-title">{t("The site, in your pocket.")}</h2>
        <p className={styles.lead}>{t("Site teams see their tasks, mark attendance and send the daily report from their phone.")}</p>
      </div>
      {phones.length ? <div className={styles.phones}>{phones.map((shot) => <Phone key={shot.src} shot={shot} t={t} />)}</div> : null}
    </section>

    <section aria-labelledby="fit-title" className={styles.fit} id="fit">
      <h2 className={styles.fitTitle} id="fit-title">{t("Made for interior, fit-out and joinery firms.")}</h2>
      <p className={styles.lead}>{t("Works in any country, currency and language.")}</p>
    </section>

    <ContactSection form={form} source="landing" />
  </MarketingFrame>;
}
