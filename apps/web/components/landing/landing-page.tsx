import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight, BadgeCheck, Camera, ClipboardCheck, Coins, Inbox, Languages, MapPin, MessageCircle, BookOpen, Calculator,
  CalendarDays, ShieldCheck, Smartphone, Sparkles, WifiOff,
} from "lucide-react";
import { ContactSalesForm } from "@/components/sales/contact-sales-form";
import { getServerT } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/keys";
import type { PublicSalesForm } from "@/lib/sales/contact-form";
import { Phone } from "./devices";
import { FeatureTabs, type FeatureTab } from "./feature-tabs";
import { SHOTS, shotReady, type Shot } from "./landing-shots";
import { MarketingFrame } from "./marketing-frame";
import { SOLUTION_LINKS } from "./marketing-links";
import { Screenshot } from "./screenshot";
import styles from "./landing.module.css";

export { MarketingFrame } from "./marketing-frame";

const DESKTOP_SIZES = "(max-width: 960px) 100vw, 760px";

/** A desktop screenshot in a quiet app window, with an optional second screen layered in front. */
function Window({ main, front, t }: { main: Shot; front?: Shot; t: Translate }) {
  if (!shotReady(main)) return null;
  return <div className={styles.stack} data-layered={front && shotReady(front) ? true : undefined}>
    <div className={styles.window}><Screenshot shot={main} sizes={DESKTOP_SIZES} t={t} /></div>
    {front && shotReady(front)
      ? <div className={`${styles.window} ${styles.windowFront}`}><Screenshot shot={front} sizes="(max-width: 960px) 60vw, 440px" t={t} /></div>
      : null}
  </div>;
}

/** Two phones side by side, for the site tab. */
function PhonePair({ shots, t }: { shots: Shot[]; t: Translate }) {
  const ready = shots.filter(shotReady);
  if (!ready.length) return null;
  return <div className={styles.phonePair}>
    {ready.map((shot, index) => <Phone key={shot.src} kind={index === 0 ? "iphone" : "android"} shot={shot} sizes="(max-width: 960px) 44vw, 260px" t={t} />)}
  </div>;
}

/**
 * The hero's product visual: the app window cycles Home → Sales → Projects (a CSS cross-fade, so no script), with the
 * phone app in front. Only the first screen is fetched eagerly, at high priority; the others load after it.
 */
function HeroVisual({ t }: { t: Translate }) {
  if (!shotReady(SHOTS.home)) return null;
  const layers = [SHOTS.pipeline, SHOTS.plan].filter(shotReady);
  const steps = [t("Home"), t("Sales"), t("Projects")].slice(0, layers.length + 1);
  return <div className={styles.heroStage}>
    <div className={styles.heroWindow}>
      <div aria-hidden="true" className={styles.chrome}><span /><span /><span /></div>
      <div className={styles.heroLayers} data-count={layers.length + 1}>
        <Screenshot priority shot={SHOTS.home} sizes="(max-width: 1240px) 100vw, 1180px" t={t} />
        {layers.map((shot, index) => <Screenshot className={styles.heroLayer} decorative key={shot.src} shot={shot}
          layer={index + 2} sizes="(max-width: 1240px) 100vw, 1180px" t={t} />)}
      </div>
    </div>
    {shotReady(SHOTS.appToday) ? <Phone className={styles.heroPhone} shot={SHOTS.appToday} sizes="(max-width: 720px) 34vw, 240px" t={t} /> : null}
    {layers.length ? <ol aria-hidden="true" className={styles.heroSteps} data-count={steps.length}>
      {steps.map((step) => <li key={step}>{step}</li>)}
    </ol> : null}
  </div>;
}

function SectionHead({ id, tag, title, lead }: { id: string; tag: string; title: string; lead?: string }) {
  return <div className={styles.sectionHead}>
    <span className={styles.tag}>{tag}</span>
    <h2 className={styles.sectionTitle} id={id}>{title}</h2>
    {lead ? <p className={styles.lead}>{lead}</p> : null}
  </div>;
}

/**
 * Woddy's confirm card, drawn in HTML: a request, the change Woddy prepared, and the confirm step. It shows how Woddy
 * works, so it is one described picture for assistive tech rather than a conversation to read.
 */
function WoddyDemo({ t }: { t: Translate }) {
  return <div aria-label={t("An example: Woddy prepares a follow-up and waits for you to confirm it")} className={styles.woddyDemo} role="img">
    <div className={styles.woddyHead}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static brand image */}
      <img alt="" decoding="async" height={36} loading="lazy" src="/brand/woddy/hello.webp" width={36} />
      <strong>{t("Woddy")}</strong>
      <span className={styles.credits}><Coins aria-hidden="true" size={14} />{t("Credits left")}<span className={styles.meter}><span /></span></span>
    </div>
    <p className={styles.ask}>{t("Remind me to call Aisha about the kitchen on Thursday morning.")}</p>
    <p className={styles.reply}>{t("I prepared this for you. Nothing changes until you confirm.")}</p>
    <div className={styles.action}>
      <span className={styles.actionLabel}><Sparkles aria-hidden="true" size={14} />{t("Woddy action")}</span>
      <strong className={styles.actionTitle}>{t("Schedule a follow-up")}</strong>
      <dl className={styles.actionFields}>
        <div><dt>{t("What")}</dt><dd>{t("Call Aisha Karim")}</dd></div>
        <div><dt>{t("When")}</dt><dd>{t("Thursday, 10:00")}</dd></div>
        <div><dt>{t("Record")}</dt><dd>{t("Enquiry · Aisha Karim")}</dd></div>
      </dl>
      <div className={styles.actionButtons}>
        <span data-kind="primary">{t("Confirm")}</span>
        <span>{t("Cancel")}</span>
      </div>
    </div>
  </div>;
}

function Bullet({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <li><span aria-hidden="true" className={styles.bulletIcon}>{icon}</span><span>{children}</span></li>;
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

/** Wodana's public landing page: a calm white page, one green accent, real product screens and one clear action. */
export async function LandingPage({ form }: { form: PublicSalesForm }) {
  const t = await getServerT();

  const tabs: FeatureTab[] = [
    { id: "sales", label: t("Sales"), title: t("Every enquiry on one board."), visual: <Window main={SHOTS.pipeline} t={t} />, points: [
      t("Enquiries from your website, WhatsApp and walk-ins land in one pipeline."),
      t("Every follow-up has an owner and a date, so no lead goes quiet."),
      t("Reports show where enquiries come from and why deals are won or lost."),
    ] },
    { id: "quotes", label: t("Quotes"), title: t("Quotes clients can say yes to."), visual: <Window main={SHOTS.quotation} t={t} />, points: [
      t("Price room by room from your own catalog."),
      t("Each revision is kept, so you always know what was sent."),
      t("Clients approve online, and the project starts from the accepted quote."),
    ] },
    { id: "projects", label: t("Projects"), title: t("Plan every stage, together."), visual: <Window main={SHOTS.plan} t={t} />, points: [
      t("Tasks on a board, list or timeline, with owners and dates."),
      t("See at a glance what is late, blocked or waiting on materials."),
      t("Money, site work and handover live in the same project."),
    ] },
    { id: "purchasing", label: t("Purchasing"), title: t("Order, make, deliver."), visual: <Window front={SHOTS.factory} main={SHOTS.purchasing} t={t} />, points: [
      t("Ask several suppliers for prices, then order with approval."),
      t("A warning before an order takes a project past what the client has paid."),
      t("Factory work orders for everything you make in your own workshop."),
    ] },
    { id: "site", label: t("Site"), title: t("The site reports itself."), visual: <PhonePair shots={[SHOTS.appToday, SHOTS.appReport]} t={t} />, points: [
      t("Check in and out with a photo and location."),
      t("Daily reports with photos, snags and deliveries received."),
      t("Works offline and sends when the signal is back."),
    ] },
    { id: "portal", label: t("Client portal"), title: t("Clients always know what's next."), visual: <Window main={SHOTS.portal} t={t} />, points: [
      t("Progress, decisions and documents on the client's own page."),
      t("Clients approve designs and materials, and sign off the handover."),
      t("Invoices and receipts in one place, and clients tell you when they've paid."),
    ] },
  ];

  const roles: Record<string, { href: string; cta: string; line: string }> = {
    "for-owners": { href: "#product", cta: t("Take the tour"), line: t("Today's work, the pipeline and every project on one Home.") },
    "for-sales-teams": { href: "#sales", cta: t("See Sales"), line: t("Answer every enquiry and follow it up, from the first message to a signed quote.") },
    "for-project-managers": { href: "#projects", cta: t("See Projects"), line: t("Plans, people and materials in step, with the client kept in the loop.") },
    "for-site-teams": { href: "#mobile", cta: t("See the app"), line: t("Attendance, daily reports and snags from the phone, even offline.") },
    "for-finance": { href: "#purchasing", cta: t("See Purchasing"), line: t("Invoices, payments and spend per project, with QuickBooks or Zoho Books.") },
  };

  const phones = [
    { shot: SHOTS.appReport, kind: "android" as const },
    { shot: SHOTS.appToday, kind: "iphone" as const },
    { shot: SHOTS.appInbox, kind: "iphone" as const },
  ].filter(({ shot }) => shotReady(shot));

  return <MarketingFrame onLanding>
    <section aria-labelledby="hero-title" className={styles.hero}>
      <a className={styles.announce} href="#woddy">
        <span className={styles.announceTag}>{t("New")}</span>
        <span>{t("Meet Woddy, your AI teammate")}</span>
        <ArrowRight aria-hidden="true" size={16} />
      </a>
      <h1 className={styles.heroTitle} id="hero-title">{t("Run every job, from first enquiry to final handover.")}</h1>
      <p className={styles.heroLead}>{t("Sales, quotes, projects, purchasing and site work in one calm workspace, with an app for the site and a portal for your clients.")}</p>
      <div className={styles.heroActions}>
        <a className={styles.pillPrimary} href="#contact">{t("Contact sales")}</a>
        <Link className={styles.pillSecondary} href="/login">{t("Sign in")}</Link>
      </div>
      <HeroVisual t={t} />
    </section>

    <section aria-labelledby="trust-title" className={styles.trust}>
      <h2 className={styles.trustTitle} id="trust-title">{t("Built for interior, fit-out and joinery firms")}</h2>
      <ul className={styles.chips}>
        <li><MessageCircle aria-hidden="true" size={18} />{t("WhatsApp")}</li>
        <li><Calculator aria-hidden="true" size={18} />{t("QuickBooks")}</li>
        <li><BookOpen aria-hidden="true" size={18} />{t("Zoho Books")}</li>
        <li><CalendarDays aria-hidden="true" size={18} />{t("Google Workspace")}</li>
        <li><Languages aria-hidden="true" size={18} />{t("Arabic & English")}</li>
        <li><Coins aria-hidden="true" size={18} />{t("Works in any currency")}</li>
      </ul>
    </section>

    <section aria-labelledby="product-title" className={styles.section} id="product">
      <SectionHead id="product-title" lead={t("From the first message to the last snag, everyone works from the same record.")}
        tag={t("Product")} title={t("One workspace for the whole job.")} />
      <FeatureTabs label={t("Product tour")} tabs={tabs} />
    </section>

    <section aria-labelledby="woddy-title" className={styles.section} id="woddy">
      <div className={styles.woddy}>
        <div className={styles.woddyCopy}>
          <span className={styles.tag}>{t("AI")}</span>
          <h2 className={styles.sectionTitle} id="woddy-title">{t("Woddy, your AI teammate.")}</h2>
          <p className={styles.lead}>{t("Ask in plain words. Woddy finds the answer or prepares the change, and nothing happens until you confirm.")}</p>
          <ul className={styles.bullets}>
            <Bullet icon={<Inbox size={18} />}>{t("Finds answers across your enquiries, projects, tasks and chats, and shows where they came from.")}</Bullet>
            <Bullet icon={<BadgeCheck size={18} />}>{t("Prepares follow-ups, tasks and replies as cards you confirm or cancel.")}</Bullet>
            <Bullet icon={<ShieldCheck size={18} />}>{t("Works with your permissions, and never approves, sends quotes or records money.")}</Bullet>
            <Bullet icon={<Coins size={18} />}>{t("Runs on AI credits: every workspace starts with welcome credits, and you always see what is left.")}</Bullet>
          </ul>
        </div>
        <WoddyDemo t={t} />
      </div>
    </section>

    <section aria-labelledby="roles-title" className={styles.section} id="solutions">
      <SectionHead id="roles-title" tag={t("Solutions")} title={t("Built for everyone on the job.")} />
      <ul className={styles.roles}>
        {SOLUTION_LINKS.map((link) => {
          const role = roles[link.id];
          if (!role) return null;
          return <li className={styles.role} id={link.id} key={link.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a small static brand avatar */}
            <img alt="" className={styles.roleAvatar} decoding="async" height={56} loading="lazy" src={link.avatar} width={56} />
            <h3 className={styles.roleTitle}>{t(link.label)}</h3>
            <p className={styles.roleLine}>{role.line}</p>
            <a className={styles.roleLink} href={role.href}>{role.cta}<ArrowRight aria-hidden="true" size={16} /></a>
          </li>;
        })}
      </ul>
    </section>

    <section aria-labelledby="mobile-title" className={styles.section} id="mobile">
      <div className={styles.mobile}>
        <div className={styles.mobileCopy}>
          <span className={styles.tag}>{t("Mobile app")}</span>
          <h2 className={styles.sectionTitle} id="mobile-title">{t("The site, in your pocket.")}</h2>
          <p className={styles.lead}>{t("Site teams check in, report the day and answer clients from their phone. Managers approve on the go.")}</p>
          <ul className={styles.bullets}>
            <Bullet icon={<MapPin size={18} />}>{t("Check in and out with a photo and location")}</Bullet>
            <Bullet icon={<Camera size={18} />}>{t("Daily reports, snags and deliveries with photos")}</Bullet>
            <Bullet icon={<ClipboardCheck size={18} />}>{t("Leave, check-ins and crew days to approve")}</Bullet>
            <Bullet icon={<WifiOff size={18} />}>{t("Keeps working offline and sends when you are back online")}</Bullet>
          </ul>
          <ul aria-label={t("App stores")} className={styles.stores}>
            <li><Smartphone aria-hidden="true" size={18} /><span>{t("App Store")}</span><span className={styles.soon}>{t("Coming soon")}</span></li>
            <li><Smartphone aria-hidden="true" size={18} /><span>{t("Google Play")}</span><span className={styles.soon}>{t("Coming soon")}</span></li>
          </ul>
        </div>
        {phones.length ? <div className={styles.devices} data-count={phones.length}>
          {phones.map(({ shot, kind }) => <Phone key={shot.src} kind={kind} shot={shot} sizes="(max-width: 720px) 60vw, 300px" t={t} />)}
        </div> : null}
      </div>
    </section>

    <section aria-labelledby="cta-title" className={styles.ctaBand}>
      <div className={styles.ctaInner}>
        <h2 className={styles.ctaTitle} id="cta-title">{t("Bring your next project into Wodana.")}</h2>
        <p className={styles.ctaLead}>{t("Sales, site and clients on the same page from the first day.")}</p>
        <div className={styles.heroActions}>
          <a className={styles.pillInverse} href="#contact">{t("Contact sales")}</a>
          <Link className={styles.pillGhost} href="/login">{t("Sign in")}</Link>
        </div>
      </div>
    </section>

    <ContactSection form={form} source="landing" />
  </MarketingFrame>;
}
