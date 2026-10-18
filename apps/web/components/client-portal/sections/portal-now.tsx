"use client";

import { Check } from "lucide-react";
import { Avatar } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown, tKey, type MessageKey } from "@/lib/i18n/keys";
import { CHAPTER_HUE } from "@/lib/jobs/journey";
import type { PortalJourney, PortalJourneyChapter, PortalProject, PortalTeamMember } from "@/lib/client-portal/types";
import type { PortalFormat } from "../portal-format";
import styles from "./portal-now.module.css";

/** The chapters of the client's job, in their words. */
export const CLIENT_CHAPTER: Record<PortalJourneyChapter, MessageKey> = {
  win: tKey("Getting started"), design: tKey("Your design"), price: tKey("Your quotation"), make: tKey("Making it"), install: tKey("On site"), care: tKey("Aftercare"),
};
/** The avatar each role wears when the person hasn't chosen one (as in the team list). */
const AVATAR_ROLES: Record<PortalTeamMember["roles"][number], string> = { manager: "project_manager", designer: "designer", sales: "sales" };
const ORDER: PortalJourneyChapter[] = ["win", "design", "price", "make", "install", "care"];

/** The step names the server sends, as message keys (the server's words are the English keys). */
export const CLIENT_STEP_LABELS = [
  tKey("Design proposal shared with you"), tKey("You accept the design proposal"), tKey("Design fee paid"), tKey("Inspiration week"), tKey("Kick-off meeting"), tKey("Site measure"),
  tKey("Mood boards to choose from"), tKey("Space planning"), tKey("2D design"), tKey("3D renders"), tKey("Material selection"), tKey("Samples"), tKey("Final render"),
  tKey("You approve the design"), tKey("Your quotation"), tKey("You sign the quotation"), tKey("Payment agreement"), tKey("First payment"), tKey("Your project starts"),
  tKey("Material list to confirm"), tKey("Drawings to sign"), tKey("Made for you"), tKey("Delivery and installation"), tKey("Daily updates from site"), tKey("Final touches"),
  tKey("You accept the handover"), tKey("Warranty"),
] as const;

/**
 * §0.3 P5, the top of the client's home: where their job is (the chapter, in their words), what is happening now (theirs
 * to do, or what the team is on), who is looking after them, and what happens next with the expected dates.
 */
export function PortalNow({ journey, project, format }: { journey: PortalJourney; project: PortalProject; format: PortalFormat }) {
  const t = useT();
  const chapters = ORDER.filter((chapter) => journey.steps.some((step) => step.chapter === chapter));
  const at = journey.chapter ? chapters.indexOf(journey.chapter) : -1;
  const team = project.team ?? [];
  const lead = team.find((member) => member.roles.includes("designer")) ?? team.find((member) => member.roles.includes("manager")) ?? team[0] ?? null;
  const role = (roles: PortalTeamMember["roles"]) => roles.includes("designer") ? t("Your designer") : roles.includes("manager") ? t("Your project manager") : t("Your account manager");
  const now = journey.now;
  return <section className={styles.now} aria-labelledby="portal-now">
    <ol className={styles.chapters} aria-label={t("Your journey")}>{chapters.map((chapter, index) => <li key={chapter} data-state={index < at ? "done" : index === at ? "now" : "upcoming"} data-hue={CHAPTER_HUE[chapter]}>
      <span className={styles.chapterMark} aria-hidden="true">{index < at ? <Check size={11} strokeWidth={3} /> : index + 1}</span>
      <span>{translateKnown(t, CLIENT_CHAPTER[chapter])}</span>
    </li>)}</ol>
    <div className={styles.head}>
      <div className={styles.copy}>
        <span className={styles.kicker} data-yours={now?.yours || undefined}>{now?.yours ? t("Waiting for you") : journey.chapter ? translateKnown(t, CLIENT_CHAPTER[journey.chapter]) : t("All done")}</span>
        <h2 className={styles.title} id="portal-now">{now ? (now.yours ? translateKnown(t, now.label) : t("Next: {step}", { step: translateKnown(t, now.label) })) : t("Your project is complete")}</h2>
        {now?.dueAt ? <span className={styles.due}>{now.yours ? t("Please by {date}", { date: format.date(now.dueAt) }) : t("Expected {date}", { date: format.date(now.dueAt) })}</span>
          : now && !now.yours ? <span className={styles.due}>{t("Your team is working on it")}</span> : null}
      </div>
      {lead ? <div className={styles.person}>
        <Avatar name={lead.name} preset={lead.avatar ?? "auto"} roles={lead.roles.map((item) => AVATAR_ROLES[item])} seed={lead.name} />
        <span className={styles.personText}><strong>{lead.name}</strong><span>{role(lead.roles)}</span></span>
      </div> : null}
    </div>
    {journey.next.length ? <div className={styles.next}>
      <h3 className={styles.nextTitle}>{t("What happens next")}</h3>
      <ol>{journey.next.map((step) => <li key={step.key} data-yours={step.yours || undefined}>
        <span className={styles.nextLabel}>{translateKnown(t, step.label)}</span>
        <span className={styles.nextMeta}>{[step.yours ? t("You") : t("Your team"), step.dueAt ? format.date(step.dueAt) : null].filter(Boolean).join(" · ")}</span>
      </li>)}</ol>
    </div> : null}
  </section>;
}
