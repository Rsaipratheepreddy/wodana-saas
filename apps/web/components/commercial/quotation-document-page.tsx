"use client";
import { Pencil, Plus, ShieldCheck } from "lucide-react";
import type { Quote, QuoteLine, PortalBrand } from "@/lib/commercial/types";
import { acceptedQuoteTotals, money, quoteTotals, paymentMilestoneAmounts } from "@/lib/commercial/client";
import { quotationDescription } from "@/lib/commercial/presentation";
import { QuotationCover } from "./quotation-cover";
import { BrandLogo } from "./brand-logo";
import d from "./quotation-studio.module.css";
import {isReferenceLayout,referenceItemGroups} from '@/lib/commercial/quotation-reference-template';

export type DocumentPage = {
  id: string;
  kind: "cover" | "room" | "summary" | "payments" | "terms" | "acceptance" | "custom";
  title: string;
  room?: string;
  lines?: QuoteLine[];
};
export function quotationPages(q: Quote): DocumentPage[] {
  const pages: DocumentPage[] = [
    { id: "cover", kind: "cover", title: "Cover" },
  ];
  const reference=isReferenceLayout(q.presentation?.template);
  const groups=reference?referenceItemGroups(q.lines):Array.from({length:Math.max(1,Math.ceil(q.lines.length/3))},(_,index)=>({start:index*3,count:3}));
  for (const {start,count} of groups)
    pages.push({
      id: `items:${start}`,
      kind: isReferenceLayout(q.presentation?.template)?"custom":"room",
      title: start ? `Scope & Items · ${groups.findIndex(group=>group.start===start)+1}` : "Scope & Items",
      lines: q.lines.slice(start, start + count),
    });
  const all: DocumentPage[] = [
    ...pages,
    { id: "summary", kind: "summary", title: "Summary" },
    { id: "payments", kind: "payments", title: "Payment schedule" },
    { id: "terms", kind: "terms", title: "Terms & scope" },
    { id: "acceptance", kind: "acceptance", title: "Acceptance" },
    ...(q.presentation?.pages.filter(page => page.kind === "custom" && !page.id.startsWith("items:") && !["cover","summary","payments","terms","acceptance"].includes(page.id)).map(page => ({ id: page.id, kind: "custom" as const, title: page.title || "Custom page" })) ?? []),
  ];
  const rendered = all.map(page => q.presentation?.pages.some(override => override.id === page.id && override.kind === "custom") ? { ...page, kind: "custom" as const } : page);
  const ordered = q.presentation?.pageOrder
    ? q.presentation.pageOrder.flatMap(id => id === "scope" ? rendered.filter(page => page.id.startsWith("items:")) : rendered.filter(page => page.id === id))
    : rendered;
  return ordered.filter(page=>!q.presentation?.hiddenPages?.includes(page.id)&&!(page.id.startsWith("items:")&&q.presentation?.hiddenPages?.includes("scope"))).map((page,index)=>reference?{...page,title:page.id.startsWith('items:')?'Scope & Items':`Page ${index+1}`}:page);
}

export function QuotationDocumentPage({
  quote,
  brand,
  customerName,
  page,
  pageCount,
  pageIndex,
  selectedItem,
  onSelect,
  onAdd,
  preview,
}: {
  quote: Quote;
  brand?: PortalBrand;
  customerName: string;
  page: DocumentPage;
  pageCount: number;
  pageIndex: number;
  selectedItem: string;
  onSelect: (id: string, materials?: boolean) => void;
  onAdd: (room: string) => void;
  preview: boolean;
}) {
  const selectedOptionIds = new Set(quote.clientDecision?.selectedOptionLineIds ?? []),
    totals = quote.status === "accepted" ? acceptedQuoteTotals(quote) : quoteTotals(quote),
    rooms = [...new Set([...(quote.rooms ?? []).map(r => r.name), ...quote.lines.map((l) => l.room)])].filter(room => quote.lines.some(l => l.room === room));
  if (page.kind === "custom") return null;
  if (page.kind === "cover")
    return (
      <div className={d.coverDocument}>
        <QuotationCover
          quote={quote}
          brand={brand}
          customerName={customerName}
          canvas
        />
      </div>
    );
  return (
    <article
      className={d.documentPage}
      aria-label={`${page.title} document page`}
    >
      <header className={d.documentHeader}>
        {brand ? <BrandLogo brand={brand} /> : <strong>Quotation</strong>}
        <span>
          QUOTATION<strong>QT-{quote.id.slice(0, 8).toUpperCase()}</strong>
          <small>Version {quote.number}</small>
        </span>
      </header>
      <div className={d.documentBody}>
        <span className={d.eyebrow}>
          {page.kind === "room"
            ? "Estimate proposal · item schedule"
            : "Your project, clearly defined"}
        </span>
        <h2>{page.title}</h2>
        {page.kind === "room" && (
          <>
            <div className={d.roomCaption}>
              <span>
                {page.lines?.length}{" "}
                {page.lines?.length === 1 ? "item" : "items"} · {quote.currency}
              </span>
              {!preview && (
                <button onClick={() => onAdd(page.lines?.[0]?.room ?? "General")}>
                  <Plus size={13} />
                  Add item
                </button>
              )}
            </div>
            <table className={`${d.documentTable} ${d.itemsTable}`}>
              <colgroup>
                {[4, 14, 14, 6, 6, 6, 18, 7, 12, 13].map((w, i) => (
                  <col key={i} style={{ width: `${w}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th>SN</th>
                  <th>Description of item</th>
                  <th>Inspiration</th>
                  <th>Length</th>
                  <th>Height</th>
                  <th>Depth</th>
                  <th>Materials requested</th>
                  <th>Qty</th>
                  <th>Unit price</th>
                  <th>Total amount</th>
                </tr>
              </thead>
              <tbody>
                {page.lines?.map((line, index) => (
                  <tr
                    key={line.id}
                    data-selected={!preview && selectedItem === line.id}
                  >
                    <td>
                      {Number(page.id.split(":")[1] ?? 0) + index + 1}
                    </td>
                    <td>
                      {preview ? (
                        <strong>{line.title}</strong>
                      ) : (
                        <button
                          className={d.documentItem}
                          aria-label={`Edit ${line.title}`}
                          onClick={() => onSelect(line.id)}
                        >
                          <strong>{line.title}</strong>
                          <Pencil size={12} />
                        </button>
                      )}
                      {line.optional ? <small>{selectedOptionIds.has(line.id) ? "Selected option · included in accepted total" : "Option · not included in total"}</small> : null}
                      {line.variant ? <small>{line.variant}</small> : null}
                      <small>{line.room}</small>
                    </td>
                    <td>{line.photo ? <img className={d.itemImage} src={line.photo} alt={`Inspiration for ${line.title}`} /> : <span>—</span>}</td>
                    <td>{line.dimensions?.length != null ? `L ${line.dimensions.length} ${line.dimensions.unit}` : "—"}</td>
                    <td>{line.dimensions?.height != null ? `H ${line.dimensions.height} ${line.dimensions.unit}` : "—"}</td>
                    <td>{line.dimensions?.depth != null ? `D ${line.dimensions.depth} ${line.dimensions.unit}` : "—"}</td>
                    <td>
                      {line.catalogLinks?.find((l) => l.role === "variant") && (
                        <small>
                          {
                            line.catalogLinks.find((l) => l.role === "variant")!
                              .snapshot.name
                          }
                        </small>
                      )}
                      <div className={d.materialText}>
                        {quotationDescription(line) || "As specified"}
                      </div>
                      {!preview && (
                        <button
                          className={d.editMaterial}
                          aria-label={`Edit material for ${line.title}`}
                          onClick={() => onSelect(line.id, true)}
                        >
                          <Pencil size={11} />
                          Edit materials
                        </button>
                      )}
                    </td>
                    <td>
                      {line.quantity}
                      <small>{line.unit}</small>
                    </td>
                    <td>
                      <DocumentAmount
                        value={line.rate}
                        currency={quote.currency}
                      />
                    </td>
                    <td>
                      <strong>
                        <DocumentAmount
                          value={line.quantity * line.rate}
                          currency={quote.currency}
                        />
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!page.lines?.length && (
              <p className={d.emptyDocument}>
                Add the first quoted item from the Items view.
              </p>
            )}
            <div className={d.roomTotal}>
              <span>
                Items subtotal
                {quote.lines.length !== page.lines?.length
                  ? " · all item pages"
                  : ""}
              </span>
              <strong>
                {money(
                  quoteTotals({ ...quote, discount: 0, taxRate: 0, lines: quote.lines.map(line => line.optional && selectedOptionIds.has(line.id) ? {...line, optional:false} : line) }).total,
                  quote.currency,
                )}
              </strong>
            </div>
          </>
        )}
        {page.kind === "summary" && (
          <>
            <p className={d.documentIntro}>
              The investment for your space, room by room.
            </p>
            <table className={d.documentTable}>
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Items</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <tr key={room}>
                    <td>{room}</td>
                    <td>{quote.lines.filter((l) => l.room === room).length}</td>
                    <td>
                      {money(
                        quoteTotals({
                          ...quote,
                          discount: 0,
                          taxRate: 0,
                          lines: quote.lines.filter((l) => l.room === room).map(line => line.optional && selectedOptionIds.has(line.id) ? {...line, optional:false} : line),
                        }).total,
                        quote.currency,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className={d.documentTotals}>
              <div>
                <dt>Subtotal</dt>
                <dd>{money(totals.subtotal, quote.currency)}</dd>
              </div>
              {quote.discount > 0 && (
                <div>
                  <dt>Discount</dt>
                  <dd>−{money(quote.discount, quote.currency)}</dd>
                </div>
              )}
              <div>
                <dt>Tax · {quote.taxRate}%</dt>
                <dd>{money(totals.tax, quote.currency)}</dd>
              </div>
              <div>
                <dt>
                  {quote.direction === "deduction"
                    ? "Client credit"
                    : quote.status === "accepted" ? "Accepted total" : "Quotation total"}
                </dt>
                <dd>{money(totals.total, quote.currency)}</dd>
              </div>
            </dl>
          </>
        )}
        {page.kind === "payments" &&
          (quote.direction === "deduction" ? (
            <p>Client credit · {money(totals.total, quote.currency)}</p>
          ) : (
            <>
              <p className={d.documentIntro}>
                Payments are linked to the agreed milestones below.
              </p>
              <table className={d.documentTable}>
                <thead>
                  <tr>
                    <th>Milestone</th>
                    <th>When due</th>
                    <th>%</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.paymentTerms.map((t, i) => (
                    <tr key={t.id}>
                      <td>
                        <strong>{t.title || "Milestone"}</strong>
                        {t.requiredForRelease && (
                          <small>Before project release</small>
                        )}
                        {t.requiredForProduction && (
                          <small>Before manufacturing starts</small>
                        )}
                      </td>
                      <td>{t.trigger}</td>
                      <td>{t.percent}%</td>
                      <td>
                        {money(
                          paymentMilestoneAmounts(totals.total, quote.paymentTerms)[i],
                          quote.currency,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!quote.paymentTerms.length && (
                <p className={d.emptyDocument}>
                  No payment schedule added yet.
                </p>
              )}
            </>
          ))}
        {page.kind === "terms" && (
          <div className={d.documentTerms}>
            {[
              ["Included", quote.inclusions],
              ["Excluded", quote.exclusions],
              ["Terms & conditions", quote.terms],
            ].map(([label, content]) => (
              <section key={label}>
                <h3>{label}</h3>
                <p>{content || "—"}</p>
              </section>
            ))}
          </div>
        )}
        {page.kind === "acceptance" && (
          <>
            <p className={d.documentIntro}>
              Review the scope, selected materials, prices and payment schedule
              before confirming this version.
            </p>
            <div className={d.acceptance}>
              <ShieldCheck size={28} />
              <h3>
                {quote.status === "accepted"
                  ? "Quotation accepted"
                  : "Client acceptance"}
              </h3>
              <p>
                {quote.status === "accepted"
                  ? `Accepted by ${quote.decidedBy ?? "the client"}${quote.decidedAt ? ` on ${new Date(quote.decidedAt).toLocaleDateString("en-GB")}` : ""}.`
                  : "Your client can approve this quotation or request changes through the client portal after it is issued."}
              </p>
              <strong>{money(quote.clientDecision?.acceptedTotal ?? totals.total, quote.currency)}</strong>
            </div>
          </>
        )}
      </div>
      <footer className={d.documentFooter}>
        <span>
          {brand?.name} · {quote.cover?.preparedFor || customerName}
        </span>
        <span>
          {String(pageIndex + 1).padStart(2, "0")} /{" "}
          {String(pageCount).padStart(2, "0")}
        </span>
      </footer>
    </article>
  );
}

function DocumentAmount({
  value,
  currency,
}: {
  value: number;
  currency: string;
}) {
  const formatted = new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return (
    <span className={d.documentAmount}>
      <small>{currency}</small>
      <span style={{ fontSize: formatted.length > 16 ? 10 : 12 }}>
        {formatted}
      </span>
    </span>
  );
}
