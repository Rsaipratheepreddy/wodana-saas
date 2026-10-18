"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type Translate } from "@/lib/i18n/keys";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  applyNodeChanges,
  Background,
  Controls,
  NodeResizer,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeChange,
  type NodeProps,
  type ResizeParams,
} from "@xyflow/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ImagePlus,
  Palette,
  Plus,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import type {
  PortalBrand,
  Quote,
  QuoteCanvasElement,
  QuoteCanvasPage,
  QuotePresentation,
} from "@/lib/commercial/types";
import {
  QuotationDocumentPage,
  quotationPages,
  type DocumentPage,
} from "./quotation-document-page";
import "@xyflow/react/dist/style.css";
import {QuoteRichText} from "./quotation-rich-text";
import styles from "./quotation-canvas.module.css";

const PAGE_WIDTH = 940;
const PAGE_HEIGHT = 1150;
const DEFAULT_PRESENTATION: QuotePresentation = {
  version: 1,
  pageBackground: "#E4E3DE",
  textColor: "#000000",
  accentColor: "#000000",
  pages: [],
};

type CanvasPage = DocumentPage;
type PageNodeData = {
  background: string;
  backgroundImage?: string;
  content?: React.ReactNode;
  textColor: string;
  accentColor: string;
};
type ElementNodeData = {
  element: QuoteCanvasElement;
  readOnly: boolean;
  onResize: (id: string, size: ResizeParams) => void;
};
type PageNode = Node<PageNodeData, "quotePage">;
type ElementNode = Node<ElementNodeData, "quoteElement">;
type CanvasNode = PageNode | ElementNode;

function QuotePageNode({ data }: NodeProps<PageNode>) {
  return (
    <div
      className={styles.pageNode}
      style={
        {
          backgroundColor: data.background,
          backgroundImage: data.backgroundImage
            ? `linear-gradient(rgb(255 255 255 / 8%), rgb(255 255 255 / 8%)), url(${JSON.stringify(data.backgroundImage).slice(1, -1)})`
            : undefined,
          "--quote-canvas-text": data.textColor,
          "--quote-canvas-accent": data.accentColor,
        } as React.CSSProperties
      }
    >
      {data.content ? <div className={styles.smartPage}>{data.content}</div> : null}
    </div>
  );
}

function QuoteElementNode({ id, data, selected }: NodeProps<ElementNode>) {
  const t = useT();
  const element = data.element;
  return (
    <div className={styles.elementNode} data-selected={selected || undefined}>
      {!data.readOnly ? (
        <NodeResizer
          isVisible={selected}
          minWidth={80}
          minHeight={40}
          maxWidth={PAGE_WIDTH}
          maxHeight={PAGE_HEIGHT}
          keepAspectRatio={element.type === "image"}
          onResizeEnd={(_event, size) => data.onResize(id, size)}
        />
      ) : null}
      {element.type === "image" ? (
        element.src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={t("Quotation artwork")} draggable={false} src={element.src} />
        ) : (
          <span className={styles.imagePlaceholder}><ImagePlus size={24} />{t("Image")}</span>
        )
      ) : (
        <div
          className={styles.textElement}
          style={{
            color: element.color ?? "#000000",
            fontSize: element.fontSize ?? 28,
            textAlign: element.align ?? "left",
          }}
        >
          {element.text || t("Text")}
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  quotePage: QuotePageNode,
  quoteElement: QuoteElementNode,
};

function safePresentation(quote: Quote): QuotePresentation {
  return quote.presentation
    ? { ...DEFAULT_PRESENTATION, ...quote.presentation }
    : DEFAULT_PRESENTATION;
}

function pageOverride(presentation: QuotePresentation, id: string) {
  return presentation.pages.find((page) => page.id === id);
}

function fileData(file: File, t: Translate): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      reject(new Error(t("Choose a PNG, JPEG or WebP under 8 MB.")));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("The image could not be read.")));
    reader.onload = () => {
      const source = String(reader.result ?? "");
      const image = new Image();
      image.onerror = () => reject(new Error(t("The image could not be opened.")));
      image.onload = () => {
        const max = 1800;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.85, 0.65, 0.45, 0.25]) {
          const result = canvas.toDataURL("image/jpeg", quality);
          if (result.length <= 450000) { resolve(result); return; }
        }
        reject(new Error(t("Choose a smaller or simpler image.")));
      };
      image.src = source;
    };
    reader.readAsDataURL(file);
  });
}

export function QuotationCanvas(props: {
  quote: Quote;
  brand?: PortalBrand;
  customerName: string;
  readOnly?: boolean;
  onChange: (next: Quote) => void;
  onEditItems: () => void;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
}) {
  return <SequentialWorkspace {...props} />;
}

function SequentialWorkspace({ quote, brand, customerName, readOnly = false, onChange, onEditItems, toolbarStart, toolbarEnd }: {
  quote: Quote;
  brand?: PortalBrand;
  customerName: string;
  readOnly?: boolean;
  onChange: (next: Quote) => void;
  onEditItems: () => void;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
}) {
  const t = useT();
  const neutralBrand = brand ? { ...brand, primaryColor: "#E4E3DE", accentColor: "#000000" } : brand;
  const presentation = useMemo(() => safePresentation(quote), [quote.presentation]);
  const pages = useMemo(() => quotationPages(quote, t), [quote, t]);
  const [activePageId, setActivePageId] = useState(pages[0]?.id ?? "cover");
  const [notice, setNotice] = useState("");
  const backgroundInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const activeOverride = activePage ? pageOverride(presentation, activePage.id) : undefined;

  function updatePage(id: string, patch: Partial<QuoteCanvasPage>) {
    if (readOnly) return;
    const existing = pageOverride(presentation, id);
    const page = pages.find((candidate) => candidate.id === id);
    const next: QuoteCanvasPage = {
      id,
      title: page?.title,
      background: presentation.pageBackground,
      elements: [],
      ...existing,
      ...patch,
    };
    onChange({
      ...quote,
      presentation: {
        ...presentation,
        pages: [...presentation.pages.filter((candidate) => candidate.id !== id), next],
      },
    });
  }

  function updateElement(pageId: string, elementId: string, patch: Partial<QuoteCanvasElement>) {
    const page = pageOverride(presentation, pageId);
    updatePage(pageId, {
      elements: (page?.elements ?? []).map((element) => element.id === elementId ? { ...element, ...patch } : element),
    });
  }

  async function addImage(file?: File, background = false) {
    if (!activePage || !file || readOnly) return;
    try {
      const src = await fileData(file, t);
      if (background) updatePage(activePage.id, { backgroundImage: src });
      else {
        const element: QuoteCanvasElement = { id: crypto.randomUUID(), type: "image", x: 110, y: 170, width: 460, height: 310, src };
        updatePage(activePage.id, { elements: [...(activeOverride?.elements ?? []), element] });
      }
      setNotice(t(background ? "Page background updated." : "Image added to the selected page."));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("The image could not be added."));
    }
  }

  function addText() {
    if (!activePage || readOnly) return;
    const element: QuoteCanvasElement = {
      id: crypto.randomUUID(), type: "text", x: 110, y: 120, width: 420, height: 90,
      text: t("Add your message"), color: presentation.textColor, fontSize: 30, align: "left",
    };
    updatePage(activePage.id, { elements: [...(activeOverride?.elements ?? []), element] });
  }

  return (
    <section className={styles.sequentialWorkspace} aria-label={t("Quotation page designer")}>
      <header className={styles.toolbar}>
        <div>
          {toolbarStart}
          {!readOnly ? <button type="button" className={styles.addItem} onClick={onEditItems}><Plus size={15} />{t("Add item")}</button> : null}
          {!readOnly ? <button type="button" onClick={addText}><Type size={15} />{t("Text")}</button> : null}
          {!readOnly ? <button type="button" onClick={() => imageInput.current?.click()}><ImagePlus size={15} />{t("Image")}</button> : null}
          <input ref={imageInput} hidden type="file" accept="image/*" onChange={(event) => { void addImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        </div>
        <div>
          {toolbarEnd}
          {!readOnly && activePage ? <label className={styles.colorTool}>{t("Page")}{" "}<input aria-label={t("Page background colour")} type="color" value={activeOverride?.background ?? presentation.pageBackground} onChange={(event) => updatePage(activePage.id, { background: event.target.value })} /></label> : null}
          {!readOnly ? <button type="button" onClick={() => backgroundInput.current?.click()}><Upload size={14} />{t("Background")}</button> : null}
          {activeOverride?.backgroundImage && !readOnly ? <button type="button" onClick={() => activePage && updatePage(activePage.id, { backgroundImage: undefined })}><X size={14} />{t("Remove")}</button> : null}
          <input ref={backgroundInput} hidden type="file" accept="image/*" onChange={(event) => { void addImage(event.target.files?.[0], true); event.currentTarget.value = ""; }} />
        </div>
      </header>
      <div className={styles.pageStack}>
        {pages.map((page, pageIndex) => {
          const override = pageOverride(presentation, page.id);
          return (
            <section
              key={page.id}
              className={styles.editorPage}
              data-active={page.id === activePage?.id || undefined}
              aria-label={t("{title} page", { title: page.title })}
              style={{
                backgroundColor: override?.background ?? presentation.pageBackground,
                backgroundImage: override?.backgroundImage ? `url(${JSON.stringify(override.backgroundImage).slice(1, -1)})` : undefined,
              }}
              onClick={() => setActivePageId(page.id)}
            >
              <div className={styles.smartPage}>
                <QuotationDocumentPage
                  quote={quote} brand={neutralBrand} customerName={customerName} page={page}
                  pageCount={pages.length} pageIndex={pageIndex} selectedItem=""
                  onSelect={onEditItems} onAdd={onEditItems} preview={readOnly}
                />
              </div>
              {(override?.elements ?? []).map((element) => (
                <div key={element.id} className={styles.editableElement} style={{ left: element.x, top: element.y, width: element.width, height: element.height }}>
                  {element.type === "image" ? (
                    element.src ? <img alt={t("Quotation artwork")} src={element.src} /> : null
                  ) : readOnly ? (
                    <span style={{ color: element.color ?? presentation.textColor, fontSize: element.fontSize ?? 28, textAlign: element.align ?? "left" }}>{element.text}</span>
                  ) : (
                    <textarea aria-label={t("Custom quotation text")} value={element.text ?? ""} style={{ color: element.color ?? presentation.textColor, fontSize: element.fontSize ?? 28, textAlign: element.align ?? "left" }} onChange={(event) => updateElement(page.id, element.id, { text: event.target.value })} />
                  )}
                  {!readOnly ? <button type="button" aria-label={t("Remove custom element")} onClick={(event) => { event.stopPropagation(); updatePage(page.id, { elements: (override?.elements ?? []).filter((candidate) => candidate.id !== element.id) }); }}><Trash2 size={13} /></button> : null}
                </div>
              ))}
            </section>
          );
        })}
      </div>
      <footer className={styles.status}><span>{t("{count} client-facing pages", { count: pages.length })}</span><span role="status">{notice || t("Pages flow in the same order your client will read them")}</span></footer>
    </section>
  );
}

/** Static renderer used by preview, client portal and Print / save PDF. */
export function QuotationCanvasPreview({ quote, brand, customerName }: {
  quote: Quote;
  brand?: PortalBrand;
  customerName: string;
}) {
  const t = useT();
  const neutralBrand = brand ? { ...brand, primaryColor: "#E4E3DE", accentColor: "#000000" } : brand;
  const presentation = useMemo(
    () => safePresentation(quote),
    [quote.presentation],
  );
  const systemPages = quotationPages(quote, t);
  const pages: CanvasPage[] = systemPages;
  return (
    <div className={styles.previewStack} aria-label={t("Quotation page preview")}>
      {pages.map((page, index) => {
        const override = pageOverride(presentation, page.id);
        return (
          <section
            className={styles.staticPage}
            key={page.id}
            aria-label={t("{title} page", { title: page.title })}
            style={{
              minHeight: page.kind === "custom" ? 1329 : 1150,
              backgroundColor: override?.background ?? presentation.pageBackground,
              backgroundImage: override?.backgroundImage ? `url(${JSON.stringify(override.backgroundImage).slice(1, -1)})` : undefined,
            }}
          >
            <div className={styles.smartPage}>
              <QuotationDocumentPage
                quote={quote}
                brand={neutralBrand}
                customerName={customerName}
                page={page}
                pageCount={pages.length}
                pageIndex={index}
                selectedItem=""
                onSelect={() => undefined}
                onAdd={() => undefined}
                preview
              />
            </div>
            {(override?.elements ?? []).map((element) => (
              <div
                className={styles.staticElement}
                key={element.id}
                style={{ left: element.x, top: element.y, width: element.width, height: element.height, fontFamily: page.kind === "custom" ? "Arial, sans-serif" : undefined, lineHeight: page.kind === "custom" ? 1.25 : undefined }}
              >
                {element.type === "image" ? (
                  element.src ? <img alt={t("Quotation artwork")} src={element.src} /> : null
                ) : (
                  <div style={{ color: element.color ?? presentation.textColor, fontSize: element.fontSize ?? 28, textAlign: element.align ?? "left" }}>{element.richText?<QuoteRichText node={element.richText}/>:element.text}</div>
                )}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Free editor using the canvas dependency already shipped with the app. */
export function QuotationFreeformCanvas(props: React.ComponentProps<typeof CanvasWorkspace>) {
  return <ReactFlowProvider><CanvasWorkspace {...props} /></ReactFlowProvider>;
}

function CanvasWorkspace({ quote, brand, customerName, readOnly = false, onChange, onEditItems, toolbarStart, toolbarEnd, pageId, hidePages = false }: {
  pageId?: string;
  hidePages?: boolean;
  quote: Quote;
  brand?: PortalBrand;
  customerName: string;
  readOnly?: boolean;
  onChange: (next: Quote) => void;
  onEditItems: () => void;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
}) {
  const t = useT();
  const presentation = useMemo(
    () => safePresentation(quote),
    [quote.presentation],
  );
  const systemPages = useMemo(() => quotationPages(quote, t), [quote, t]);
  const pages = useMemo<CanvasPage[]>(() => systemPages, [systemPages]);
  const [activePageId, setActivePageId] = useState(pages[0]?.id ?? "cover");
  const [selectedId, setSelectedId] = useState("");
  const [draftNodes, setDraftNodes] = useState<CanvasNode[]>([]);
  const [pageMenu, setPageMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const backgroundInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const flowElement = useRef<HTMLDivElement>(null);
  const activePage = pages.find((page) => page.id === (pageId ?? activePageId)) ?? pages[0];
  const activeOverride = activePage ? pageOverride(presentation, activePage.id) : undefined;
  const selected = activeOverride?.elements.find((element) => element.id === selectedId);
  const pageSelected = selectedId === "__page__";

  useEffect(() => {
    if (!pages.some((page) => page.id === activePageId)) setActivePageId(pages[0]?.id ?? "cover");
  }, [activePageId, pages]);

  function commit(nextPresentation: QuotePresentation) {
    if (readOnly) return;
    onChange({ ...quote, presentation: nextPresentation });
  }

  function updatePage(id: string, patch: Partial<QuoteCanvasPage>) {
    const existing = pageOverride(presentation, id);
    const currentPage = pages.find((page) => page.id === id);
    const next: QuoteCanvasPage = {
      id,
      title: currentPage?.title,
      background: presentation.pageBackground,
      elements: [],
      ...existing,
      ...patch,
    };
    commit({
      ...presentation,
      pages: [...presentation.pages.filter((page) => page.id !== id), next],
    });
  }

  function updateElement(id: string, patch: Partial<QuoteCanvasElement>) {
    if (!activePage) return;
    const elements = (activeOverride?.elements ?? []).map((element) =>
      element.id === id ? { ...element, ...patch } : element,
    );
    updatePage(activePage.id, { elements });
  }

  const nodes = useMemo<CanvasNode[]>(() => {
    if (!activePage) return [];
    const override = pageOverride(presentation, activePage.id);
    const content = (
      <div className="nodrag nopan">
        <QuotationDocumentPage
        quote={quote}
        brand={brand}
        customerName={customerName}
        page={activePage}
        pageCount={pages.length}
        pageIndex={pages.findIndex((page) => page.id === activePage.id)}
        selectedItem=""
        onSelect={() => onEditItems()}
        onAdd={() => onEditItems()}
        preview={readOnly}
        />
      </div>
    );
    const pageNode: PageNode = {
      id: "__page__",
      type: "quotePage",
      position: { x: 0, y: 0 },
      data: {
        background: override?.background ?? presentation.pageBackground,
        backgroundImage: override?.backgroundImage,
        content,
        textColor: presentation.textColor,
        accentColor: presentation.accentColor,
      },
      draggable: false,
      selectable: true,
      selected: pageSelected,
      focusable: false,
      style: { width: PAGE_WIDTH, height: PAGE_HEIGHT, zIndex: 0 },
    };
    const elementNodes: ElementNode[] = (override?.elements ?? []).map((element) => ({
      id: element.id,
      type: "quoteElement",
      position: { x: element.x, y: element.y },
      data: {
        element,
        readOnly,
        onResize: (id, size) => updateElement(id, {
          x: Math.max(0, size.x),
          y: Math.max(0, size.y),
          width: Math.min(PAGE_WIDTH, size.width),
          height: Math.min(PAGE_HEIGHT, size.height),
        }),
      },
      draggable: !readOnly,
      selectable: true,
      selected: element.id === selectedId,
      extent: [[0, 0], [PAGE_WIDTH, PAGE_HEIGHT]],
      style: { width: element.width, height: element.height, zIndex: 10 },
    }));
    return [pageNode, ...elementNodes];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, brand, customerName, onEditItems, pageSelected, pages, presentation, quote, readOnly, selectedId]);

  useEffect(() => setDraftNodes(nodes), [nodes]);

  function addText() {
    if (!activePage || readOnly) return;
    const element: QuoteCanvasElement = {
      id: crypto.randomUUID(),
      type: "text",
      x: 110,
      y: 120,
      width: 380,
      height: 90,
      text: t("Add your message"),
      color: presentation.textColor,
      fontSize: 30,
      align: "left",
    };
    updatePage(activePage.id, { elements: [...(activeOverride?.elements ?? []), element] });
    setSelectedId(element.id);
  }

  async function addImage(file?: File) {
    if (!activePage || !file || readOnly) return;
    try {
      const src = await fileData(file, t);
      const element: QuoteCanvasElement = {
        id: crypto.randomUUID(),
        type: "image",
        x: 120,
        y: 180,
        width: 480,
        height: 320,
        src,
      };
      updatePage(activePage.id, { elements: [...(activeOverride?.elements ?? []), element] });
      setSelectedId(element.id);
      setNotice(t("Image added. Drag or resize it on the page."));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("The image could not be added."));
    }
  }

  async function setBackground(file?: File) {
    if (!activePage || !file || readOnly) return;
    try {
      updatePage(activePage.id, { backgroundImage: await fileData(file, t) });
      setNotice(t("Page background updated."));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("The background could not be added."));
    }
  }

  return (
    <section className={styles.workspace} aria-label={t("Quotation page designer")} data-inspector={Boolean(selected) || pageSelected || undefined} data-standalone={hidePages || undefined}>
      {!hidePages && <aside className={styles.pages} aria-label={t("Quotation pages")}>
        <div className={styles.pageList}>
          {pages.map((page, index) => {
            const override = pageOverride(presentation, page.id);
            return (
              <button
                type="button"
                key={page.id}
                title={page.title}
                aria-current={page.id === activePage?.id ? "page" : undefined}
                onClick={() => { setActivePageId(page.id); setSelectedId(""); }}
              >
                <span className={styles.thumbnail} style={{ background: override?.background ?? presentation.pageBackground }}>
                  {override?.backgroundImage ? <i style={{ backgroundImage: `url(${JSON.stringify(override.backgroundImage).slice(1, -1)})` }} /> : null}
                  <b>{index + 1}</b>
                </span>
                <span>{page.title}</span>
              </button>
            );
          })}
        </div>
      </aside>}

      <div className={styles.stage}>
        <header className={styles.toolbar}>
          <div>
            {toolbarStart}
            {!readOnly ? <button type="button" className={styles.addItem} onClick={onEditItems}><Plus size={15} />{t("Add item")}</button> : null}
            {!readOnly ? <button type="button" onClick={addText}><Type size={15} />{t("Text")}</button> : null}
            {!readOnly ? <button type="button" onClick={() => imageInput.current?.click()}><ImagePlus size={15} />{t("Image")}</button> : null}
            <input ref={imageInput} hidden type="file" accept="image/*" onChange={(event) => { void addImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          </div>
          <div className={styles.pageTools}>
            {toolbarEnd}
            <button type="button" aria-expanded={pageMenu} onClick={() => setPageMenu(!pageMenu)}><Palette size={15} />{t("Page")}</button>
            {pageMenu ? (
              <div className={styles.pagePopover}>
                <label>{t("Background")}{" "}<input type="color" value={activeOverride?.background ?? presentation.pageBackground} disabled={readOnly} onChange={(event) => activePage && updatePage(activePage.id, { background: event.target.value })} /></label>
                {!readOnly ? <button type="button" onClick={() => backgroundInput.current?.click()}><Upload size={14} />{t("Upload background")}</button> : null}
                {activeOverride?.backgroundImage && !readOnly ? <button type="button" onClick={() => activePage && updatePage(activePage.id, { backgroundImage: undefined })}><X size={14} />{t("Remove image")}</button> : null}
                <input ref={backgroundInput} hidden type="file" accept="image/*" onChange={(event) => { void setBackground(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              </div>
            ) : null}
          </div>
        </header>
        <div className={styles.flow} ref={flowElement}>
          <ReactFlow<CanvasNode>
            key={activePage?.id}
            nodes={draftNodes}
            edges={[]}
            nodeTypes={nodeTypes}
            minZoom={0.3}
            maxZoom={3}
            defaultViewport={{ x: 0, y: 24, zoom: 0.68 }}
            onInit={(instance) => {
              void instance.fitView({ padding: 0.12 });
            }}
            nodesConnectable={false}
            deleteKeyCode={null}
            panOnScroll
            selectionOnDrag={false}
            nodeExtent={[[-20, -20], [PAGE_WIDTH + 20, PAGE_HEIGHT + 20]]}
            onNodesChange={(changes: NodeChange<CanvasNode>[]) => setDraftNodes((current) => applyNodeChanges(changes, current))}
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId("")}
            onNodeDragStop={(_event, node) => {
              if (node.id !== "__page__") updateElement(node.id, {
                x: Math.max(0, Math.min(PAGE_WIDTH - (node.measured?.width ?? 40), node.position.x)),
                y: Math.max(0, Math.min(PAGE_HEIGHT - (node.measured?.height ?? 40), node.position.y)),
              });
            }}
          >
            <Background gap={22} size={1} color="var(--wd-color-structural-divider)" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
        <footer className={styles.status}><span>{activePage?.title}</span><span role="status">{notice || t("Drag to position · Select to edit")}</span></footer>
      </div>

      {selected || pageSelected ? (
        <aside className={styles.inspector} aria-label={t("Selected element properties")}>
          <header><strong>{t(pageSelected ? "Page" : selected?.type === "text" ? "Text" : "Image")}</strong><button type="button" aria-label={t("Close properties")} onClick={() => setSelectedId("")}><X size={15} /></button></header>
          {pageSelected ? (
            <div className={styles.inspectorBody}>
              <label>{t("Background")}<input type="color" value={activeOverride?.background ?? presentation.pageBackground} disabled={readOnly} onChange={(event) => activePage && updatePage(activePage.id, { background: event.target.value })} /></label>
              {!readOnly ? <button type="button" onClick={() => backgroundInput.current?.click()}><Upload size={14} />{t("Background image")}</button> : null}
              {activePage?.kind === "room" ? <button type="button" className={styles.editItems} onClick={onEditItems}><Plus size={14} />{t("Edit quotation items")}</button> : null}
              <p>{t("Smart content is synced from the quotation. Add free text and images from the top toolbar.")}</p>
            </div>
          ) : selected?.type === "text" ? (
            <div className={styles.inspectorBody}>
              <label>{t("Content")}<textarea value={selected.text ?? ""} disabled={readOnly} onChange={(event) => updateElement(selected.id, { text: event.target.value })} /></label>
              <label>{t("Size")}<input type="number" min="10" max="96" value={selected.fontSize ?? 28} disabled={readOnly} onChange={(event) => updateElement(selected.id, { fontSize: Math.max(10, Math.min(96, Number(event.target.value) || 10)) })} /></label>
              <label>{t("Colour")}<input type="color" value={selected.color ?? presentation.textColor} disabled={readOnly} onChange={(event) => updateElement(selected.id, { color: event.target.value })} /></label>
              <div className={styles.align} aria-label={t("Text alignment")}>
                {(["left", "center", "right"] as const).map((align) => {
                  const Icon = align === "left" ? AlignLeft : align === "center" ? AlignCenter : AlignRight;
                  return <button type="button" key={align} aria-label={t(align === "left" ? "Align left" : align === "center" ? "Align center" : "Align right")} aria-pressed={(selected.align ?? "left") === align} disabled={readOnly} onClick={() => updateElement(selected.id, { align })}><Icon size={15} /></button>;
                })}
              </div>
            </div>
          ) : (
            <div className={styles.inspectorBody}><p>{t("Move and resize the image directly on the page.")}</p><button type="button" disabled={readOnly} onClick={() => imageInput.current?.click()}><Upload size={14} />{t("Add another image")}</button></div>
          )}
          {selected ? <div className={styles.inspectorBody}>
            {([['x', tKey('Horizontal position')], ['y', tKey('Vertical position')], ['width', tKey('Width')], ['height', tKey('Height')]] as const).map(([key, label]) => <label key={key}>{t(label)}<input type="number" min={key === 'width' || key === 'height' ? 24 : 0} max={key === 'x' || key === 'width' ? PAGE_WIDTH : PAGE_HEIGHT} value={Math.round(selected[key])} disabled={readOnly} onChange={event => updateElement(selected.id, { [key]: Math.max(key === 'width' || key === 'height' ? 24 : 0, Math.min(key === 'x' || key === 'width' ? PAGE_WIDTH : PAGE_HEIGHT, Number(event.target.value) || 0)) })}/></label>)}
          </div> : null}
          {selected && !readOnly ? <button type="button" className={styles.deleteElement} onClick={() => { updatePage(activePage!.id, { elements: (activeOverride?.elements ?? []).filter((element) => element.id !== selected.id) }); setSelectedId(""); }}><Trash2 size={14} />{t("Delete element")}</button> : null}
        </aside>
      ) : null}
    </section>
  );
}
