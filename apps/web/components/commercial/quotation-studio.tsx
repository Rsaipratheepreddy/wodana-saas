"use client";
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
import { money, quoteTotals } from "@/lib/commercial/client";
import { roomNames } from "@/lib/commercial/room-builder";
import {
  addQuotationSuggestions,
  type QuotationAnalysis,
} from "@/lib/commercial/quotation-assist";
import { Checkbox, ControlledModalDialog, SelectField, useConfirmationDialog } from "@/design-system";
import type { QuotationEditor } from "./quotation-editor";
import { CatalogOptionsProvider } from "./catalog-options-cache";
import { QuotationTemplateLibrary } from "./quotation-sidebar-tools";
import { QuotationDocument } from "./quotation-document";
import { QuotationBaseSettings } from "./quotation-base-settings";
import { QuotationSheet } from "./quotation-sheet";
import { QuotationRoomDialog } from "./quotation-room-dialog";
import { QuotationAiPanel } from "./quotation-ai-panel";
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
  const [preview, setPreview] = useState(false),
    [settings, setSettings] = useState(false),
    [templates, setTemplates] = useState(false),
    [requestDialog, setRequestDialog] = useState(false),
    [search, setSearch] = useState(""),
    [mode, setMode] = useState<"items" | "design">(initialMode),
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
      {mode === "items" ? <header className={s.quoteHeader} aria-label="Quotation header">
        <label className={s.quoteTitle}>
          Quotation title
          <QuotationTextCell
            label="Quotation title"
            value={quote.title}
            required
            max={240}
            readOnly={readOnly}
            onChange={(title) => patch({ title })}
          />
        </label>
        <label>
          Prepared for
          <QuotationTextCell
            label="Prepared for"
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
          Location
          <span className={s.locationInput}>
            <QuotationTextCell
              label="Quotation location"
              value={quote.cover?.location ?? ""}
              placeholder="Project location"
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
              aria-label="Use current location"
              title={locationNotice || "Use current location"}
              disabled={locating}
              onClick={() => {
                if (!navigator.geolocation) {
                  setLocationNotice("Location is not available in this browser.");
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
                    setLocationNotice(`Pinned ${latitude}, ${longitude}`);
                    setLocating(false);
                  },
                  (error) => {
                    setLocationNotice(error.code === error.PERMISSION_DENIED ? "Location permission was not allowed." : "Current location could not be detected.");
                    setLocating(false);
                  },
                  { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
                );
              }}
            ><LocateFixed size={15} /></button> : null}
          </span>
        </label>
        <label>
          Valid until
          <input
            aria-label="Quotation valid until"
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
          <small>All prices</small>
        </span>
      </header> : null}
      {mode === "items" ? <div className={s.viewBar}>
        <div className={s.viewSwitch} aria-label="Quotation workspace view">
          <button type="button" aria-pressed={false} onClick={() => { setMode("design"); setAiOpen(false); }}>Design</button>
          <button type="button" aria-pressed onClick={() => setMode("items")}>Items & pricing</button>
        </div>
        <span>Build scope and pricing</span>
      </div> : null}
      {mode === "design" ? (
        <QuotationCanvas
          quote={quote}
          brand={quote.brand ?? state.portalBrand}
          customerName={customerName}
          readOnly={readOnly}
          onChange={change}
          onEditItems={() => setItemDialog(true)}
          toolbarStart={<div className={s.viewSwitch} aria-label="Quotation workspace view">
            <button type="button" aria-pressed onClick={() => { setMode("design"); setAiOpen(false); }}>Design</button>
            <button type="button" aria-pressed={false} onClick={() => setMode("items")}>Items & pricing</button>
          </div>}
          toolbarEnd={<button type="button" className={s.previewButton} onClick={() => setPreview(true)}><Eye size={15} />Preview</button>}
        />
      ) : <div className={s.split} data-ai-open={aiOpen}>
        <section className={s.roomPanel} aria-label="Quotation room builder">
          <div className={s.roomPanelScroll}>
            <div className={s.roomHeading}>
              <div>
                <h2>Quotation builder</h2>
                <p>
                  {rooms.length} areas · {quote.lines.length} items ·{" "}
                  {quote.currency}
                </p>
              </div>
              <div className={s.roomHeadingActions}>
                <label className={s.search}>
                  <Search size={14} />
                  <input
                    type="search"
                    aria-label="Search quotation rooms"
                    placeholder="Find room, item or material…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className={s.toolbarGroup}>
                  <button
                    className={s.iconButton}
                    title="Undo"
                    aria-label="Undo"
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
                    title="Redo"
                    aria-label="Redo"
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
                  <summary><MoreHorizontal size={16}/><span>More</span></summary>
                  <div>
                    <button aria-label="Base settings" onClick={() => setSettings(true)}><Settings2 size={15}/><span>Document settings</span></button>
                    <button aria-label="Templates" onClick={() => setTemplates(true)}><BookCopy size={15}/><span>Templates</span></button>
                    <button aria-label="Link change requests" onClick={() => setRequestDialog(true)}><Link2 size={15}/><span>Change requests{linkedRequests.length ? ` · ${linkedRequests.length}` : ""}</span></button>
                  </div>
                </details>
                <button
                  className={s.previewButton}
                  aria-label="Preview quotation"
                  onClick={() => setPreview(true)}
                >
                  <Eye size={16} />
                  <span>Preview</span>
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
                  AI assistant
                </button>
              </div>
            </div>
            {readOnly && (
              <p className={s.notice}>
                This version is read-only. Create a revision to edit it.
              </p>
            )}
            {aiNotice && (
              <p role="status" className={s.hint}>
                {aiNotice}
              </p>
            )}
            {quote.kind === "variation" && !readOnly && (
              <div className={s.variationField}>
                <SelectField
                  label="Change order effect"
                  aria-label="Variation effect"
                  accent="neutral"
                  selectedKey={quote.direction ?? "addition"}
                  items={[
                    { id: "addition", label: "Additional work" },
                    {
                      id: "deduction",
                      label: "Scope deduction / client credit",
                    },
                  ]}
                  onSelectionChange={(key) => {
                    const direction =
                      key === "deduction" ? "deduction" : "addition";
                    const applyDirection = () => patch({ direction, lines: [], rooms: [], paymentTerms: direction === "deduction" ? [] : quote.paymentTerms });
                    if (quote.lines.length) {
                      requestConfirmation({ title: "Change variation effect?", body: "Changing between additional work and a deduction removes the current variation items so the commercial basis stays consistent.", confirmLabel: "Change and clear items", onConfirm: applyDirection });
                      return;
                    }
                    applyDirection();
                  }}
                />
                <p>
                  {linkedRequests.length
                    ? `Linked to ${linkedRequests.map((request) => `CR-${String(request.number).padStart(3, "0")}`).join(", ")}`
                    : "Link the change request this quotation resolves."}
                </p>
              </div>
            )}
            {quote.direction === "deduction" && !readOnly && (
              <div className={s.variationField}>
                <SelectField
                  label="Accepted contract item"
                  aria-label="Accepted contract item"
                  accent="neutral"
                  selectedKey={null}
                  placeholder="Choose an item to deduct…"
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
            <QuotationSheet
              quote={quote}
              onChange={change}
              readOnly={readOnly}
              workspaceId={workspaceId}
              caseId={caseId}
              canOverridePrice={Boolean(state.canOverridePrice)}
              canViewCosts={Boolean(costing)}
              search={search}
              brand={quote.brand ?? state.portalBrand}
            />
            {!readOnly && quote.direction !== "deduction" && (
              <button className={s.importButton} onClick={onImportScope}>
                Import unconfirmed requirements
                <ChevronRight size={13} />
              </button>
            )}
          </div>
          <footer className={s.totalBar}>
            <span>
              {rooms.length} areas · {quote.lines.length} items
            </span>
            <div>
              <small>Quotation total</small>
              <strong>{money(totals.total, quote.currency)}</strong>
            </div>
          </footer>
        </section>
        <aside
          ref={aiPanel}
          id="quotation-ai-panel"
          hidden={!aiOpen}
          className={s.chatPanel}
          aria-label="AI quotation assistant"
        >
          <div className={s.aiPanelHeading}>
            <strong>Quotation assistant</strong>
            <button
              aria-label="Close AI assistant"
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
                label="Use AI for"
                aria-label="AI room context"
                accent="neutral"
                selectedKey={rooms.includes(aiRoom) ? `room:${aiRoom}` : "all"}
                items={[
                  { id: "all", label: "All rooms / sections" },
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
        title="Review AI suggestions"
        size="lg"
        isOpen={review}
        onOpenChange={setReview}
      >
        <div className={s.settings}>
          <p className={s.hint}>
            Choose items to add. Existing items, quantities, prices and notes
            will not be replaced. New items start at quantity 1 and rate 0 for
            you to price.
          </p>
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
              Cancel
            </button>
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
                    ? `${count} AI-suggested ${count === 1 ? "item added" : "items added"}. Check quantities and enter prices, then save.`
                    : "No new items added. These items already exist or the quotation limit has been reached.",
                );
              }}
            >
              {aiAdding ? "Preparing items…" : "Add selected items"}
            </button>
          </div>
        </div>
      </ControlledModalDialog>
      <ControlledModalDialog
        title="Linked change requests"
        description={
          quote.kind === "variation"
            ? "Connect this change-order quotation to the request it prices. Client acceptance will update the linked request."
            : "Connect requests that this quotation addresses. Links are kept through review and client acceptance."
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
                <small>{request.status.replaceAll("_", " ")}</small>
              </span>
            </Checkbox>
          ))}
          {!availableRequests.length && (
            <p className={s.hint}>
              No open change requests. New requests will appear here
              automatically.
            </p>
          )}
        </div>
      </ControlledModalDialog>
      <ControlledModalDialog
        title="Quotation preview"
        size="lg"
        isOpen={preview}
        onOpenChange={setPreview}
      >
        <div className={s.previewDialog}>
          <article aria-label="Quotation document">
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
        title="Reusable quotation templates"
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
