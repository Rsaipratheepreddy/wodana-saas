"use client";

import { ExternalLink, FileText, Link2, MessageCircle } from "lucide-react";
import { Button, EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalMoodboard } from "@/lib/client-portal/types";
import { Reactions } from "../forms/board-feedback";
import { isolate } from "../portal-format";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

type Pin = PortalMoodboard["pins"][number];

/** A link's site, for a pin that is only a link ("instagram.com"). */
function site(link: string) {
  try { return new URL(link).hostname.replace(/^www\./, ""); } catch { return link; }
}

/**
 * The moodboard: the concept and material boards the design team shared, the ideas they chose to show, and the
 * client's own. The client likes or dislikes each, comments on it, and adds their own photos and links.
 */
export function MoodboardSection({ project, api, open, reload }: SectionProps) {
  const t = useT();
  const board = project.moodboard;
  if (!board) return null;
  const add = board.canAdd ? <Button variant="primary" onPress={() => open({ kind: "idea" })}>{t("Add an idea")}</Button> : undefined;
  if (!board.boards.length && !board.pins.length)
    return <EmptyState illustration="empty" title={t("Your moodboard")} description={t("Share photos and links of what you love. Your design team's boards will appear here too.")} action={add} />;
  const target = (kind: "pin" | "design", id: string) => ({ caseId: project.id, targetKind: kind, targetId: id });
  const talk = (count: number) => (count === 1 ? t("1 comment") : t("{count} comments", { count }));
  return <div className={styles.section}>
    {add ? <div>{add}</div> : null}
    {board.boards.length ? <section className={styles.group} aria-labelledby="portal-boards">
      <h2 className={styles.groupTitle} id="portal-boards">{t("Boards")}</h2>
      <ul className={styles.boards}>{board.boards.map((item) => <li className={styles.card} key={item.id}>
        <button className={styles.cardMedia} type="button" onClick={() => open({ kind: "board", id: item.id })}
          aria-label={t("Open {name}", { name: `${item.title} · V${item.number}` })}>
          {item.hasImage
            // eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the portal's signed-in route
            ? <img alt="" loading="lazy" src={api.file("design", item.id, true)} />
            : <span className={styles.cardPlaceholder}><FileText aria-hidden="true" size={24} /></span>}
        </button>
        <div className={styles.cardBody}>
          <span className={styles.itemTitle} dir="auto">{item.title} · V{item.number}</span>
          {item.room ? <span className={styles.itemMeta} dir="auto">{item.room}</span> : null}
          <div className={styles.cardActions}>
            <Reactions target={target("design", item.id)} reaction={item.reaction} api={api} onChanged={() => void reload()} name={item.title} />
            <Button size="compact" variant="quiet" onPress={() => open({ kind: "board", id: item.id })}>
              <MessageCircle aria-hidden="true" size={16} />{item.comments.length ? talk(item.comments.length) : t("Comment")}</Button>
          </div>
        </div>
      </li>)}</ul>
    </section> : null}

    {board.pins.length ? <section className={styles.group} aria-labelledby="portal-ideas">
      <h2 className={styles.groupTitle} id="portal-ideas">{t("Ideas")}</h2>
      <ul className={styles.pins}>{board.pins.map((pin) => <PinCard key={pin.id} pin={pin} api={api} open={open} talk={talk}
        reactions={<Reactions target={target("pin", pin.id)} reaction={pin.reaction} api={api} onChanged={() => void reload()} name={pin.title} />} />)}</ul>
    </section> : null}
  </div>;
}

function PinCard({ pin, api, open, talk, reactions }: { pin: Pin; api: SectionProps["api"]; open: SectionProps["open"]; talk: (count: number) => string;
  reactions: React.ReactNode }) {
  const t = useT();
  const photo = pin.photos[0];
  const by = pin.mine ? t("You added this") : pin.fromClient ? t("{name} added this", { name: isolate(pin.author) }) : pin.feeling === "avoid" ? t("To avoid") : "";
  return <li className={styles.card}>
    <button className={styles.cardMedia} data-kind={photo ? "photo" : "link"} type="button" onClick={() => open({ kind: "pin", id: pin.id })}
      aria-label={t("Open {name}", { name: pin.title })}>
      {photo
        // eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the portal's signed-in route
        ? <img alt="" loading="lazy" src={api.file("asset", photo.id, true)} />
        : <span className={styles.cardPlaceholder}>{pin.link ? <><Link2 aria-hidden="true" size={20} /><span dir="ltr">{site(pin.link)}</span></> : <span className={styles.body} dir="auto">{pin.note}</span>}</span>}
    </button>
    <div className={styles.cardBody}>
      <span className={styles.itemTitle} dir="auto">{pin.title}</span>
      {[by, pin.room].filter(Boolean).length ? <span className={styles.itemMeta}>{[by, pin.room ? isolate(pin.room) : ""].filter(Boolean).join(" · ")}</span> : null}
      {pin.link && photo ? <a className={`${styles.itemMeta} ${styles.inlineIcon}`} href={pin.link} rel="noreferrer noopener" target="_blank" dir="ltr">{site(pin.link)}<ExternalLink aria-hidden="true" size={12} /></a> : null}
      <div className={styles.cardActions}>
        {reactions}
        <Button size="compact" variant="quiet" onPress={() => open({ kind: "pin", id: pin.id })}>
          <MessageCircle aria-hidden="true" size={16} />{pin.comments.length ? talk(pin.comments.length) : t("Comment")}</Button>
      </div>
    </div>
  </li>;
}
