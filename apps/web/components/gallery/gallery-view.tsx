"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Check, Mail, MapPin, MessageCircle, Phone, Plus, ShoppingBag, Star, X } from "lucide-react";
import { PublicEnquiryFormView } from "@/components/crm/public-enquiry-form";
import { useT } from "@/lib/i18n/i18n-provider";
import type { GalleryContent, GalleryItem, GallerySectionKey } from "@/lib/gallery/types";
import { documentVariables, styleById } from "@/lib/quotation/document-styles";
import styles from "./gallery.module.css";

const SECTION_TITLE: Record<GallerySectionKey, string> = { services: "Services", products: "Products", projects: "Recent projects", testimonials: "What clients say", about: "About us", contact: "Contact" };
const KIND_OF: Partial<Record<GallerySectionKey, GalleryItem["kind"]>> = { services: "service", products: "product", projects: "project", testimonials: "testimonial" };

/**
 * The company gallery as a visitor sees it: a clean, branded brochure. Services and products can be
 * added to "My list"; the list is sent through the firm's own enquiry form. The owner's editor shows
 * the same page as a live preview (nothing is sent from the preview).
 */
export function GalleryView({ content, imageUrl, submitTo, preview = false, locale }: {
  content: GalleryContent; imageUrl: (id: string, preview?: boolean, source?: "gallery" | "catalog") => string; submitTo?: string; preview?: boolean; locale?: string;
}) {
  const t = useT();
  const { settings, items, brand, currency } = content;
  const style = styleById(settings.style);
  const vars = documentVariables(style, brand.primaryColor, settings.accent ?? null) as CSSProperties;
  const storageKey = `wodana.gallery.${settings.slug}`;
  const [list, setList] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  // "My list" is kept on this device so a visitor can come back to it.
  useEffect(() => {
    if (preview) return;
    try { const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]"); if (Array.isArray(saved)) queueMicrotask(() => setList(saved.filter((id) => typeof id === "string"))); } catch { /* storage unavailable */ }
  }, [preview, storageKey]);
  const save = (next: string[]) => { setList(next); if (!preview) try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage unavailable */ } };
  const toggle = (id: string) => save(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  const byKind = useMemo(() => (kind: GalleryItem["kind"]) => items.filter((item) => item.kind === kind && item.visible), [items]);
  const picked = items.filter((item) => list.includes(item.id));
  const price = (item: GalleryItem) => {
    if (!settings.showPrices || !item.priceFrom) return null;
    const amount = new Intl.NumberFormat(locale, { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(Number(item.priceFrom));
    return item.priceUnit ? t("From {amount} / {unit}", { amount, unit: item.priceUnit }) : t("From {amount}", { amount });
  };
  const sections = settings.sections.filter((section) => section.visible && (KIND_OF[section.key] ? byKind(KIND_OF[section.key]!).length : section.key === "about" ? settings.about : settings.contactPhone || settings.contactEmail || settings.contactWhatsapp || settings.contactAddress));
  const whatsapp = settings.contactWhatsapp.replace(/\D/g, "");

  const card = (item: GalleryItem) => {
    const inList = list.includes(item.id);
    const cover = item.images[0];
    return <article key={item.id} className={styles.card}>
      <div className={styles.cardImage}>{cover ? <img src={imageUrl(cover.id, true, cover.source)} alt={item.title} loading="lazy" /> : <span aria-hidden="true" />}</div>
      <div className={styles.cardBody}>
        {item.subtitle ? <small className={styles.eyebrow}>{item.subtitle}</small> : null}
        <h3>{item.title}</h3>
        {item.body ? <p>{item.body}</p> : null}
        <div className={styles.cardFoot}>
          {price(item) ? <span className={styles.price}>{price(item)}</span> : <span />}
          <button type="button" className={styles.add} aria-pressed={inList} onClick={() => toggle(item.id)}>
            {inList ? <><Check aria-hidden="true" size={15} />{t("In your list")}</> : <><Plus aria-hidden="true" size={15} />{t("Add to list")}</>}
          </button>
        </div>
      </div>
    </article>;
  };

  return <div className={styles.gallery} style={vars} data-preview={preview || undefined}>
    <header className={styles.bar}>
      <a className={styles.brand} href="#top">{brand.logo ? <img src={brand.logo} alt={brand.name} /> : <strong>{brand.name}</strong>}</a>
      <nav aria-label={t("Sections")}>{sections.map((section) => <a key={section.key} href={`#${section.key}`}>{t(SECTION_TITLE[section.key] as never)}</a>)}</nav>
      <button type="button" className={styles.listButton} onClick={() => setOpen(true)} aria-label={t("My list, {count} items", { count: list.length })}>
        <ShoppingBag aria-hidden="true" size={16} /><span>{t("My list")}</span>{list.length ? <b>{list.length}</b> : null}
      </button>
    </header>

    <section id="top" className={styles.hero} data-image={settings.heroImageId ? true : undefined}>
      {settings.heroImageId ? <img src={imageUrl(settings.heroImageId)} alt="" /> : null}
      <div className={styles.heroText}>
        <h1>{settings.headline || brand.name}</h1>
        {settings.intro ? <p>{settings.intro}</p> : null}
        <div className={styles.heroActions}>
          {sections[0] ? <a className={styles.primary} href={`#${sections[0].key}`}>{t("Explore")}</a> : null}
          <button type="button" className={styles.secondary} onClick={() => setOpen(true)}>{t("Send an enquiry")}</button>
        </div>
      </div>
    </section>

    {sections.map((section) => {
      const kind = KIND_OF[section.key];
      return <section key={section.key} id={section.key} className={styles.section} aria-labelledby={`${section.key}-title`}>
        <h2 id={`${section.key}-title`}>{t(SECTION_TITLE[section.key] as never)}</h2>
        {kind === "service" || kind === "product" ? <div className={styles.cards}>{byKind(kind).map(card)}</div>
          : kind === "project" ? <div className={styles.projects}>{byKind("project").map((project) => <article key={project.id} className={styles.project}>
            <div className={styles.projectImages}>{project.images.slice(0, 5).map((image, index) => <img key={image.id} src={imageUrl(image.id, index > 0, image.source)} alt={index === 0 ? project.title : ""} loading="lazy" />)}</div>
            <div className={styles.projectText}>{project.subtitle ? <small className={styles.eyebrow}><MapPin aria-hidden="true" size={13} />{project.subtitle}</small> : null}<h3>{project.title}</h3>{project.body ? <p>{project.body}</p> : null}</div>
          </article>)}</div>
          : kind === "testimonial" ? <div className={styles.quotes}>{byKind("testimonial").map((quote) => <figure key={quote.id} className={styles.quote}>
            {quote.rating ? <div className={styles.stars} aria-label={t("{rating} out of 5", { rating: quote.rating })}>{Array.from({ length: 5 }, (_, index) => <Star key={index} aria-hidden="true" size={14} data-on={index < quote.rating! || undefined} />)}</div> : null}
            <blockquote>{quote.body}</blockquote>
            <figcaption>{quote.images[0] ? <img src={imageUrl(quote.images[0].id, true, quote.images[0].source)} alt="" /> : null}<span><strong>{quote.title}</strong>{quote.subtitle ? <small>{quote.subtitle}</small> : null}</span></figcaption>
          </figure>)}</div>
          : section.key === "about" ? <div className={styles.about}>{settings.about.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
          : <div className={styles.contact}>
            {settings.contactPhone ? <a href={`tel:${settings.contactPhone.replace(/[^\d+]/g, "")}`}><Phone aria-hidden="true" size={16} />{settings.contactPhone}</a> : null}
            {whatsapp ? <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer"><MessageCircle aria-hidden="true" size={16} />{t("WhatsApp")}</a> : null}
            {settings.contactEmail ? <a href={`mailto:${settings.contactEmail}`}><Mail aria-hidden="true" size={16} />{settings.contactEmail}</a> : null}
            {settings.contactAddress ? <span><MapPin aria-hidden="true" size={16} />{settings.contactAddress}</span> : null}
          </div>}
      </section>;
    })}

    <footer className={styles.footer}><span>{brand.name}</span><small>{t("Powered by Wodana")}</small></footer>

    {open ? <div className={styles.drawerScrim} onClick={() => setOpen(false)}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={t("My list")} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
        <header><h2>{t("My list")}</h2><button type="button" className={styles.close} aria-label={t("Close")} onClick={() => setOpen(false)}><X aria-hidden="true" size={18} /></button></header>
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
