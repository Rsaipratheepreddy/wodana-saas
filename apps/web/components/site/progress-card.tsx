"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, CircleDot, Info, Maximize2 } from "lucide-react";
import { ControlledModalDialog, IconButton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { isTypingTarget } from "@/lib/keyboard/typing-target";
import type { CardPhoto } from "@/lib/site/types";
import styles from "./progress-card.module.css";

/** What a day's card shows: the same for the client's portal and for the manager's preview before it goes. */
export type ProgressCardData = {
  date: string; summary: string; noWork?: boolean; hero: CardPhoto | null; photos: CardPhoto[];
  completed: string[]; advanced: Array<{ title: string; progress: number }>; next: string[]; notes?: string[];
};

type PhotoUrl = (id: string, preview: boolean) => string;

/**
 * A day on site, for the client: the lead photo, the team's words, the day's other photos (a before and after side by
 * side), what was finished, what moved forward and what's next. Photos open full size, one after another.
 */
export function ProgressCard({ card, photoUrl, formatDay, heading, footer, highlighted = false, brand }: {
  card: ProgressCardData; photoUrl: PhotoUrl; formatDay: (day: string) => string; heading?: ReactNode; footer?: ReactNode; highlighted?: boolean;
  /** The firm's name and logo, as the client's messages carry them (the portal shows its own). */
  brand?: { name: string; logoUrl: string | null } | null;
}) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  const all = [card.hero, ...card.photos].filter((photo): photo is CardPhoto => Boolean(photo));
  const index = (id: string) => all.findIndex((photo) => photo.id === id);
  // A pair shows once, before then after.
  const shown = new Set<string>();
  const tiles: Array<{ photos: CardPhoto[] }> = [];
  for (const photo of card.photos) {
    if (shown.has(photo.id)) continue;
    const pair = photo.pairId ? card.photos.find((item) => item.id === photo.pairId) : null;
    const group = pair ? [photo, pair].sort((a, b) => (a.phase === "before" ? -1 : b.phase === "before" ? 1 : 0)) : [photo];
    group.forEach((item) => shown.add(item.id));
    tiles.push({ photos: group });
  }
  const phase = (item: CardPhoto) => (item.phase === "before" ? t("Before") : item.phase === "after" ? t("After") : null);
  const caption = (item: CardPhoto) => [item.area, phase(item)].filter(Boolean).join(" · ");
  return <article className={styles.card} data-highlighted={highlighted || undefined} aria-label={t("Progress on {date}", { date: formatDay(card.date) })}>
    {brand ? <div className={styles.brand}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the tenant's own logo */}
      {brand.logoUrl ? <img src={brand.logoUrl} alt={brand.name} /> : <span>{brand.name}</span>}
    </div> : null}
    <header className={styles.head}>
      <time dateTime={card.date} className={styles.date}>{formatDay(card.date)}</time>
      {heading}
    </header>
    {card.hero ? <button type="button" className={styles.hero} onClick={() => setOpen(0)} aria-label={t("Open photo {number}", { number: 1 })}>
      {/* eslint-disable-next-line @next/next/no-img-element -- private photos streamed through an authenticated route */}
      <img src={photoUrl(card.hero.id, false)} alt={caption(card.hero) || t("Site photo {number}, {date}", { number: 1, date: formatDay(card.date) })} loading="lazy"
        onError={(event) => { event.currentTarget.closest("button")?.setAttribute("hidden", ""); }} />
      {caption(card.hero) ? <span className={styles.caption}>{caption(card.hero)}</span> : null}
      <Maximize2 aria-hidden="true" size={16} className={styles.expand} />
    </button> : null}
    {card.summary ? <p className={styles.summary} dir="auto">{card.summary}</p> : null}
    {tiles.length ? <ul className={styles.strip} aria-label={t("Photos")}>{tiles.map((tile) => <li key={tile.photos[0].id} data-pair={tile.photos.length > 1 || undefined}>
      {tile.photos.map((photo) => <button type="button" key={photo.id} className={styles.thumb} onClick={() => setOpen(index(photo.id))}
        aria-label={t("Open photo {number}", { number: index(photo.id) + 1 })}>
        {/* eslint-disable-next-line @next/next/no-img-element -- private photos streamed through an authenticated route */}
        <img src={photoUrl(photo.id, true)} alt={caption(photo) || t("Site photo {number}, {date}", { number: index(photo.id) + 1, date: formatDay(card.date) })} loading="lazy"
          onError={(event) => { event.currentTarget.closest("button")?.setAttribute("hidden", ""); }} />
        {phase(photo) ? <span className={styles.tag}>{phase(photo)}</span> : null}
      </button>)}
    </li>)}</ul> : null}
    {card.completed.length ? <section className={styles.part} aria-label={t("Completed today")}>
      <h4 className={styles.partTitle}>{t("Completed today")}</h4>
      <ul className={styles.items}>{card.completed.map((item, at) => <li key={at}><Check aria-hidden="true" size={15} className={styles.done} /><span dir="auto">{item}</span></li>)}</ul>
    </section> : null}
    {card.advanced.length ? <section className={styles.part} aria-label={t("Moving forward")}>
      <h4 className={styles.partTitle}>{t("Moving forward")}</h4>
      <ul className={styles.items}>{card.advanced.map((item, at) => <li key={at} className={styles.advanced}>
        <span dir="auto">{item.title}</span>
        <span className={styles.meter} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.progress} aria-label={t("{name}: {percent}%", { name: item.title, percent: item.progress })}>
          <span style={{ inlineSize: `${item.progress}%` }} /></span>
        <span className={styles.percent}>{t("{percent}%", { percent: item.progress })}</span>
      </li>)}</ul>
    </section> : null}
    {card.next.length ? <section className={styles.part} aria-label={t("Next up")}>
      <h4 className={styles.partTitle}>{t("Next up")}</h4>
      <ul className={styles.items}>{card.next.map((item, at) => <li key={at}><CircleDot aria-hidden="true" size={14} className={styles.next} /><span dir="auto">{item}</span></li>)}</ul>
    </section> : null}
    {card.notes?.length ? <section className={styles.part} aria-label={t("Good to know")}>
      <h4 className={styles.partTitle}>{t("Good to know")}</h4>
      <ul className={styles.items}>{card.notes.map((item, at) => <li key={at}><Info aria-hidden="true" size={14} className={styles.note} /><span dir="auto">{item}</span></li>)}</ul>
    </section> : null}
    {footer ? <footer className={styles.foot}>{footer}</footer> : null}
    {open !== null && all.length ? <PhotoLightbox photos={all.map((photo) => ({ id: photo.id, caption: caption(photo) }))} start={open} photoUrl={photoUrl}
      title={formatDay(card.date)} onClose={() => setOpen(null)} /> : null}
  </article>;
}

/** Photos full size, one at a time: previous and next with the buttons or the arrow keys. */
export function PhotoLightbox({ photos, start, photoUrl, title, onClose }: {
  photos: Array<{ id: string; caption: string }>; start: number; photoUrl: PhotoUrl; title: string; onClose: () => void;
}) {
  const t = useT();
  const [at, setAt] = useState(Math.min(Math.max(start, 0), photos.length - 1));
  const count = photos.length;
  const step = (by: number) => setAt((current) => (current + by + count) % count);
  useEffect(() => {
    // Arrow keys follow reading order: in right-to-left pages, left is next.
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || isTypingTarget(event.target)) return;
      const rtl = document.documentElement.dir === "rtl";
      const by = (event.key === "ArrowRight") !== rtl ? 1 : -1;
      setAt((current) => (current + by + count) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);
  const photo = photos[at];
  return <ControlledModalDialog isOpen size="xl" title={title} onOpenChange={(value) => { if (!value) onClose(); }}>
    <figure className={styles.lightbox}>
      {/* eslint-disable-next-line @next/next/no-img-element -- private photos streamed through an authenticated route */}
      <img src={photoUrl(photo.id, false)} alt={photo.caption || t("Photo {number} of {count}", { number: at + 1, count: photos.length })} />
      <figcaption className={styles.lightboxBar}>
        {photos.length > 1 ? <IconButton aria-label={t("Previous photo")} variant="quiet" onPress={() => step(-1)}><ChevronLeft aria-hidden="true" size={18} /></IconButton> : null}
        <span>{[photo.caption, t("{number} of {count}", { number: at + 1, count: photos.length })].filter(Boolean).join(" · ")}</span>
        {photos.length > 1 ? <IconButton aria-label={t("Next photo")} variant="quiet" onPress={() => step(1)}><ChevronRight aria-hidden="true" size={18} /></IconButton> : null}
      </figcaption>
    </figure>
  </ControlledModalDialog>;
}
