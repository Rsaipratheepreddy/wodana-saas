"use client";

import { useMemo } from "react";
import { FileText, MessageCircle } from "lucide-react";
import { Badge, Button, EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalDesignFileStatus, PortalDesignGroup } from "@/lib/client-portal/types";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

type Tone = "success" | "warning" | "info" | "neutral";

/** A shared design file's state in the client's words, and its colour (the words carry it; the colour only helps). */
export function useDesignStatus() {
  const t = useT();
  return useMemo<Record<PortalDesignFileStatus, [string, Tone]>>(() => ({
    client_review: [t("For your review"), "warning"], expired: [t("Review time passed"), "neutral"], approved: [t("Approved"), "success"],
    changes_requested: [t("Changes asked"), "info"], rejected: [t("Declined"), "neutral"], presented: [t("Choose an option"), "warning"], chosen: [t("Chosen"), "success"],
    shown: [t("Shared"), "neutral"],
  }), [t]);
}

/**
 * PLM-153: the client's Designs: every design file the team shared, in folders by stage (concepts and mood boards,
 * layouts, materials, renders, drawings), newest first. Each opens at its latest file, with the earlier rounds, to
 * view and comment on.
 */
export function DesignsSection({ project, api, format, open }: SectionProps) {
  const t = useT();
  const status = useDesignStatus();
  const folders = project.designs;
  const titles = useMemo<Record<PortalDesignGroup, string>>(() => ({
    concepts: t("Concepts and mood boards"), layouts: t("Layouts"), materials: t("Materials"), renders: t("Renders"), drawings: t("Drawings"),
  }), [t]);
  if (!folders) return null;
  if (!folders.groups.length) return <EmptyState illustration="empty" title={t("No designs yet")} description={t("The designs your team shares with you appear here.")} />;
  const talk = (count: number) => (count === 1 ? t("1 comment") : t("{count} comments", { count }));
  return <div className={styles.section}>
    {folders.groups.map((group) => <section className={styles.group} aria-labelledby={`portal-designs-${group.key}`} key={group.key}>
      <h2 className={styles.groupTitle} id={`portal-designs-${group.key}`}>{titles[group.key]}</h2>
      <ul className={styles.boards}>{group.designs.map((design) => {
        const latest = design.files[0];
        const [label, tone] = status[latest.status];
        const comments = design.files.reduce((sum, file) => sum + file.comments.length, 0);
        return <li className={styles.card} key={design.id}>
          <button className={styles.cardMedia} type="button" onClick={() => open({ kind: "design-file", id: design.id })}
            aria-label={t("Open {name}", { name: `${design.title} · V${latest.number}` })}>
            {latest.hasPreview
              // eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the portal's signed-in route
              ? <img alt="" loading="lazy" src={api.file("design", latest.id, true)} />
              : <span className={styles.cardPlaceholder}><FileText aria-hidden="true" size={24} /></span>}
          </button>
          <div className={styles.cardBody}>
            <span className={styles.itemTitle} dir="auto">{design.title} · V{latest.number}</span>
            <span className={styles.itemMeta}>{[design.room, format.date(latest.sharedAt), design.files.length > 1 ? t("{count} rounds", { count: design.files.length }) : ""]
              .filter(Boolean).join(" · ")}</span>
            <div className={styles.cardActions}>
              <Badge tone={tone}>{label}</Badge>
              <Button size="compact" variant="quiet" onPress={() => open({ kind: "design-file", id: design.id })}>
                <MessageCircle aria-hidden="true" size={16} />{comments ? talk(comments) : t("Comment")}</Button>
            </div>
          </div>
        </li>;
      })}</ul>
    </section>)}
  </div>;
}
