import type { ReactNode } from "react";
import Link from "next/link";
import { formatDate } from "@/design-system";
import type { AppLanguage } from "@/lib/i18n/languages";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";
import styles from "./marketing.module.css";

/** The legal entity behind Wodana, as the privacy policy, the terms and the contact page name it. */
export const COMPANY = {
  name: "Antro-Pai Technologies Private Limited",
  addressLines: ["201, Ram Krishna Nivas Towers", "Sanjeeva Reddy Nagar", "Hyderabad, Telangana 500038", "India"],
  supportEmail: "support@wodana.ai",
} as const;

/** When the privacy policy and the terms last changed. */
export const LEGAL_UPDATED = new Date(Date.UTC(2026, 9, 1));

/** The "Last updated" date in the visitor's language, day first as most of the regions Wodana serves write it. */
export function legalUpdatedLabel(language: AppLanguage) {
  return formatDate(LEGAL_UPDATED, { locale: language === "en" ? "en-GB" : language }, { day: "numeric", month: "long", year: "numeric" });
}

const VALUES = { company: COMPANY.name, email: COMPANY.supportEmail };

/**
 * One section of a legal page: a title, its paragraphs, an optional list, the company address when the section
 * names us, and any closing paragraphs. The company name and support address are placeholders, so translations
 * keep them as they are.
 */
export type LegalSection = {
  id: string;
  title: MessageKey;
  paragraphs: MessageKey[];
  bullets?: MessageKey[];
  address?: boolean;
  closing?: MessageKey[];
};

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    title: tKey("Who we are"),
    paragraphs: [tKey("Wodana is made by {company}, a company registered in India. Wodana is the web app, client portal and mobile app that interior design and fit-out firms use to run their work.")],
    address: true,
    closing: [tKey("For anything about this policy, write to {email}.")],
  },
  {
    id: "information-we-collect",
    title: tKey("Information we collect"),
    paragraphs: [tKey("We collect only what the service needs to work:")],
    bullets: [
      tKey("Account details: your name, email address, phone number and role in the firm."),
      tKey("Business data a firm enters: enquiries, clients, quotes, projects and the files attached to them."),
      tKey("Photos a user chooses to attach, such as site progress and delivery photos."),
      tKey("Precise location, only at the moment a user checks in or out or logs a site visit in the mobile app."),
      tKey("The device token that lets us deliver push notifications to a phone."),
      tKey("Basic usage and diagnostic data that keeps the service working, such as error reports and performance measurements."),
    ],
  },
  {
    id: "how-we-use-it",
    title: tKey("How we use it"),
    paragraphs: [
      tKey("We use this information to provide and support the service, to send the notifications a firm sets up, to keep accounts secure and to improve reliability."),
      tKey("We do not sell personal data and we do not use it for advertising."),
    ],
  },
  {
    id: "ai-features",
    title: tKey("AI features"),
    paragraphs: [
      tKey("When a firm turns on the AI assistant, the relevant text is processed by Amazon Bedrock on Amazon Web Services to produce suggestions, such as a drafted reply or a summary. It is not used to train AI models."),
      tKey("An administrator can switch the AI assistant off for the firm at any time."),
    ],
  },
  {
    id: "where-data-is-stored",
    title: tKey("Where data is stored"),
    paragraphs: [tKey("Data is stored on Amazon Web Services. It is encrypted in transit, access is limited to authorised staff, and backups are taken daily.")],
  },
  {
    id: "sharing",
    title: tKey("Sharing"),
    paragraphs: [tKey("We share personal data only with the service providers needed to run Wodana: cloud hosting, email delivery, and messaging services such as WhatsApp when a firm connects them. We also share it when the law requires us to.")],
  },
  {
    id: "retention-and-deletion",
    title: tKey("Retention and deletion"),
    paragraphs: [tKey("We keep data while the account is active. A firm can ask us to export or delete its data, and any user can ask us to delete their account by writing to {email}.")],
  },
  {
    id: "your-rights",
    title: tKey("Your rights"),
    paragraphs: [tKey("You can ask to access, correct or delete your personal data, or object to how it is used. Write to {email} and we will respond.")],
  },
  {
    id: "children",
    title: tKey("Children"),
    paragraphs: [tKey("Wodana is a tool for businesses and is not intended for children under 16. We do not knowingly collect personal data from them.")],
  },
  {
    id: "changes",
    title: tKey("Changes to this policy"),
    paragraphs: [tKey("When this policy changes, we update this page and the date at the top.")],
  },
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "using-wodana",
    title: tKey("Using Wodana"),
    paragraphs: [tKey("Wodana is provided by {company} to interior design and fit-out firms as a web app, client portal and mobile app. By using Wodana, a firm and its users agree to these terms.")],
  },
  {
    id: "accounts-and-users",
    title: tKey("Accounts and users"),
    paragraphs: [tKey("A firm's administrators decide who has access to its workspace. Each user is responsible for keeping their sign-in details private and for what happens under their account. Tell us at {email} if you believe an account has been misused.")],
  },
  {
    id: "fees-and-payment",
    title: tKey("Fees and payment"),
    paragraphs: [tKey("Fees are as set out in the quotation or invoice the firm agreed to. Fees are non-refundable once the subscription starts, except where the law requires a refund.")],
  },
  {
    id: "ai-assistant",
    title: tKey("AI assistant"),
    paragraphs: [tKey("The AI assistant produces suggestions, not decisions. Suggestions must be reviewed before they are used, and the firm is responsible for what it approves and sends.")],
  },
  {
    id: "customer-data",
    title: tKey("Customer data"),
    paragraphs: [tKey("The firm owns the data it enters into Wodana. We process it only to provide the service, as described in our privacy policy.")],
  },
  {
    id: "acceptable-use",
    title: tKey("Acceptable use"),
    paragraphs: [tKey("Wodana may not be used to break the law, to send unsolicited messages, to upload harmful or infringing content, or to interfere with the service or with other firms' workspaces.")],
  },
  {
    id: "third-party-services",
    title: tKey("Third-party services"),
    paragraphs: [tKey("A firm may connect services such as WhatsApp, email or payment providers. Those services have their own terms, and we are not responsible for them.")],
  },
  {
    id: "intellectual-property",
    title: tKey("Intellectual property"),
    paragraphs: [tKey("The Wodana platform, including its software, design and brand, belongs to {company}. These terms do not transfer any of it to the firm.")],
  },
  {
    id: "availability",
    title: tKey("Availability"),
    paragraphs: [tKey("We make commercially reasonable efforts to keep Wodana available and to tell firms about planned maintenance. We do not guarantee uninterrupted service.")],
  },
  {
    id: "limitation-of-liability",
    title: tKey("Limitation of liability"),
    paragraphs: [tKey("To the extent the law allows, we are not liable for indirect losses such as lost profits or lost data. Our total liability for any claim is limited to the fees the firm paid for Wodana in the twelve months before the claim.")],
  },
  {
    id: "termination",
    title: tKey("Termination"),
    paragraphs: [tKey("A firm may stop using Wodana at the end of its subscription period. We may suspend or end access if these terms are broken or fees remain unpaid after notice. After termination, the firm can ask us to export or delete its data, as described in our privacy policy.")],
  },
  {
    id: "governing-law",
    title: tKey("Governing law"),
    paragraphs: [tKey("These terms are governed by the laws of India. Disputes are subject to the courts of Hyderabad, Telangana.")],
  },
  {
    id: "contact",
    title: tKey("Contact"),
    paragraphs: [tKey("Questions about these terms go to {email}.")],
    address: true,
  },
];

/** The support address in a sentence becomes a mail link, whatever the language. */
function withEmailLink(text: string): ReactNode {
  const parts = text.split(COMPANY.supportEmail);
  if (parts.length === 1) return text;
  return parts.flatMap((part, index) => index === 0 ? [part]
    : [<a href={`mailto:${COMPANY.supportEmail}`} key={index}>{COMPANY.supportEmail}</a>, part]);
}

export function CompanyAddress() {
  return <address className={styles.address}>
    <strong>{COMPANY.name}</strong>
    {COMPANY.addressLines.map((line) => <span key={line}>{line}</span>)}
  </address>;
}

/** A legal page's text: when it last changed, then its numbered sections. */
export function LegalDocument({ sections, updated, t }: { sections: LegalSection[]; updated: string; t: Translate }) {
  return <article className={styles.article}>
    <p className={styles.articleMeta}>{t("Last updated {date}", { date: updated })}</p>
    {sections.map((section) => <section aria-labelledby={`${section.id}-title`} className={styles.articleSection} key={section.id}>
      <h2 id={`${section.id}-title`}>{t(section.title)}</h2>
      {section.paragraphs.map((key) => <p key={key}>{withEmailLink(t(key, VALUES))}</p>)}
      {section.bullets ? <ul>{section.bullets.map((key) => <li key={key}>{t(key, VALUES)}</li>)}</ul> : null}
      {section.address ? <CompanyAddress /> : null}
      {section.closing?.map((key) => <p key={key}>{withEmailLink(t(key, VALUES))}</p>)}
    </section>)}
  </article>;
}

/** How to reach us: support, sales, the company address and the legal pages. */
export function ContactDetails({ t }: { t: Translate }) {
  return <div className={styles.article}>
    <dl className={styles.contactList}>
      <div>
        <dt>{t("Support")}</dt>
        <dd><a href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a></dd>
      </div>
      <div>
        <dt>{t("Sales")}</dt>
        <dd><Link href="/contact-sales">{t("For sales enquiries")}</Link></dd>
      </div>
      <div>
        <dt>{t("Address")}</dt>
        <dd><CompanyAddress /></dd>
      </div>
      <div>
        <dt>{t("Legal")}</dt>
        <dd>
          <Link href="/privacy">{t("Privacy policy")}</Link>
          <Link href="/terms">{t("Terms")}</Link>
        </dd>
      </div>
    </dl>
  </div>;
}
