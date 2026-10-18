import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EmptyState } from "@/design-system";
import type { MessageKey, Translate } from "@/lib/i18n/keys";
import styles from "./marketing.module.css";

/**
 * The company pages' content. Nothing is invented: until there are open roles or published profiles, the lists are
 * empty and the pages show their "coming soon" state. Adding an entry here is all it takes to list it.
 */
export type OpenRole = { id: string; title: MessageKey; team: MessageKey; location: MessageKey; href: string };
export type TeamMember = { id: string; name: string; role: MessageKey; photo: string };

export const OPEN_ROLES: OpenRole[] = [];
export const TEAM: TeamMember[] = [];

/** The next step under an empty state: a quiet pill link. */
export function NextStep({ href, label }: { href: string; label: string }) {
  return <Link className={styles.nextStep} href={href}>{label}<ArrowRight aria-hidden="true" size={16} /></Link>;
}

export function OpenRoles({ roles, t }: { roles: OpenRole[]; t: Translate }) {
  if (!roles.length) {
    return <EmptyState action={<NextStep href="/contact-sales" label={t("Get in touch")} />} description={t("We're always glad to hear from good people.")}
      illustration="empty" title={t("No open roles right now")} />;
  }
  return <ul className={styles.roleList}>
    {roles.map((role) => <li key={role.id}>
      <a href={role.href}>
        <strong>{t(role.title)}</strong>
        <span>{t(role.team)} · {t(role.location)}</span>
        <ArrowRight aria-hidden="true" size={18} />
      </a>
    </li>)}
  </ul>;
}

export function TeamGrid({ members, t }: { members: TeamMember[]; t: Translate }) {
  if (!members.length) {
    return <EmptyState action={<NextStep href="/about" label={t("About Wodana")} />} illustration="empty" title={t("Team profiles coming soon")} />;
  }
  return <ul className={styles.teamGrid}>
    {members.map((member) => <li key={member.id}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static portrait */}
      <img alt="" height={96} loading="lazy" src={member.photo} width={96} />
      <strong>{member.name}</strong>
      <span>{t(member.role)}</span>
    </li>)}
  </ul>;
}
