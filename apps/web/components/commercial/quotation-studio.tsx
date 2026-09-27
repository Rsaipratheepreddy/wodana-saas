"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { useRef, useState } from "react";
import {
  BookCopy,
  ChevronRight,
  Eye,
  Link2,
  LocateFixed,
  MoreHorizontal,
  Redo2,
  Search,
  Sparkles,
  Settings2,
  Undo2,
  X,
} from "lucide-react";
import type { CommercialState, Quote } from "@/lib/commercial/types";
import { money, quoteTotals, statusLabel } from "@/lib/commercial/client";
import { translateKnown } from "@/lib/i18n/keys";
import { roomNames } from "@/lib/commercial/room-builder";
import {
  addQuotationSuggestions,
  type QuotationAnalysis,
} from "@/lib/commercial/quotation-assist";
import { Checkbox, ControlledModalDialog, SelectField, useConfirmationDialog, useDesignSystem } from "@/design-system";
import type { QuotationEditor } from "./quotation-editor";
import { CatalogOptionsProvider } from "./catalog-options-cache";
import { QuotationTemplateLibrary } from "./quotation-sidebar-tools";
import { QuotationDocument } from "./quotation-document";
import { QuotationBaseSettings } from "./quotation-base-settings";
import { QuotationSheet } from "./quotation-sheet";
import { QuotationRoomDialog } from "./quotation-room-dialog";
import { QuotationAiPanel } from "./quotation-ai-panel";
import { QuotationPulse, QuotationQuickAdd, pulseFilterPredicate, type PulseFilter } from "./quotation-pulse";
import { QuotationCanvas, QuotationCanvasPreview } from "./quotation-canvas";
import { QuotationTextCell } from "./quotation-text-cell";
import { applyQuoteCatalogMedia } from "@/lib/commercial/quotation-table";
import s from "./quotation-workspace.module.css";
type Props = React.ComponentProps<typeof QuotationEditor> & {
  state: CommercialState;
  customerName: string;
  onSave: () => Promise<boolean>;
  onImportScope: () => void;
  initialMode?: "items" | "design";
};
export function QuotationStudio(props: Props) {
  return (
    <CatalogOptionsProvider
      key={props.workspaceId + "/" + props.caseId}
      workspaceId={props.workspaceId}
      caseId={props.caseId}
    >
      <Studio {...props} />
    </CatalogOptionsProvider>
  );
}
function Studio({
  quote,
  onChange,
  readOnly,
  state,
  customerName,
  requests,
  workspaceId,
  caseId,
  onSave,
  onImportScope,
  costing,
  initialMode = "items",
}: Props) {
  const t = useT();
  const { locale } = useDesignSystem();
  const [preview, setPreview] = useState(false),
    [settings, setSettings] = useState(false),
    [templates, setTemplates] = useState(false),
    [requestDialog, setRequestDialog] = useState(false),
    [search, setSearch] = useState(""),
    [mode, setMode] = useState<"items" | "design">(initialMode),
    [pulseFilter, setPulseFilter] = useState<PulseFilter>("all"),
    [itemDialog, setItemDialog] = useState(false);
  const [analysis, setAnalysis] = useState<QuotationAnalysis | null>(null);
  const [review, setReview] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [aiRoom, setAiRoom] = useState("");
  const [aiNotice, setAiNotice] = useState("");
  const [aiAdding, setAiAdding] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState("");
  const editSession = useRef<Element | null>(null);
  const aiPanel = useRef<HTMLElement>(null);
  const aiToggle = useRef<HTMLButtonElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const [past, setPast] = useState<Quote[]>([]),
    [future, setFuture] = useState<Quote[]>([]),
    [revision, setRevision] = useState(state.data.revision);
  const current = revision === state.data.revision,
    rooms = roomNames(quote),
    totals = quoteTotals(quote),
    availableRequests = requests.filter(
      (request) =>
        !["resolved", "declined", "withdrawn"].includes(request.status) ||
        quote.requestIds.includes(request.id),
    ),
    linkedRequests = availableRequests.filter((request) =>
      quote.requestIds.includes(request.id),
    );
  const change = (next: Quote) => {
    if (readOnly || JSON.stringify(next) === JSON.stringify(quote)) return;
    const active = document.activeElement;
    const editing =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement;
    if (!current || !editing || editSession.current !== active) {
      setPast((previous) => [...(current ? previous.slice(-19) : []), quote]);
    }
    editSession.current = editing ? active : null;
    setFuture([]);
    setRevision(state.data.revision);
    onChange(next);
  };
  const patch = (next: Partial<Quote>) => change({ ...quote, ...next });
  return (
    <div
      className={s.workspace}
      onBlur={() => {
        editSession.current = null;
      }}
    >
      {mode === "items" ? <header className={s.quoteHeader} aria-label={t("Quotation header")}>
        <label className={s.quoteTitle}>
          {t("Quotation title")}<QuotationTextCell
            label={t("Quotation title")}
            value={quote.title}
            required
            max={240}
            readOnly={readOnly}
            onChange={(title) => patch({ title })}
          />
        </label>
        <label>
          {t("Prepared for")}<QuotationTextCell
            label={t("Prepared for")}
            value={quote.cover?.preparedFor ?? customerName}
            max={160}
            readOnly={readOnly}
            onChange={(preparedFor) =>
              patch({
                cover: {
                  location: "",
                  subtitle: "",
                  ...quote.cover,
                  preparedFor,
                },
              })
            }
          />
        </label>
        <label className={s.locationField}>
          {t("Location")}<span className={s.locationInput}>
            <QuotationTextCell
              label={t("Quotation location")}
              value={quote.cover?.location ?? ""}
              placeholder={t("Project location")}
              max={300}
              readOnly={readOnly}
              onChange={(location) =>
                patch({
                  cover: {
                    preparedFor: customerName,
                    subtitle: "",
                    ...quote.cover,
                    location,
                  },
                })
              }
            />
            {!readOnly ? <button
              type="button"
              aria-label={t("Use current location")}
              title={locationNotice || t("Use current location")}
              disabled={locating}
              onClick={() => {
                if (!navigator.geolocation) {
                  setLocationNotice(t("Location is not available in this browser."));
                  return;
                }
                setLocating(true);
                setLocationNotice("");
                navigator.geolocation.getCurrentPosition(
                  ({ coords }) => {
                    const latitude = Number(coords.latitude.toFixed(6));
                    const longitude = Number(coords.longitude.toFixed(6));
                    patch({
                      cover: {
                        preparedFor: customerName,
                        subtitle: "",
                        ...quote.cover,
                        location: quote.cover?.location || `${latitude}, ${longitude}`,
                        coordinates: { latitude, longitude, accuracy: Math.round(coords.accuracy) },
                      },
                    });
                    setLocationNotice(t("Pinned {latitude}, {longitude}", { latitude, longitude }));
                    setLocating(false);
                  },
                  (error) => {
                    setLocationNotice(t(error.code === error.PERMISSION_DENIED ? "Location permission was not allowed." : "Current location could not be detected."));
                    setLocating(false);
                  },
                  { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
                );
              }}
            ><LocateFixed size={15} /></button> : null}
          </span>
        </label>
        <label>
          {t("Valid until")}<input
            aria-label={t("Quotation valid until")}
            type="date"
            value={quote.validUntil}
            readOnly={readOnly}
            onChange={(e) => {
              if (e.target.value) patch({ validUntil: e.target.value });
            }}
          />
        </label>
        <span className={s.currencyLabel}>
          {quote.currency}
          <small>{t("All prices")}</small>
        </span>
      </header> : null}
      {mode === "items" ? <div className={s.viewBar}>
        <div className={s.viewSwitch} aria-label={t("Quotation workspace view")}>
          <button type="button" aria-pressed={false} onClick={() => { setMode("design"); setAiOpen(false); }}>{t("Design")}</button>
          <button type="button" aria-pressed onClick={() => setMode("items")}>{t("Items & pricing")}</button>
        </div>
        <span>{t("Build scope and pricing")}</span>
      </div> : null}
      {mode === "items" ? <QuotationPulse canViewCosts={Boolean(costing)} filter={pulseFilter} onFilter={setPulseFilter} quote={quote} /> : null}
      {mode === "design" ? (
        <QuotationCanvas
          quote={quote}
          brand={quote.brand ?? state.portalBrand}
          customerName={customerName}
          readOnly={readOnly}
          onChange={change}
          onEditItems={() => setItemDialog(true)}
          toolbarStart={<div className={s.viewSwitch} aria-label={t("Quotation workspace view")}>
            <button type="button" aria-pressed onClick={() => { setMode("design"); setAiOpen(false); }}>{t("Design")}</button>
            <button type="button" aria-pressed={false} onClick={() => setMode("items")}>{t("Items & pricing")}</button>
          </div>}
          toolbarEnd={<button type="button" className={s.previewButton} onClick={() => setPreview(true)}><Eye size={15} />{t("Preview")}</button>}
        />
      ) : <div className={s.split} data-ai-open={aiOpen}>
        <section className={s.roomPanel} aria-label={t("Quotation room builder")}>
          <div className={s.roomPanelScroll}>
            <div className={s.roomHeading}>
              <div>
                <h2>{t("Quotation builder")}</h2>
                <p>
                  {t("{areas} areas · {items} items · {currency}", { areas: rooms.length, items: quote.lines.length, currency: quote.currency })}
                </p>
              </div>
              <div className={s.roomHeadingActions}>
                <label className={s.search}>
                  <Search size={14} />
                  <input
                    type="search"
                    aria-label={t("Search quotation rooms")}
                    placeholder={t("Find room, item or material…")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className={s.toolbarGroup}>
                  <button
                    className={s.iconButton}
                    title={t("Undo")}
                    aria-label={t("Undo")}
                    disabled={readOnly || !current || !past.length}
                    onClick={() => {
                      const previous = past.at(-1);
                      if (previous) {
                        editSession.current = null;
                        setPast(past.slice(0, -1));
                        setFuture([...future, quote]);
                        onChange(previous);
                      }
                    }}
                  >
                    <Undo2 size={15} />
                  </button>
                  <button
                    className={s.iconButton}
                    title={t("Redo")}
                    aria-label={t("Redo")}
                    disabled={readOnly || !current || !future.length}
                    onClick={() => {
                      const next = future.at(-1);
                      if (next) {
                        editSession.current = null;
                        setFuture(future.slice(0, -1));
                        setPast([...past, quote]);
                        onChange(next);
                      }
                    }}
                  >
                    <Redo2 size={15} />
                  </button>
                </div>
                <details className={s.toolsMenu}>
                  <summary><MoreHorizontal size={16}/><span>{t("More")}</span></summary>
                  <div>
                    <button aria-label={t("Base settings")} onClick={() => setSettings(true)}><Settings2 size={15}/><span>{t("Document settings")}</span></button>
                    <button aria-label={t("Templates")} onClick={() => setTemplates(true)}><BookCopy size={15}/><span>{t("Templates")}</span></button>
                    <button aria-label={t("Link change requests")} onClick={() => setRequestDialog(true)}><Link2 size={15}/><span>{t("Change requests")}{linkedRequests.length ? ` · ${linkedRequests.length}` : ""}</span></button>
                  </div>
                </details>
                <button
                  className={s.previewButton}
                  aria-label={t("Preview quotation")}
                  onClick={() => setPreview(true)}
                >
                  <Eye size={16} />
                  <span>{t("Preview")}</span>
                </button>
                <button
                  className={s.aiJump}
                  ref={aiToggle}
                  aria-expanded={aiOpen}
                  aria-controls="quotation-ai-panel"
                  onClick={() => {
                    setAiOpen(!aiOpen);
                    if (!aiOpen)
                      requestAnimationFrame(() => {
                        if (window.innerWidth <= 760)
                          aiPanel.current?.scrollIntoView({ block: "start" });
                      });
                  }}
                >
                  <Sparkles size={15} />
                  {t("AI assistant")}</button>
              </div>
            </div>
            {readOnly && (
              <p className={s.notice}>
                {t("This version is read-only. Create a revision to edit it.")}</p>
            )}
            {aiNotice && (
              <p role="status" className={s.hint}>
                {aiNotice}
              </p>
            )}
            {quote.kind === "variation" && !readOnly && (
              <div className={s.variationField}>
                <SelectField
                  label={t("Change order effect")}
                  aria-label={t("Variation effect")}
                  accent="neutral"
                  selectedKey={quote.direction ?? "addition"}
                  items={[
                    { id: "addition", label: t("Additional work") },
                    {
                      id: "deduction",
                      label: t("Scope deduction / client credit"),
                    },
                  ]}
                  onSelectionChange={(key) => {
                    const direction =
                      key === "deduction" ? "deduction" : "addition";
                    const applyDirection = () => patch({ direction, lines: [], rooms: [], paymentTerms: direction === "deduction" ? [] : quote.paymentTerms });
                    if (quote.lines.length) {
                      requestConfirmation({ title: t("Change variation effect?"), body: t("Changing between additional work and a deduction removes the current variation items so the commercial basis stays consistent."), confirmLabel: t("Change and clear items"), onConfirm: applyDirection });
                      return;
                    }
                    applyDirection();
                  }}
                />
                <p>
                  {linkedRequests.length
                    ? t("Linked to {requests}", { requests: linkedRequests.map((request) => `CR-${String(request.number).padStart(3, "0")}`).join(", ") })
                    : t("Link the change request this quotation resolves.")}
                </p>
              </div>
            )}
            {quote.direction === "deduction" && !readOnly && (
              <div className={s.variationField}>
                <SelectField
                  label={t("Accepted contract item")}
                  aria-label={t("Accepted contract item")}
                  accent="neutral"
                  selectedKey={null}
                  placeholder={t("Choose an item to deduct…")}
                  items={state.data.quotes
                    .filter(
                      (candidate) =>
                        candidate.status === "accepted" &&
                        candidate.direction !== "deduction",
                    )
                    .flatMap((candidate) => candidate.lines)
                    .map((line) => ({
                      id: line.id,
                      label: `${line.room} · ${line.title}`,
                    }))}
                  onSelectionChange={(key) => {
                    const line = state.data.quotes
                      .filter(
                        (candidate) =>
                          candidate.status === "accepted" &&
                          candidate.direction !== "deduction",
                      )
                      .flatMap((candidate) => candidate.lines)
                      .find((candidate) => candidate.id === key);
                    if (line && quote.lines.length < 300)
                      patch({
                        lines: [
                          ...quote.lines,
                          {
                            ...line,
                            id: crypto.randomUUID(),
                            deductsLineId: line.id,
                            scopeId: undefined,
                            scopeVersion: undefined,
                            specificationVersion: undefined,
                            catalogLinks: undefined,
                          },
                        ],
                      });
                  }}
                />
              </div>
            )}
            {!readOnly && quote.direction !== "deduction" ? <QuotationQuickAdd disabled={quote.lines.length >= 300} onAdd={(line) => patch({ lines: [...quote.lines, line] })} quote={quote} rooms={rooms} /> : null}
            <QuotationSheet
              quote={quote}
              onChange={change}
              readOnly={readOnly}
              workspaceId={workspaceId}
              caseId={caseId}
              canOverridePrice={Boolean(state.canOverridePrice)}
              canViewCosts={Boolean(costing)}
              search={search}
              lineFilter={pulseFilterPredicate(pulseFilter)}
              brand={quote.brand ?? state.portalBrand}
            />
            {!readOnly && quote.direction !== "deduction" && (
              <button className={s.importButton} onClick={onImportScope}>
                {t("Import unconfirmed requirements")}<ChevronRight size={13} />
              </button>
            )}
          </div>
          <footer className={s.totalBar}>
            <span>
              {t(pulseFilter !== "all" ? "{areas} areas · {items} items · filtered" : "{areas} areas · {items} items", { areas: rooms.length, items: quote.lines.length })}
            </span>
            <div>
              <small>{t("Quotation total")}</small>
              <strong>{money(totals.total, quote.currency, locale)}</strong>
            </div>
          </footer>
        </section>
        <aside
          ref={aiPanel}
          id="quotation-ai-panel"
          hidden={!aiOpen}
          className={s.chatPanel}
          aria-label={t("AI quotation assistant")}
        >
          <div className={s.aiPanelHeading}>
            <strong>{t("Quotation assistant")}</strong>
            <button
              aria-label={t("Close AI assistant")}
              onClick={() => {
                setAiOpen(false);
                aiToggle.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          </div>
          {rooms.length > 0 && (
            <div className={s.aiContext}>
              <SelectField
                label={t("Use AI for")}
                aria-label={t("AI room context")}
                accent="neutral"
                selectedKey={rooms.includes(aiRoom) ? `room:${aiRoom}` : "all"}
                items={[
                  { id: "all", label: t("All rooms / sections") },
                  ...rooms.map((room) => ({ id: `room:${room}`, label: room })),
                ]}
                onSelectionChange={(key) =>
                  setAiRoom(
                    String(key).startsWith("room:") ? String(key).slice(5) : "",
                  )
                }
              />
            </div>
          )}
          <QuotationAiPanel
            quote={quote}
            workspaceId={workspaceId}
            caseId={caseId}
            disabled={Boolean(readOnly || quote.direction === "deduction")}
            selectedRooms={rooms.includes(aiRoom) ? [aiRoom] : []}
            onProposal={(value) => {
              setAnalysis(value);
              setSelectedSuggestions(
                value.rooms.flatMap((room) =>
                  room.items.map((_, index) => `${room.id}:${index}`),
                ),
              );
              setAiNotice("");
            }}
            onReview={() => setReview(true)}
          />
        </aside>
      </div>}
      <ControlledModalDialog
        title={t("Review AI suggestions")}
        size="lg"
        isOpen={review}
        onOpenChange={setReview}
      >
        <div className={s.settings}>
          <p className={s.hint}>
            {t("Choose items to add. Existing items, quantities, prices and notes will not be replaced. New items start at quantity 1 and rate 0 for you to price.")}</p>
          <div className={s.aiSuggestions}>
            {analysis?.rooms.map((room) => (
              <fieldset key={room.id}>
                <legend>{room.name}</legend>
                <p>{room.reason}</p>
                {room.items.map((item, index) => {
                  const key = `${room.id}:${index}`;
                  return (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={selectedSuggestions.includes(key)}
                        disabled={readOnly}
                        onChange={(e) =>
                          setSelectedSuggestions((current) =>
                            e.target.checked
                              ? [...current, key]
                              : current.filter((id) => id !== key),
                          )
                        }
                      />
                      <span>
                        <strong>
                          {item.work.name}
                          {item.variant ? ` · ${item.variant.name}` : ""}
                        </strong>
                        <small>
                          {item.materials
                            .map((material) => material.name)
                            .join(" · ") || item.reason}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ))}
          </div>
          <div className={s.proposalFooter}>
            <button className={s.linkButton} onClick={() => setReview(false)}>
              {t("Cancel")}</button>
            <button
              className={s.primary}
              disabled={readOnly || aiAdding || !selectedSuggestions.length}
              onClick={async () => {
                if (!analysis) return;
                setAiAdding(true);
                const proposed = addQuotationSuggestions(
                  quote,
                  analysis.rooms.map((room) => ({
                    ...room,
                    items: room.items.filter((_, index) =>
                      selectedSuggestions.includes(`${room.id}:${index}`),
                    ),
                  })),
                );
                const previousIds = new Set(quote.lines.map((line) => line.id));
                const next = await applyQuoteCatalogMedia(
                  workspaceId,
                  proposed,
                  new Set(proposed.lines.filter((line) => !previousIds.has(line.id)).map((line) => line.id)),
                );
                const count = next.lines.length - quote.lines.length;
                change(next);
                setReview(false);
                setAiAdding(false);
                setAiNotice(
                  count
                    ? t(count === 1 ? "{count} AI-suggested item added. Check quantities and enter prices, then save." : "{count} AI-suggested items added. Check quantities and enter prices, then save.", { count })
                    : t("No new items added. These items already exist or the quotation limit has been reached."),
                );
              }}
            >
              {t(aiAdding ? "Preparing items…" : "Add selected items")}
            </button>
          </div>
        </div>
      </ControlledModalDialog>
      <ControlledModalDialog
        title={t("Linked change requests")}
        description={
          t(quote.kind === "variation"
            ? "Connect this change-order quotation to the request it prices. Client acceptance will update the linked request."
            : "Connect requests that this quotation addresses. Links are kept through review and client acceptance.")
        }
        isOpen={requestDialog}
        onOpenChange={setRequestDialog}
      >
        <div className={s.requestList}>
          {availableRequests.map((request) => (
            <Checkbox
              key={request.id}
              isSelected={quote.requestIds.includes(request.id)}
              isDisabled={readOnly}
              onChange={(selected) =>
                patch({
                  requestIds: selected
                    ? [...new Set([...quote.requestIds, request.id])]
                    : quote.requestIds.filter((id) => id !== request.id),
                })
              }
            >
              <span>
                <strong>
                  CR-{String(request.number).padStart(3, "0")} · {request.title}
                </strong>
                <small>{statusLabel[request.status] ? translateKnown(t, statusLabel[request.status]) : request.status.replaceAll("_", " ")}</small>
              </span>
            </Checkbox>
          ))}
          {!availableRequests.length && (
            <p className={s.hint}>
              {t("No open change requests. New requests will appear here automatically.")}</p>
          )}
        </div>
      </ControlledModalDialog>
      <ControlledModalDialog
        title={t("Quotation preview")}
        size="lg"
        isOpen={preview}
        onOpenChange={setPreview}
      >
        <div className={s.previewDialog}>
          <article aria-label={t("Quotation document")}>
            <QuotationCanvasPreview
              quote={quote}
              brand={quote.brand ?? state.portalBrand}
              customerName={customerName}
            />
          </article>
        </div>
      </ControlledModalDialog>
      {itemDialog ? (
        <QuotationRoomDialog
          quote={quote}
          room={rooms[0] ?? null}
          workspaceId={workspaceId}
          caseId={caseId}
          onClose={() => setItemDialog(false)}
          onApply={change}
        />
      ) : null}
      {settings && (
        <QuotationBaseSettings
          quote={quote}
          customerName={customerName}
          workspaceId={workspaceId}
          readOnly={readOnly}
          onClose={() => setSettings(false)}
          onApply={change}
        />
      )}
      <ControlledModalDialog
        title={t("Reusable quotation templates")}
        size="lg"
        isOpen={templates}
        onOpenChange={setTemplates}
      >
        <div className={s.settings}>
          <QuotationTemplateLibrary
            quote={quote}
            onChange={change}
            workspaceId={workspaceId}
            caseId={caseId}
            onSave={onSave}
            canEdit={!readOnly}
          />
        </div>
      </ControlledModalDialog>
      {confirmationDialog}
    </div>
  );
}
