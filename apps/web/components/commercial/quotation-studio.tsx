"use client";
import { useRef, useState } from "react";
import {
  BookCopy,
  ChevronRight,
  Eye,
  Link2,
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
import { Checkbox, ControlledModalDialog, SelectField } from "@/design-system";
import type { QuotationEditor } from "./quotation-editor";
import { CatalogOptionsProvider } from "./catalog-options-cache";
import { QuotationTemplateLibrary } from "./quotation-sidebar-tools";
import { QuotationDocument } from "./quotation-document";
import { QuotationBaseSettings } from "./quotation-base-settings";
import { QuotationSheet } from "./quotation-sheet";
import { QuotationAiPanel } from "./quotation-ai-panel";
import { QuotationTextCell } from "./quotation-text-cell";
import s from "./quotation-workspace.module.css";
type Props = React.ComponentProps<typeof QuotationEditor> & {
  state: CommercialState;
  customerName: string;
  onSave: () => Promise<boolean>;
  onImportScope: () => void;
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
}: Props) {
  const [preview, setPreview] = useState(false),
    [settings, setSettings] = useState(false),
    [templates, setTemplates] = useState(false),
    [requestDialog, setRequestDialog] = useState(false),
    [search, setSearch] = useState("");
  const [analysis, setAnalysis] = useState<QuotationAnalysis | null>(null);
  const [review, setReview] = useState(false);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [aiRoom, setAiRoom] = useState("");
  const [aiNotice, setAiNotice] = useState("");
  const editSession = useRef<Element | null>(null);
  const aiPanel = useRef<HTMLElement>(null);
  const aiToggle = useRef<HTMLButtonElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
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
      <header className={s.quoteHeader} aria-label="Quotation header">
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
        <label>
          Location
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
      </header>
      <div className={s.split} data-ai-open={aiOpen}>
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
                <button
                  className={s.linkButton}
                  aria-label="Base settings"
                  onClick={() => setSettings(true)}
                >
                  <Settings2 size={15} />
                  <span>Base settings</span>
                </button>
                <button
                  className={s.linkButton}
                  aria-label="Templates"
                  onClick={() => setTemplates(true)}
                >
                  <BookCopy size={15} />
                  <span>Templates</span>
                </button>
                <button
                  className={s.linkButton}
                  aria-label="Link change requests"
                  onClick={() => setRequestDialog(true)}
                >
                  <Link2 size={15} />
                  <span>
                    Change requests
                    {linkedRequests.length ? ` · ${linkedRequests.length}` : ""}
                  </span>
                </button>
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
                    if (
                      quote.lines.length &&
                      !window.confirm(
                        "Changing the variation effect clears its items. Continue?",
                      )
                    )
                      return;
                    patch({
                      direction,
                      lines: [],
                      rooms: [],
                      paymentTerms:
                        direction === "deduction" ? [] : quote.paymentTerms,
                    });
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
              search={search}
            />
            {!readOnly && quote.direction !== "deduction" && (
              <button className={s.importButton} onClick={onImportScope}>
                Import existing requirements
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
      </div>
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
              disabled={readOnly || !selectedSuggestions.length}
              onClick={() => {
                if (!analysis) return;
                const next = addQuotationSuggestions(
                  quote,
                  analysis.rooms.map((room) => ({
                    ...room,
                    items: room.items.filter((_, index) =>
                      selectedSuggestions.includes(`${room.id}:${index}`),
                    ),
                  })),
                );
                const count = next.lines.length - quote.lines.length;
                change(next);
                setReview(false);
                setAiNotice(
                  count
                    ? `${count} AI-suggested ${count === 1 ? "item added" : "items added"}. Check quantities and enter prices, then save.`
                    : "No new items added. These items already exist or the quotation limit has been reached.",
                );
              }}
            >
              Add selected items
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
          <QuotationDocument
            quote={quote}
            brand={quote.brand ?? state.portalBrand}
            customerName={customerName}
          />
        </div>
      </ControlledModalDialog>
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
    </div>
  );
}
