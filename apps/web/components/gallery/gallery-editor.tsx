"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, ExternalLink, ImagePlus, Plus, Trash2 } from "lucide-react";
import { Badge, Button, ControlledModalDialog, EmptyState, IconButton, InlineNotice, PageHeader, PillTabs, SearchInput, SelectField, Skeleton, Switch, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { DEFAULT_DISPLAY, type GalleryEditorData, type GalleryItem, type GalleryKind, type GallerySectionKey, type GallerySettings } from "@/lib/gallery/types";
import { catalogImageUrl } from "@/lib/quotation/client";
import { DOCUMENT_STYLES, documentVariables } from "@/lib/quotation/document-styles";
import { GalleryView } from "./gallery-view";
import styles from "./gallery-editor.module.css";

type Tab = "look" | "services" | "products" | "projects" | "testimonials" | "about" | "share";
const TAB_KIND: Partial<Record<Tab, GalleryKind>> = { services: "service", products: "product", projects: "project", testimonials: "testimonial" };
const SECTION_LABEL: Record<GallerySectionKey, string> = { services: "Services", products: "Products", projects: "Recent projects", testimonials: "What clients say", about: "About us", contact: "Contact" };
const ADD_LABEL: Record<GalleryKind, string> = { service: "Add a service", product: "Add a product", project: "Add a project", testimonial: "Add feedback" };

async function call<T>(workspaceId: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/gallery${path}?${new URLSearchParams({ workspaceId })}`, { method, headers: body instanceof FormData || body === undefined ? undefined : { "content-type": "application/json" }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "Could not save.");
  return data as T;
}

/**
 * The company gallery editor: how it looks, what it shows (services, products, projects, client
 * feedback, about and contact), and sharing. The page on the right is exactly what visitors see.
 */
export function GalleryEditor({ workspaceId, origin }: { workspaceId: string; origin: string }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [data, setData] = useState<GalleryEditorData | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("look");
  const [saved, setSaved] = useState<"" | "saving" | "saved">("");
  const pending = useRef<Partial<GallerySettings>>({});
  const timer = useRef<number | undefined>(undefined);
  const version = useRef(0);

  const load = useCallback(async () => {
    try { const next = await call<GalleryEditorData>(workspaceId, ""); setData(next); version.current = next.settings.version; setLoadError(""); }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : t("The gallery didn't load.")); }
  }, [workspaceId, t]);
  useEffect(() => {
    let alive = true;
    call<GalleryEditorData>(workspaceId, "").then((next) => { if (alive) { setData(next); version.current = next.settings.version; } }).catch((cause: Error) => { if (alive) setLoadError(cause.message); });
    return () => { alive = false; };
  }, [workspaceId]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Settings save as you type (a moment after you stop), in order, with the version last seen.
  const change = (patch: Partial<GallerySettings>, now = false) => {
    setData((current) => current ? { ...current, settings: { ...current.settings, ...patch } } : current);
    pending.current = { ...pending.current, ...patch };
    setSaved("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const body = pending.current; pending.current = {};
      try {
        const next = await call<GallerySettings>(workspaceId, "", "PUT", { ...body, version: version.current });
        version.current = next.version;
        setData((current) => current ? { ...current, settings: next } : current);
        setSaved("saved"); setError("");
      } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setSaved(""); void load(); }
    }, now ? 0 : 700);
  };

  if (loadError && !data) return <EmptyState illustration="error" title={t("The gallery didn't load")} description={loadError} action={<Button size="compact" onPress={() => void load()}>{t("Retry")}</Button>} />;
  if (!data) return <Skeleton lines={8} />;
  const { settings } = data;
  const readOnly = !data.canManage;
  const link = `${origin}/gallery/${settings.slug}`;
  const imageUrl = (id: string, preview?: boolean, source?: "gallery" | "catalog") => source === "catalog" ? catalogImageUrl(workspaceId, id, Boolean(preview)) : `/api/gallery/images/${id}?${new URLSearchParams({ workspaceId, ...(preview ? { preview: "1" } : {}) })}`;
  const setItems = (items: GalleryItem[]) => setData((current) => current ? { ...current, items } : current);
  const kind = TAB_KIND[tab];

  return <div className={styles.page}>
    <PageHeader title={t("Gallery")} actions={<div className={styles.headActions}>
      <span className={styles.saving} aria-live="polite">{saved === "saving" ? t("Saving…") : saved === "saved" ? t("Saved") : null}</span>
      <Badge tone={settings.status === "published" ? "success" : "neutral"}>{settings.status === "published" ? t("Live") : t("Draft")}</Badge>
      {settings.status === "published" ? <a className={styles.linkButton} href={link} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" size={14} />{t("Open")}</a> : null}
    </div>} />
    {error ? <InlineNotice tone="error" message={error} /> : null}
    <div className={styles.layout}>
      <aside className={styles.panel} aria-label={t("Gallery settings")}>
        <PillTabs ariaLabel={t("Gallery sections")} selectedKey={tab} onSelectionChange={(key) => setTab(key as Tab)} items={[
          { id: "look", label: t("Look") }, { id: "services", label: t("Services") }, { id: "products", label: t("Products") }, { id: "projects", label: t("Projects") },
          { id: "testimonials", label: t("Feedback") }, { id: "about", label: t("About & contact") }, { id: "share", label: t("Share") },
        ]} />
        {tab === "look" ? <LookPanel data={data} readOnly={readOnly} workspaceId={workspaceId} imageUrl={imageUrl} change={change} onError={setError} onUploaded={() => void load()} /> : null}
        {kind ? <ItemsPanel kind={kind} data={data} readOnly={readOnly} workspaceId={workspaceId} imageUrl={imageUrl} onItems={setItems} onError={setError} onReload={() => void load()} /> : null}
        {tab === "about" ? <section className={styles.form}>
          <TextAreaField label={t("About your firm")} isReadOnly={readOnly} value={settings.about} onChange={(value) => change({ about: value })} />
          <TextInput label={t("Phone")} isReadOnly={readOnly} inputType="tel" value={settings.contactPhone} onChange={(value) => change({ contactPhone: value })} />
          <TextInput label={t("WhatsApp")} isReadOnly={readOnly} inputType="tel" value={settings.contactWhatsapp} onChange={(value) => change({ contactWhatsapp: value })} />
          <TextInput label={t("Email")} isReadOnly={readOnly} inputType="email" value={settings.contactEmail} onChange={(value) => change({ contactEmail: value })} />
          <TextAreaField label={t("Address")} isReadOnly={readOnly} value={settings.contactAddress} onChange={(value) => change({ contactAddress: value })} />
        </section> : null}
        {tab === "share" ? <section className={styles.form}>
          <Switch isDisabled={readOnly} isSelected={settings.status === "published"} onChange={(on) => change({ status: on ? "published" : "draft" }, true)}>{t("Published: anyone with the link can see it")}</Switch>
          <TextInput label={t("Link")} isReadOnly={readOnly} value={settings.slug} onChange={(value) => change({ slug: value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60) })} description={link} />
          <div className={styles.row}>
            <Button size="compact" onPress={() => void navigator.clipboard?.writeText(link)}><Copy aria-hidden="true" size={14} />{t("Copy link")}</Button>
            {settings.status === "published" ? <a className={styles.linkButton} href={link} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" size={14} />{t("Open")}</a> : null}
          </div>
          <SelectField label={t("Enquiry form")} isDisabled={readOnly} selectedKey={settings.leadFormId} placeholder={t("Choose a form")}
            description={t("Visitors send their list through this form; it arrives in Sales like any enquiry.")}
            onSelectionChange={(key) => change({ leadFormId: key ? String(key) : null }, true)}
            items={data.forms.map((form) => ({ id: form.id, label: form.status === "published" ? form.title : t("{name} (not published)", { name: form.title }) }))} />
          <h3 className={styles.subhead}>{t("What visitors see")}</h3>
          <Switch isDisabled={readOnly} isSelected={settings.showPrices} onChange={(on) => change({ showPrices: on })}>{t("Starting prices")}</Switch>
          {([["descriptions", "Descriptions"], ["list", "My list and enquiries"], ["search", "Search"], ["chips", "Filter chips"], ["contact", "Contact buttons at the top"]] as const).map(([key, label]) =>
            <Switch key={key} isDisabled={readOnly} isSelected={(settings.display ?? DEFAULT_DISPLAY)[key]} onChange={(on) => change({ display: { ...(settings.display ?? DEFAULT_DISPLAY), [key]: on } }, true)}>{t(label as never)}</Switch>)}
        </section> : null}
      </aside>
      <div className={styles.preview} aria-label={t("Preview")}>
        <GalleryView content={data} imageUrl={imageUrl} preview locale={locale} />
      </div>
    </div>
  </div>;
}

function LookPanel({ data, readOnly, workspaceId, imageUrl, change, onError, onUploaded }: {
  data: GalleryEditorData; readOnly: boolean; workspaceId: string; imageUrl: (id: string, preview?: boolean) => string;
  change: (patch: Partial<GallerySettings>, now?: boolean) => void; onError: (message: string) => void; onUploaded: () => void;
}) {
  const t = useT();
  const { settings } = data;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const uploadCover = async (file: File) => {
    setBusy(true);
    try {
      const body = new FormData(); body.append("file", file);
      const id = crypto.randomUUID();
      await call(workspaceId, `/images/${id}`, "POST", body);
      change({ heroImageId: id }, true);
      onUploaded();
    } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not upload the picture.")); }
    finally { setBusy(false); }
  };
  const move = (index: number, step: number) => {
    const next = [...settings.sections];
    const [section] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + step)), 0, section);
    change({ sections: next }, true);
  };
  return <section className={styles.form}>
    <TextInput label={t("Headline")} isReadOnly={readOnly} value={settings.headline} onChange={(value) => change({ headline: value })} />
    <TextAreaField label={t("Introduction")} isReadOnly={readOnly} value={settings.intro} onChange={(value) => change({ intro: value })} />
    <div className={styles.cover}>
      {settings.heroImageId ? <img src={imageUrl(settings.heroImageId, true)} alt={t("Cover picture")} /> : <span className={styles.coverEmpty}>{t("No cover picture")}</span>}
      {readOnly ? null : <div className={styles.row}>
        <Button size="compact" isLoading={busy} onPress={() => input.current?.click()}><ImagePlus aria-hidden="true" size={14} />{settings.heroImageId ? t("Change cover") : t("Add cover")}</Button>
        {settings.heroImageId ? <Button size="compact" variant="quiet" onPress={() => change({ heroImageId: null }, true)}>{t("Remove")}</Button> : null}
      </div>}
      <input ref={input} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadCover(file); }} />
    </div>
    <h3 className={styles.subhead}>{t("Style")}</h3>
    <div className={styles.styles} role="radiogroup" aria-label={t("Gallery style")}>
      {DOCUMENT_STYLES.map((style) => <button key={style.id} type="button" role="radio" aria-checked={settings.style === style.id} disabled={readOnly}
        style={documentVariables(style, data.brand.primaryColor, null) as React.CSSProperties} onClick={() => change({ style: style.id }, true)}>
        <span className={styles.swatch}><i /><i /><i /></span><strong>{style.name}</strong>
      </button>)}
    </div>
    <label className={styles.accent}>{t("Accent colour")}<input type="color" disabled={readOnly} value={settings.accent ?? data.brand.primaryColor} onChange={(event) => change({ accent: event.target.value })} />
      {settings.accent && !readOnly ? <Button size="compact" variant="quiet" onPress={() => change({ accent: null }, true)}>{t("Use the style's colour")}</Button> : null}</label>
    <h3 className={styles.subhead}>{t("Sections")}</h3>
    <ol className={styles.sections}>{settings.sections.map((section, index) => <li key={section.key}>
      <Switch isDisabled={readOnly} isSelected={section.visible} onChange={(on) => change({ sections: settings.sections.map((item) => item.key === section.key ? { ...item, visible: on } : item) }, true)}>{t(SECTION_LABEL[section.key] as never)}</Switch>
      {readOnly ? null : <span>
        <IconButton aria-label={t("Move {name} up", { name: t(SECTION_LABEL[section.key] as never) })} size="compact" variant="quiet" isDisabled={index === 0} onPress={() => move(index, -1)}><ArrowUp aria-hidden="true" size={14} /></IconButton>
        <IconButton aria-label={t("Move {name} down", { name: t(SECTION_LABEL[section.key] as never) })} size="compact" variant="quiet" isDisabled={index === settings.sections.length - 1} onPress={() => move(index, 1)}><ArrowDown aria-hidden="true" size={14} /></IconButton>
      </span>}
    </li>)}</ol>
  </section>;
}

function ItemsPanel({ kind, data, readOnly, workspaceId, imageUrl, onItems, onError, onReload }: {
  kind: GalleryKind; data: GalleryEditorData; readOnly: boolean; workspaceId: string; imageUrl: (id: string, preview?: boolean, source?: "gallery" | "catalog") => string;
  onItems: (items: GalleryItem[]) => void; onError: (message: string) => void; onReload: () => void;
}) {
  const t = useT();
  const items = data.items.filter((item) => item.kind === kind).sort((a, b) => a.position - b.position);
  const [editing, setEditing] = useState<GalleryItem | null>(null);
  const [importing, setImporting] = useState(false);
  const blank = (): GalleryItem => ({ id: crypto.randomUUID(), kind, title: "", subtitle: "", body: "", priceFrom: null, priceUnit: "", catalogItemId: null, rating: kind === "testimonial" ? 5 : null, position: items.length, visible: true, version: 0, images: [] });
  const move = async (index: number, step: number) => {
    const ids = items.map((item) => item.id);
    const [id] = ids.splice(index, 1);
    ids.splice(Math.max(0, Math.min(ids.length, index + step)), 0, id);
    try { onItems((await call<{ items: GalleryItem[] }>(workspaceId, "/items/order", "POST", { kind, ids })).items); } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); }
  };
  return <section className={styles.items}>
    {readOnly ? null : <div className={styles.row}>
      <Button size="compact" variant="primary" onPress={() => setEditing(blank())}><Plus aria-hidden="true" size={14} />{t(ADD_LABEL[kind] as never)}</Button>
      {kind === "product" ? <Button size="compact" onPress={() => setImporting(true)}>{t("Add from catalog")}</Button> : null}
    </div>}
    {items.length ? <ul>{items.map((item, index) => <li key={item.id} data-hidden={item.visible ? undefined : true}>
      <button type="button" className={styles.itemRow} onClick={() => setEditing(item)}>
        <span className={styles.thumb}>{item.images[0] && !item.images[0].video ? <img src={imageUrl(item.images[0].id, true, item.images[0].source)} alt="" /> : null}</span>
        <span><strong>{item.title}</strong><small>{item.visible ? item.subtitle || (item.catalogItemId ? t("From the catalog") : "") : t("Hidden")}</small></span>
      </button>
      {readOnly ? null : <span className={styles.order}>
        <IconButton aria-label={t("Move {name} up", { name: item.title })} size="compact" variant="quiet" isDisabled={index === 0} onPress={() => void move(index, -1)}><ArrowUp aria-hidden="true" size={14} /></IconButton>
        <IconButton aria-label={t("Move {name} down", { name: item.title })} size="compact" variant="quiet" isDisabled={index === items.length - 1} onPress={() => void move(index, 1)}><ArrowDown aria-hidden="true" size={14} /></IconButton>
      </span>}
    </li>)}</ul> : <p className={styles.muted}>{t("Nothing here yet.")}</p>}
    {editing ? <ItemDialog item={editing} workspaceId={workspaceId} readOnly={readOnly} imageUrl={imageUrl} currency={data.currency}
      onClose={() => setEditing(null)} onSaved={(next) => { onItems(next); setEditing(null); }} onReload={onReload} onError={onError} /> : null}
    {importing ? <CatalogImport workspaceId={workspaceId} onClose={() => setImporting(false)} onDone={(next) => { onItems(next); setImporting(false); }} onError={onError} /> : null}
  </section>;
}

function ItemDialog({ item, workspaceId, readOnly, imageUrl, currency, onClose, onSaved, onReload, onError }: {
  item: GalleryItem; workspaceId: string; readOnly: boolean; imageUrl: (id: string, preview?: boolean, source?: "gallery" | "catalog") => string; currency: string;
  onClose: () => void; onSaved: (items: GalleryItem[]) => void; onReload: () => void; onError: (message: string) => void;
}) {
  const t = useT();
  const [form, setForm] = useState(item);
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState(item.images);
  const input = useRef<HTMLInputElement>(null);
  const isNew = item.version === 0;
  const set = <K extends keyof GalleryItem>(key: K, value: GalleryItem[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setBusy(true);
    try {
      const result = await call<{ items: GalleryItem[] }>(workspaceId, "/items", "POST", {
        id: form.id, kind: form.kind, title: form.title, subtitle: form.subtitle, body: form.body, priceFrom: form.priceFrom || null, priceUnit: form.priceUnit,
        catalogItemId: form.catalogItemId, rating: form.rating, visible: form.visible, ...(isNew ? {} : { version: item.version }),
      });
      onSaved(result.items);
    } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    if (isNew) { onError(t("Save it first, then add pictures.")); return; }
    setBusy(true);
    try {
      for (const file of [...files].slice(0, 10)) {
        const body = new FormData(); body.append("file", file);
        const id = crypto.randomUUID();
        await fetch(`/api/gallery/images/${id}?${new URLSearchParams({ workspaceId, itemId: item.id })}`, { method: "POST", body }).then(async (response) => { if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? t("Could not upload the picture.")); });
        setImages((current) => [...current, { id, source: "gallery", video: file.type.startsWith("video/") }]);
      }
      onReload();
    } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not upload the picture.")); }
    finally { setBusy(false); }
  };
  const removeImage = async (id: string) => {
    try { await call(workspaceId, `/images/${id}`, "DELETE"); setImages((current) => current.filter((image) => image.id !== id)); onReload(); } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); }
  };
  const remove = async () => {
    setBusy(true);
    try { onSaved((await call<{ items: GalleryItem[] }>(workspaceId, `/items/${item.id}`, "DELETE")).items); } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  const testimonial = form.kind === "testimonial";
  return <ControlledModalDialog isOpen size="lg" title={isNew ? t(ADD_LABEL[form.kind] as never) : form.title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={readOnly ? undefined : <div className={styles.dialogActions}>
      {isNew ? null : <Button size="compact" variant="quiet" isDisabled={busy} onPress={() => void remove()}><Trash2 aria-hidden="true" size={14} />{t("Delete")}</Button>}
      <span className={styles.spacer} />
      <Button size="compact" onPress={onClose}>{t("Cancel")}</Button>
      <Button size="compact" variant="primary" isLoading={busy} isDisabled={!form.title.trim()} onPress={() => void save()}>{t("Save")}</Button>
    </div>}>
    <div className={styles.form}>
      <TextInput label={testimonial ? t("Client name") : t("Name")} isReadOnly={readOnly} value={form.title} onChange={(value) => set("title", value)} />
      <TextInput label={testimonial ? t("Project or role") : form.kind === "project" ? t("Location") : t("Label")} isReadOnly={readOnly} value={form.subtitle} onChange={(value) => set("subtitle", value)} />
      <TextAreaField label={testimonial ? t("What they said") : t("Description")} isReadOnly={readOnly} value={form.body} onChange={(value) => set("body", value)} />
      {form.kind === "service" || form.kind === "product" ? <div className={styles.pair}>
        <TextInput label={t("Starting price ({currency})", { currency })} isReadOnly={readOnly} inputMode="decimal" value={form.priceFrom ?? ""} onChange={(value) => set("priceFrom", value.replace(/[^\d.]/g, "") || null)} />
        <TextInput label={t("Per")} placeholder={t("e.g. sq ft, room, villa")} isReadOnly={readOnly} value={form.priceUnit} onChange={(value) => set("priceUnit", value)} />
      </div> : null}
      {testimonial ? <SelectField label={t("Rating")} isDisabled={readOnly} selectedKey={String(form.rating ?? 5)} onSelectionChange={(key) => set("rating", Number(key))} items={[5, 4, 3, 2, 1].map((value) => ({ id: String(value), label: "★".repeat(value) }))} /> : null}
      <Switch isDisabled={readOnly} isSelected={form.visible} onChange={(on) => set("visible", on)}>{t("Show in the gallery")}</Switch>
      <div className={styles.pictures}>
        {images.map((image) => <span key={image.id}>{image.video ? <video src={imageUrl(image.id, false, image.source)} muted playsInline preload="metadata" /> : <img src={imageUrl(image.id, true, image.source)} alt="" />}
          {readOnly || image.source === "catalog" ? null : <IconButton aria-label={t("Remove picture")} size="compact" variant="quiet" onPress={() => void removeImage(image.id)}><Trash2 aria-hidden="true" size={13} /></IconButton>}</span>)}
        {readOnly ? null : <button type="button" className={styles.addPicture} onClick={() => input.current?.click()} aria-label={t("Add pictures or videos")}><ImagePlus aria-hidden="true" size={18} /></button>}
        <input ref={input} type="file" accept="image/*,video/mp4,video/webm" multiple hidden onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} />
      </div>
      {isNew ? <p className={styles.muted}>{t("Save it first, then add pictures.")}</p> : null}
    </div>
  </ControlledModalDialog>;
}

function CatalogImport({ workspaceId, onClose, onDone, onError }: { workspaceId: string; onClose: () => void; onDone: (items: GalleryItem[]) => void; onError: (message: string) => void }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Array<{ id: string; name: string; unit: string; category: string | null; imageId: string | null }> | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      fetch(`/api/gallery/catalog?${new URLSearchParams({ workspaceId, q: search })}`, { cache: "no-store" }).then((response) => response.json())
        .then((result: { items?: typeof rows }) => { if (alive) setRows(result.items ?? []); }).catch(() => { if (alive) setRows([]); });
    }, 200);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [workspaceId, search]);
  const add = async () => {
    setBusy(true);
    try { onDone((await call<{ items: GalleryItem[] }>(workspaceId, "/items/from-catalog", "POST", { itemIds: picked })).items); } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); }
    finally { setBusy(false); }
  };
  return <ControlledModalDialog isOpen size="lg" title={t("Add from catalog")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className={styles.dialogActions}><span className={styles.spacer} /><Button size="compact" onPress={onClose}>{t("Cancel")}</Button>
      <Button size="compact" variant="primary" isLoading={busy} isDisabled={!picked.length} onPress={() => void add()}>{picked.length === 1 ? t("Add 1 product") : t("Add {count} products", { count: picked.length })}</Button></div>}>
    <div className={styles.form}>
      <SearchInput label={t("Search the catalog")} value={search} onChange={setSearch} />
      {rows === null ? <Skeleton lines={4} /> : rows.length ? <ul className={styles.catalog}>{rows.map((row) => <li key={row.id}>
        <label>
          <input type="checkbox" checked={picked.includes(row.id)} onChange={(event) => setPicked((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} />
          <span className={styles.thumb}>{row.imageId ? <img src={catalogImageUrl(workspaceId, row.imageId)} alt="" /> : null}</span>
          <span><strong>{row.name}</strong><small>{[row.category, row.unit].filter(Boolean).join(" · ")}</small></span>
        </label>
      </li>)}</ul> : <p className={styles.muted}>{t("No catalog items left to add.")}</p>}
    </div>
  </ControlledModalDialog>;
}
