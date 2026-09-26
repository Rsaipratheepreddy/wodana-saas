"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Check, ChevronLeft, ChevronRight, Images, Mail, MapPin, MessageCircle, Phone, Plus, Search, ShoppingBag, Star, X } from "lucide-react";
import { PublicEnquiryFormView } from "@/components/crm/public-enquiry-form";
import { useT } from "@/lib/i18n/i18n-provider";
import type { GalleryContent, GalleryItem, GallerySectionKey } from "@/lib/gallery/types";
import { documentVariables, styleById } from "@/lib/quotation/document-styles";
import styles from "./gallery.module.css";

type ImageUrl = (id: string, preview?: boolean, source?: "gallery" | "catalog") => string;
type Filter = { kind: "all" } | { kind: "type"; value: GalleryItem["kind"] } | { kind: "label"; value: string };
const KIND_OF: Partial<Record<GallerySectionKey, GalleryItem["kind"]>> = { services: "service", products: "product", projects: "project", testimonials: "testimonial" };
const KIND_LABEL: Record<GalleryItem["kind"], string> = { service: "Services", product: "Products", project: "Projects", testimonial: "What clients say" };

/**
 * The company gallery as a visual catalog: search first, filter chips, an even grid of pictures to
 * browse, a detail view with more like it, and "My list" sent through the firm's own enquiry form.
 * The owner's editor shows the same page as a live preview (nothing is sent from the preview).
 */
export function GalleryView({ content, imageUrl, submitTo, preview = false, locale }: { content: GalleryContent; imageUrl: ImageUrl; submitTo?: string; preview?: boolean; locale?: string }) {
  const t = useT();
  const { settings, items, brand, currency } = content;
  const style = styleById(settings.style);
  // A little branding: the firm's colour is the accent unless the owner picked another.
  const vars = documentVariables(style, brand.primaryColor, settings.accent ?? brand.primaryColor) as CSSProperties;
  const storageKey = `wodana.gallery.${settings.slug}`;
  const [list, setList] = useState<string[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [openId, setOpenId] = useState<string | null>(null);

  // "My list" stays on this device so a visitor can come back to it.
  useEffect(() => {
    if (preview) return;
    try { const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]"); if (Array.isArray(saved)) queueMicrotask(() => setList(saved.filter((id) => typeof id === "string"))); } catch { /* storage unavailable */ }
  }, [preview, storageKey]);
  const save = (next: string[]) => { setList(next); if (!preview) try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage unavailable */ } };
  const toggle = (id: string) => save(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

  // What can be browsed: visible items of the sections the firm shows, in the firm's section order.
  const shownKinds = settings.sections.filter((section) => section.visible && KIND_OF[section.key]).map((section) => KIND_OF[section.key]!);
  const browsable = useMemo(() => shownKinds.filter((kind) => kind !== "testimonial").flatMap((kind) => items.filter((item) => item.kind === kind && item.visible).sort((a, b) => a.position - b.position)), [items, shownKinds]);
  const quotes = shownKinds.includes("testimonial") ? items.filter((item) => item.kind === "testimonial" && item.visible) : [];
  const labels = useMemo(() => {
    const count = new Map<string, number>();
    for (const item of browsable) if (item.subtitle && item.kind !== "project") count.set(item.subtitle, (count.get(item.subtitle) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([label]) => label);
  }, [browsable]);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (item: GalleryItem) => words.every((word) => `${item.title} ${item.subtitle} ${item.body}`.toLowerCase().includes(word));
  const shown = browsable.filter((item) => (filter.kind === "all" || (filter.kind === "type" ? item.kind === filter.value : item.subtitle === filter.value)) && matches(item));
  const opened = browsable.find((item) => item.id === openId) ?? null;
  const price = (item: GalleryItem) => {
    if (!settings.showPrices || !item.priceFrom) return null;
    const amount = new Intl.NumberFormat(locale, { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(Number(item.priceFrom));
    return item.priceUnit ? t("From {amount} / {unit}", { amount, unit: item.priceUnit }) : t("From {amount}", { amount });
  };
  const picked = items.filter((item) => list.includes(item.id));
  const whatsapp = settings.contactWhatsapp.replace(/\D/g, "");
  const isChosen = (candidate: Filter) => JSON.stringify(candidate) === JSON.stringify(filter);
  const chip = (candidate: Filter, label: string, count?: number) => <button key={label} type="button" role="radio" aria-checked={isChosen(candidate)} className={styles.chip} onClick={() => setFilter(candidate)}>{label}{count !== undefined ? <small>{count}</small> : null}</button>;

  return <div className={styles.gallery} style={vars} data-preview={preview || undefined}>
    <header className={styles.bar}>
      <a className={styles.brand} href="#top">{brand.logo ? <img src={brand.logo} alt={brand.name} /> : <strong>{brand.name}</strong>}</a>
      <label className={styles.search}>
        <Search aria-hidden="true" size={16} />
        <input type="search" aria-label={t("Search the gallery")} placeholder={t("Search kitchens, wardrobes, finishes…")} value={query} onChange={(event) => setQuery(event.target.value)} />
        {query ? <button type="button" aria-label={t("Clear search")} onClick={() => setQuery("")}><X aria-hidden="true" size={14} /></button> : null}
      </label>
      <button type="button" className={styles.listButton} onClick={() => setListOpen(true)} aria-label={t("My list, {count} items", { count: list.length })}>
        <ShoppingBag aria-hidden="true" size={16} /><span>{t("My list")}</span>{list.length ? <b>{list.length}</b> : null}
      </button>
    </header>

    <section id="top" className={styles.intro}>
      {settings.heroImageId ? <img className={styles.banner} src={imageUrl(settings.heroImageId, false, "gallery")} alt="" /> : null}
      <div>
        <h1>{settings.headline || brand.name}</h1>
        {settings.intro ? <p>{settings.intro}</p> : null}
      </div>
      <div className={styles.quick}>
        {whatsapp ? <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer"><MessageCircle aria-hidden="true" size={15} />{t("WhatsApp")}</a> : null}
        {settings.contactPhone ? <a href={`tel:${settings.contactPhone.replace(/[^\d+]/g, "")}`}><Phone aria-hidden="true" size={15} />{t("Call")}</a> : null}
      </div>
    </section>

    <nav className={styles.chips} role="radiogroup" aria-label={t("Show")}>
      {chip({ kind: "all" }, t("All"), browsable.length)}
      {shownKinds.filter((kind) => kind !== "testimonial" && browsable.some((item) => item.kind === kind)).map((kind) => chip({ kind: "type", value: kind }, t(KIND_LABEL[kind] as never), browsable.filter((item) => item.kind === kind).length))}
      {labels.map((label) => chip({ kind: "label", value: label }, label))}
    </nav>

    <main className={styles.wall} aria-label={t("Gallery")}>
      {shown.map((item) => <Tile key={item.id} item={item} imageUrl={imageUrl} price={price(item)} inList={list.includes(item.id)} onOpen={() => setOpenId(item.id)} onToggle={() => toggle(item.id)} />)}
      {!shown.length ? <p className={styles.empty}>{query ? t("Nothing matches “{query}”.", { query }) : t("Nothing here yet.")}</p> : null}
    </main>

    {quotes.length && filter.kind === "all" && !query ? <section className={styles.quotes} aria-label={t("What clients say")}>
      <h2>{t("What clients say")}</h2>
      <div>{quotes.map((quote) => <figure key={quote.id}>
        {quote.rating ? <div className={styles.stars} aria-label={t("{rating} out of 5", { rating: quote.rating })}>{Array.from({ length: 5 }, (_, index) => <Star key={index} aria-hidden="true" size={13} data-on={index < quote.rating! || undefined} />)}</div> : null}
        <blockquote>{quote.body}</blockquote>
        <figcaption>{quote.images[0] ? <img src={imageUrl(quote.images[0].id, true, quote.images[0].source)} alt="" /> : null}<span><strong>{quote.title}</strong>{quote.subtitle ? <small>{quote.subtitle}</small> : null}</span></figcaption>
      </figure>)}</div>
    </section> : null}

    <footer className={styles.footer}>
      <div className={styles.about}>
        <strong>{brand.name}</strong>
        {settings.sections.find((section) => section.key === "about")?.visible && settings.about ? <p>{settings.about.split(/\n{2,}/)[0]}</p> : null}
      </div>
      {settings.sections.find((section) => section.key === "contact")?.visible !== false ? <div className={styles.contact}>
        {settings.contactPhone ? <a href={`tel:${settings.contactPhone.replace(/[^\d+]/g, "")}`}><Phone aria-hidden="true" size={14} />{settings.contactPhone}</a> : null}
        {whatsapp ? <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer"><MessageCircle aria-hidden="true" size={14} />{t("WhatsApp")}</a> : null}
        {settings.contactEmail ? <a href={`mailto:${settings.contactEmail}`}><Mail aria-hidden="true" size={14} />{settings.contactEmail}</a> : null}
        {settings.contactAddress ? <span><MapPin aria-hidden="true" size={14} />{settings.contactAddress}</span> : null}
      </div> : null}
      <small>{t("Powered by Wodana")}</small>
    </footer>

    {opened ? <Detail item={opened} all={shown.length ? shown : browsable} imageUrl={imageUrl} price={price} inList={list.includes(opened.id)} listIds={list}
      onToggle={toggle} onOpen={setOpenId} onClose={() => setOpenId(null)} /> : null}

    {listOpen ? <div className={styles.scrim} onClick={() => setListOpen(false)}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={t("My list")} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setListOpen(false); }}>
        <header><h2>{t("My list")}</h2><button type="button" className={styles.close} aria-label={t("Close")} onClick={() => setListOpen(false)}><X aria-hidden="true" size={18} /></button></header>
        {sent ? <div className={styles.thanks}><Check aria-hidden="true" size={28} /><h3>{t("Thank you")}</h3><p>{t("We have your list and will be in touch soon.")}</p></div> : <>
          {picked.length ? <ul className={styles.picked}>{picked.map((item) => <li key={item.id}>
            {item.images[0] ? <img src={imageUrl(item.images[0].id, true, item.images[0].source)} alt="" /> : <span />}
            <span><strong>{item.title}</strong>{price(item) ? <small>{price(item)}</small> : null}</span>
            <button type="button" aria-label={t("Remove {name}", { name: item.title })} onClick={() => toggle(item.id)}><X aria-hidden="true" size={14} /></button>
          </li>)}</ul> : <p className={styles.muted}>{t("Nothing here yet. Add services or products you like, or just tell us what you need.")}</p>}
          {content.form ? preview ? <p className={styles.muted}>{t("Visitors fill in your enquiry form here.")}</p>
            : <PublicEnquiryFormView form={content.form} bare submitTo={submitTo} extra={{ selection: list }} onReceived={() => { setSent(true); save([]); }} />
            : <p className={styles.muted}>{t("Enquiries aren't open right now.")}</p>}
        </>}
      </aside>
    </div> : null}
  </div>;
}

/** One picture tile: tap to open; the round button adds it to the list without opening. */
function Tile({ item, imageUrl, price, inList, onOpen, onToggle }: { item: GalleryItem; imageUrl: ImageUrl; price: string | null; inList: boolean; onOpen: () => void; onToggle: () => void }) {
  const t = useT();
  const cover = item.images[0];
  const project = item.kind === "project";
  return <article className={styles.tile}>
    <button type="button" className={styles.tileOpen} onClick={onOpen} aria-label={t("Open {name}", { name: item.title })}>
      {cover ? <img src={imageUrl(cover.id, true, cover.source)} alt="" loading="lazy" /> : <span className={styles.noImage}>{item.title.slice(0, 1)}</span>}
      <span className={styles.tileText}>
        <strong>{item.title}</strong>
        <small>{project ? item.subtitle : price ?? item.subtitle}</small>
      </span>
      {project && item.images.length > 1 ? <span className={styles.count}><Images aria-hidden="true" size={12} />{item.images.length}</span> : null}
    </button>
    {project ? null : <button type="button" className={styles.quickAdd} aria-pressed={inList} aria-label={inList ? t("Remove {name} from your list", { name: item.title }) : t("Add {name} to your list", { name: item.title })} onClick={onToggle}>
      {inList ? <Check aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />}
    </button>}
  </article>;
}

/** The item up close: its pictures, words and price, and more like it to keep browsing. */
function Detail({ item, all, imageUrl, price, inList, listIds, onToggle, onOpen, onClose }: {
  item: GalleryItem; all: GalleryItem[]; imageUrl: ImageUrl; price: (item: GalleryItem) => string | null; inList: boolean; listIds: string[];
  onToggle: (id: string) => void; onOpen: (id: string) => void; onClose: () => void;
}) {
  const t = useT();
  const [picture, setPicture] = useState(0);
  const index = all.findIndex((entry) => entry.id === item.id);
  const step = (by: number) => { if (all.length > 1) { onOpen(all[(index + by + all.length) % all.length].id); setPicture(0); } };
  const more = all.filter((entry) => entry.id !== item.id && (entry.subtitle === item.subtitle || entry.kind === item.kind)).slice(0, 6);
  const image = item.images[picture] ?? item.images[0];
  return <div className={styles.scrim} onClick={onClose}>
    <div className={styles.detail} role="dialog" aria-modal="true" aria-label={item.title} tabIndex={-1} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); if (event.key === "ArrowRight") step(1); if (event.key === "ArrowLeft") step(-1); }}>
      <button type="button" className={styles.detailClose} aria-label={t("Close")} onClick={onClose}><X aria-hidden="true" size={18} /></button>
      <div className={styles.stage}>
        {image ? <img src={imageUrl(image.id, false, image.source)} alt={item.title} /> : <span className={styles.noImage}>{item.title.slice(0, 1)}</span>}
        {all.length > 1 ? <>
          <button type="button" className={styles.prev} aria-label={t("Previous")} onClick={() => step(-1)}><ChevronLeft aria-hidden="true" data-directional="true" size={20} /></button>
          <button type="button" className={styles.next} aria-label={t("Next")} onClick={() => step(1)}><ChevronRight aria-hidden="true" data-directional="true" size={20} /></button>
        </> : null}
      </div>
      {item.images.length > 1 ? <div className={styles.thumbs}>{item.images.map((entry, position) => <button key={entry.id} type="button" aria-label={t("Picture {number}", { number: position + 1 })} aria-pressed={position === picture} onClick={() => setPicture(position)}>
        <img src={imageUrl(entry.id, true, entry.source)} alt="" /></button>)}</div> : null}
      <div className={styles.detailText}>
        {item.subtitle ? <small className={styles.eyebrow}>{item.kind === "project" ? <MapPin aria-hidden="true" size={13} /> : null}{item.subtitle}</small> : null}
        <h2>{item.title}</h2>
        {price(item) ? <p className={styles.detailPrice}>{price(item)}</p> : null}
        {item.body ? <p>{item.body}</p> : null}
        {item.kind === "project" ? null : <button type="button" className={styles.addLarge} aria-pressed={inList} onClick={() => onToggle(item.id)}>
          {inList ? <><Check aria-hidden="true" size={16} />{t("In your list")}</> : <><Plus aria-hidden="true" size={16} />{t("Add to list")}</>}
        </button>}
      </div>
      {more.length ? <section className={styles.more} aria-label={t("More like this")}>
        <h3>{t("More like this")}</h3>
        <div>{more.map((entry) => <button key={entry.id} type="button" onClick={() => { onOpen(entry.id); setPicture(0); }} aria-label={entry.title}>
          {entry.images[0] ? <img src={imageUrl(entry.images[0].id, true, entry.images[0].source)} alt="" /> : <span className={styles.noImage}>{entry.title.slice(0, 1)}</span>}
          <span>{entry.title}</span>{listIds.includes(entry.id) ? <Check aria-hidden="true" size={12} /> : null}
        </button>)}</div>
      </section> : null}
    </div>
  </div>;
}
