"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Check, ExternalLink, Link2, Sparkles } from "lucide-react";
import { Button, Callout, ControlledModalDialog, MoreDetails, SelectField, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { isAiPauseMessage } from "@/lib/ai/pause";
import { AiPauseNotice } from "@/components/workspace/ai-pause-notice";
import type { CatalogStructure } from "@/lib/workspace/catalog-v2";
import { CLIP_FIELDS, clipImageUrl, clipperBookmarklet, sourcingApi, suggestedCode, type ClipField, type ClipFieldRow, type ProductClip } from "@/lib/workspace/product-sourcing";
import styles from "./product-sourcing.module.css";

const UNITS = ["mm", "cm", "m", "in", "ft"];
const newId = () => crypto.randomUUID();

/**
 * Values a person should check before saving: those read from the page text or suggested by AI (with its confidence;
 * the AI's quote from the page is the tooltip). Every field's source is kept with the item either way.
 */
export function ProvenanceNote({ row }: { row: ClipFieldRow | undefined }) {
  const t = useT();
  if (!row || (row.source !== "ai" && row.source !== "page_text")) return null;
  const edited = row.decision === "edited" || row.decision === "rejected";
  return <small className={styles.provenance} data-source={row.source} title={row.evidence ?? undefined}>
    {row.source === "ai" ? <><Sparkles aria-hidden="true" size={11} />{t("AI")}{row.confidence !== null ? ` · ${Math.round(row.confidence * 100)}%` : ""}</> : t("From the page text")}
    {edited ? ` · ${t("changed")}` : ""}
  </small>;
}

/** The browser button: drag it to the bookmarks bar; on a supplier's page it opens this dialog with the link. */
function ClipperButton() {
  const t = useT();
  const link = useRef<HTMLAnchorElement>(null);
  // React refuses javascript: links in props; the bookmarklet is set on the element itself.
  useEffect(() => { link.current?.setAttribute("href", clipperBookmarklet(window.location.origin)); }, []);
  return <a className={styles.bookmarklet} draggable onClick={(event) => event.preventDefault()} ref={link} title={t("Drag to your bookmarks bar")}>
    <Bookmark aria-hidden="true" size={13} />{t("Save to catalog")}
  </a>;
}

type Draft = Record<ClipField, string> & { code: string; itemType: "product" | "material" | "ready_made"; unitCode: string; categoryId: string; vendorId: string };

function draftFrom(clip: ProductClip, structure: CatalogStructure | null): Draft {
  const value = (field: ClipField) => clip.fields.find((row) => row.field === field)?.proposedValue ?? "";
  const fields = Object.fromEntries(clip.fields.map((row) => [row.field, row.proposedValue ?? ""])) as Partial<Record<ClipField, string>>;
  const units = structure?.units ?? [];
  return {
    name: "", brand: "", sku: "", description: "", price: "", finish: "", material: "", colour: "", lead_time_days: "", width: "", depth: "", height: "", diagonal_depth: "",
    ...fields,
    currency: value("currency") || clip.defaults.currency || "",
    dimension_unit: value("dimension_unit") || clip.defaults.unit,
    code: suggestedCode(value("sku"), value("name")),
    itemType: "product", unitCode: units.some((unit) => unit.code === "pcs") ? "pcs" : units[0]?.code ?? "pcs", categoryId: "", vendorId: "",
  };
}

/**
 * Add from link (plan §0.7 R4): paste a supplier's product page (or arrive from the browser button), the server reads
 * it, the person checks every field and the pictures to keep, and the item is added to the catalog with the link.
 */
export function ProductClipDialog({ workspaceId, catalogId, structure, isOpen, initialUrl = "", onClose, onSaved }: {
  workspaceId: string; catalogId: string; structure: CatalogStructure | null; isOpen: boolean; initialUrl?: string; onClose: () => void; onSaved: (itemId: string) => void;
}) {
  const t = useT();
  const [url, setUrl] = useState(initialUrl);
  const [clipId, setClipId] = useState(newId);
  const [clip, setClip] = useState<ProductClip | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pictures, setPictures] = useState<Set<string>>(new Set());
  const [vendors, setVendors] = useState<Array<{ id: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (isOpen && initialUrl) setUrl(initialUrl); }, [isOpen, initialUrl]);
  useEffect(() => {
    if (!isOpen) return;
    fetch(`/api/workspace/vendors?${new URLSearchParams({ workspaceId })}`, { cache: "no-store" }).then((response) => (response.ok ? response.json() : null))
      .then((page: { data?: Array<{ id: string; displayName: string }> } | null) => setVendors((page?.data ?? []).map((vendor) => ({ id: vendor.id, label: vendor.displayName })))).catch(() => setVendors([]));
  }, [isOpen, workspaceId]);

  const reset = () => { setClip(null); setDraft(null); setPictures(new Set()); setError(""); setClipId(newId()); };
  const close = () => {
    // A read that was never saved is put aside so it doesn't linger in review.
    if (clip?.status === "review") void sourcingApi(workspaceId, `clips/${clip.id}/discard`, { body: { version: clip.version } }).catch(() => undefined);
    reset(); setUrl(""); onClose();
  };
  const read = async () => {
    setBusy(true); setError("");
    try {
      const next = await sourcingApi<ProductClip>(workspaceId, "clips", { body: { clipId, catalogId, url: url.trim() } });
      setClip(next); setDraft(draftFrom(next, structure)); setPictures(new Set(next.images.map((image) => image.id)));
    } catch (reason) { setError(reason instanceof Error ? reason.message : ""); setClipId(newId()); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!clip || !draft) return;
    setBusy(true); setError("");
    try {
      const values = Object.fromEntries(CLIP_FIELDS.map((key) => [key, draft[key].trim() || null]));
      const saved = await sourcingApi<ProductClip>(workspaceId, `clips/${clip.id}/save`, { body: {
        version: clip.version, code: draft.code.trim(), itemType: draft.itemType, unitCode: draft.unitCode, categoryId: draft.categoryId || undefined,
        values, imageIds: clip.images.filter((image) => pictures.has(image.id)).map((image) => image.id), vendorId: draft.vendorId || undefined,
      } });
      reset(); setUrl("");
      onSaved(saved.itemId ?? saved.catalogItemId ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : ""); }
    finally { setBusy(false); }
  };

  const row = (field: ClipField) => clip?.fields.find((entry) => entry.field === field);
  const set = (key: keyof Draft) => (value: string) => setDraft((current) => (current ? { ...current, [key]: value } : current));
  const field = (key: ClipField, label: string, options: { wide?: boolean; ltr?: boolean; maxLength?: number } = {}) => <div className={`${styles.field} ${options.wide ? styles.wide : ""}`} key={key}>
    <TextInput dir={options.ltr ? "ltr" : undefined} label={label} maxLength={options.maxLength ?? 200} onChange={set(key)} value={draft?.[key] ?? ""} />
    <ProvenanceNote row={row(key)} />
  </div>;
  const types = useMemo(() => [{ id: "product", label: t("Product") }, { id: "ready_made", label: t("Ready-made") }, { id: "material", label: t("Material") }], [t]);

  const footer = <div className="wd-dialog-actions">
    <Button onPress={clip ? reset : close}>{clip ? t("Back") : t("Cancel")}</Button>
    {clip ? <Button isDisabled={!draft?.name.trim() || !draft.code.trim()} isLoading={busy} onPress={() => void save()} variant="primary"><Check aria-hidden="true" size={15} />{t("Add to catalog")}</Button>
      : <Button isDisabled={url.trim().length < 8} isLoading={busy} onPress={() => void read()} variant="primary">{t("Read page")}</Button>}
  </div>;

  return <ControlledModalDialog footer={footer} isDirty={Boolean(clip)} isOpen={isOpen} onOpenChange={(open) => { if (!open) close(); }} size="lg" title={t("Add from link")}>
    <div className={styles.panel}>
      {isAiPauseMessage(error) ? <AiPauseNotice message={error} /> : error ? <Callout title={clip ? t("Could not add the item") : t("Could not read the page")} tone="danger">{error}</Callout> : null}
      {!clip || !draft ? <div className={styles.clipStart}>
        <form className={styles.clipRead} onSubmit={(event) => { event.preventDefault(); if (url.trim().length >= 8) void read(); }}>
          <TextInput autoFocus dir="ltr" inputType="url" isRequired label={t("Product link")} onChange={setUrl} placeholder="https://" prefix={<Link2 aria-hidden="true" size={14} />} value={url} />
        </form>
        <ClipperButton />
      </div> : <div className={styles.review}>
        <div className={styles.panel}>
          {clip.images.length ? <ul aria-label={t("Pictures")} className={styles.pictures}>{clip.images.map((image, index) => {
            const chosen = pictures.has(image.id);
            return <li key={image.id}><button aria-label={`${t("Picture")} ${index + 1}`} aria-pressed={chosen} className={styles.picture} type="button"
              onClick={() => setPictures((current) => { const next = new Set(current); if (chosen) next.delete(image.id); else next.add(image.id); return next; })}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a copy kept in our storage, streamed through the signed-in route */}
              <img alt="" loading="lazy" src={clipImageUrl(workspaceId, clip.id, image.id)} />
              {chosen ? <Check aria-hidden="true" size={16} /> : null}
            </button></li>;
          })}</ul> : null}
          <p className={styles.source}><span dir="ltr">{clip.host}</span><a href={clip.finalUrl} rel="noopener noreferrer nofollow" target="_blank"><ExternalLink aria-hidden="true" data-directional="true" size={12} /> {t("Open page")}</a></p>
          {clip.aiStatus === "failed" ? <small className={styles.provenance}>{t("AI couldn't fill the gaps this time.")}</small> : null}
        </div>
        <div className={styles.fields}>
          {field("name", t("Name"), { wide: true })}
          <div className={styles.field}><TextInput dir="ltr" isRequired label={t("Code")} maxLength={80} onChange={set("code")} value={draft.code} /></div>
          {field("brand", t("Brand"))}
          <SelectField items={types} label={t("Type")} onSelectionChange={(key) => set("itemType")(String(key))} selectedKey={draft.itemType} />
          <SelectField items={(structure?.units ?? []).map((unit) => ({ id: unit.code, label: `${unit.code} · ${unit.label}` }))} label={t("Unit")} onSelectionChange={(key) => set("unitCode")(String(key))} selectedKey={draft.unitCode} />
          {field("price", t("Price"), { ltr: true, maxLength: 24 })}
          {field("currency", t("Currency"), { ltr: true, maxLength: 3 })}
          <div className={styles.sizeRow} role="group" aria-label={t("Size")}>
            {field("width", t("Width"), { ltr: true, maxLength: 12 })}
            {field("depth", t("Depth"), { ltr: true, maxLength: 12 })}
            {field("height", t("Height"), { ltr: true, maxLength: 12 })}
            {field("diagonal_depth", t("Diagonal depth"), { ltr: true, maxLength: 12 })}
            <SelectField items={UNITS.map((unit) => ({ id: unit, label: unit }))} label={t("Unit")} onSelectionChange={(key) => set("dimension_unit")(String(key))} selectedKey={draft.dimension_unit} />
          </div>
          {field("finish", t("Finish"))}
          {field("material", t("Material"))}
          {field("colour", t("Colour"))}
          {field("lead_time_days", t("Lead time (days)"), { ltr: true, maxLength: 4 })}
          {vendors.length ? <SelectField items={[{ id: "", label: t("No supplier") }, ...vendors]} label={t("Supplier")} onSelectionChange={(key) => set("vendorId")(String(key ?? ""))} selectedKey={draft.vendorId} /> : null}
          <SelectField items={[{ id: "", label: t("No category") }, ...(structure?.categories ?? []).map((category) => ({ id: category.id, label: category.name }))]} label={t("Category")} onSelectionChange={(key) => set("categoryId")(String(key ?? ""))} selectedKey={draft.categoryId} />
          <div className={styles.wide}><MoreDetails filled={draft.description || draft.sku ? 1 : 0}>
            {field("sku", t("Supplier code"), { ltr: true, maxLength: 80 })}
            <TextAreaField label={t("Description")} maxLength={4000} onChange={set("description")} value={draft.description} />
            <ProvenanceNote row={row("description")} />
          </MoreDetails></div>
        </div>
      </div>}
    </div>
  </ControlledModalDialog>;
}

