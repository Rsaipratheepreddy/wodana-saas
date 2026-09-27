"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button, SegmentedControl, SelectField, Switch, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { caseApi, caseRequest, type CaseDesign } from "@/lib/pre-project/content";
import { catalogImageUrl, type quoteApi } from "@/lib/quotation/client";
import { DOCUMENT_STYLES, documentVariables } from "@/lib/quotation/document-styles";
import { VIEW_LABEL } from "@/lib/quotation/format";
import { printDocument } from "@/lib/quotation/print-document";
import type { BuilderState, DocumentSection, QuoteDocument, QuoteView } from "@/lib/quotation/types";
import { QuoteDocumentView } from "./quote-document";
import styles from "./document-studio.module.css";

const SECTION_LABEL: Record<DocumentSection, string> = { cover: "Cover", intro: "Introduction", summary: "Summary", items: "Items", payments: "Payments", terms: "Terms", acceptance: "Acceptance" };

/**
 * The client document: pick one of the designed styles, write the words (cover, letter, terms),
 * choose what shows, and print or save it as a PDF. Items and money come from the quote.
 */
export function DocumentStudio({ state, api, workspaceId, caseId, onState, onError }: {
  state: BuilderState; api: ReturnType<typeof quoteApi>; workspaceId: string; caseId: string; onState: (state: BuilderState) => void; onError: (message: string) => void;
}) {
  const t = useT();
  const [doc, setDoc] = useState<QuoteDocument>(state.document);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [images, setImages] = useState<Array<{ id: string; title: string }>>([]);
  const [zoom, setZoom] = useState(1);
  const pending = useRef<Partial<QuoteDocument>>({});
  const timer = useRef<number | undefined>(undefined);
  const preview = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const readOnly = !state.canEdit;

  // Approved design images can be the cover.
  useEffect(() => {
    let alive = true;
    caseRequest<{ items: CaseDesign[] }>(workspaceId, caseId, "designs").then((result) => {
      if (!alive) return;
      setImages(result.items.filter((design) => !design.archivedAt).flatMap((design) => {
        const latest = design.versions[0];
        return latest?.status === "approved" && latest.asset && (latest.asset.mimeType.startsWith("image/") || latest.asset.hasPreview) ? [{ id: latest.asset.id, title: design.title }] : [];
      }));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [workspaceId, caseId]);

  // The document fits the width available; the sheets stay A4.
  useEffect(() => {
    const element = preview.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setZoom(Math.min(1, Math.max(0.35, (element.clientWidth - 32) / 794))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const change = (patch: Partial<QuoteDocument>) => {
    setDoc((current) => ({ ...current, ...patch, sections: { ...current.sections, ...(patch.sections ?? {}) } }));
    if (readOnly) return;
    pending.current = { ...pending.current, ...patch, sections: { ...(pending.current.sections ?? {}), ...(patch.sections ?? {}) } as QuoteDocument["sections"] };
    if (!patch.sections) delete pending.current.sections;
    setSaved("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const body = pending.current; pending.current = {};
      try { onState(await api.document(body)); setSaved("saved"); } catch (cause) { onError(cause instanceof Error ? cause.message : t("Could not save.")); setSaved("idle"); }
    }, 600);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const view = { ...state, document: doc };
  const coverUrl = doc.coverAssetId ? caseApi(workspaceId, caseId, `assets/${doc.coverAssetId}?view=1`) : null;
  return <div className={styles.studio}>
    <aside className={styles.panel} aria-label={t("Document settings")}>
      <section>
        <h3>{t("Style")}</h3>
        <div className={styles.gallery} role="radiogroup" aria-label={t("Document style")}>
          {DOCUMENT_STYLES.map((style) => <button key={style.id} type="button" role="radio" aria-checked={doc.style === style.id} disabled={readOnly}
            className={styles.swatch} style={documentVariables(style, state.brand.primaryColor, null) as React.CSSProperties} onClick={() => change({ style: style.id })}>
            <span className={styles.mini} data-cover={style.cover}><span /><span><i /><i /><i /></span></span>
            <strong>{style.name}</strong><small>{t(style.mood as never)}</small>
          </button>)}
        </div>
        <div className={styles.accent}>
          <label>{t("Accent colour")}<input type="color" disabled={readOnly} value={doc.accent ?? state.brand.primaryColor} onChange={(event) => change({ accent: event.target.value })} /></label>
          {doc.accent ? <Button size="compact" variant="quiet" isDisabled={readOnly} onPress={() => change({ accent: null })}>{t("Use the style's colour")}</Button> : null}
        </div>
      </section>
      <section>
        <h3>{t("Cover")}</h3>
        <TextInput label={t("Title")} placeholder={t("Interior proposal")} isReadOnly={readOnly} value={doc.title} onChange={(value) => change({ title: value })} />
        <TextInput label={t("Subtitle")} isReadOnly={readOnly} value={doc.subtitle} onChange={(value) => change({ subtitle: value })} />
        {images.length ? <div className={styles.images} role="radiogroup" aria-label={t("Cover image")}>
          <button type="button" role="radio" aria-checked={!doc.coverAssetId} disabled={readOnly} onClick={() => change({ coverAssetId: null })}>{t("None")}</button>
          {images.map((image) => <button key={image.id} type="button" role="radio" aria-checked={doc.coverAssetId === image.id} aria-label={image.title} disabled={readOnly} onClick={() => change({ coverAssetId: image.id })}>
            {/* Authenticated same-origin preview. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={caseApi(workspaceId, caseId, `assets/${image.id}?preview=1`)} alt="" />
          </button>)}
        </div> : <p className={styles.hint}>{t("Approved design images can be used as the cover.")}</p>}
      </section>
      <section>
        <h3>{t("Sections")}</h3>
        {(Object.keys(SECTION_LABEL) as DocumentSection[]).map((section) => <Switch key={section} isDisabled={readOnly} isSelected={doc.sections[section]} onChange={(on) => change({ sections: { ...doc.sections, [section]: on } })}>{t(SECTION_LABEL[section] as never)}</Switch>)}
      </section>
      {doc.sections.intro ? <section>
        <h3>{t("Introduction")}</h3>
        <TextAreaField label={t("Letter to the client")} isReadOnly={readOnly} value={doc.intro} onChange={(value) => change({ intro: value })} />
      </section> : null}
      <section>
        <h3>{t("Items")}</h3>
        <SelectField label={t("Group by")} isDisabled={readOnly} selectedKey={doc.itemsView} onSelectionChange={(key) => change({ itemsView: key as QuoteView })}
          items={(["area", "trade", "area_trade"] as QuoteView[]).map((id) => ({ id, label: t(VIEW_LABEL[id] as never) }))} />
        <SegmentedControl label={t("Show")} value={doc.itemsDetail} onChange={(value) => change({ itemsDetail: value as QuoteDocument["itemsDetail"] })}
          options={[{ id: "lines", label: t("Every item") }, { id: "totals", label: t("Group totals") }]} />
        <Switch isDisabled={readOnly} isSelected={doc.showRates} onChange={(on) => change({ showRates: on })}>{t("Show rates")}</Switch>
        <Switch isDisabled={readOnly} isSelected={doc.showDescriptions} onChange={(on) => change({ showDescriptions: on })}>{t("Show descriptions")}</Switch>
        <Switch isDisabled={readOnly} isSelected={doc.showImages} onChange={(on) => change({ showImages: on })}>{t("Show pictures")}</Switch>
      </section>
    </aside>
    <div className={styles.previewArea}>
      <div className={styles.previewBar}>
        <span className={styles.hint} aria-live="polite">{saved === "saving" ? t("Saving…") : saved === "saved" ? t("Saved") : null}</span>
        <Button size="compact" onPress={() => { if (sheet.current) void printDocument(sheet.current.firstElementChild as HTMLElement, `Q-${state.quote.number} ${state.quote.title}`).catch((cause: Error) => onError(cause.message)); }}>
          <Printer aria-hidden="true" size={14} />{t("Print or save as PDF")}
        </Button>
      </div>
      <div className={styles.preview} ref={preview}>
        <div ref={sheet} style={{ zoom }}><QuoteDocumentView state={view} coverUrl={coverUrl}
          imageOf={(line) => line.imageAssetId ? caseApi(workspaceId, caseId, `assets/${line.imageAssetId}?preview=1`) : line.catalogImageId ? catalogImageUrl(workspaceId, line.catalogImageId) : null} /></div>
      </div>
    </div>
  </div>;
}
