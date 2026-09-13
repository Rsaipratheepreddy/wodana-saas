"use client";
import { Pencil, Plus, ShieldCheck } from "lucide-react";
import type { Quote, QuoteLine, PortalBrand } from "@/lib/commercial/types";
import { money, quoteTotals, paymentMilestoneAmounts } from "@/lib/commercial/client";
import { QuotationCover } from "./quotation-cover";
import { CustomMaterialSummary } from "./quotation-materials";
import { BrandLogo } from "./portal-settings";
import d from "./quotation-studio.module.css";

export type DocumentPage = {
  id: string;
  kind: "cover" | "room" | "summary" | "payments" | "terms" | "acceptance";
  title: string;
  room?: string;
  lines?: QuoteLine[];
};
export function quotationPages(q: Quote): DocumentPage[] {
  const pages: DocumentPage[] = [
    { id: "cover", kind: "cover", title: "Cover" },
  ];
  const rooms = [
    ...new Set([
      ...(q.rooms ?? []).map((r) => r.name),
      ...q.lines.map((l) => l.room),
    ]),
  ];
  rooms.forEach((room) => {
    const lines = q.lines.filter((l) => l.room === room);
    for (let start = 0; start < Math.max(1, lines.length); start += 6)
      pages.push({
        id: `room:${room}:${start}`,
        kind: "room",
        title: room + (start ? ` · continued` : ""),
        room,
        lines: lines.slice(start, start + 6),
      });
  });
  return [
    ...pages,
    { id: "summary", kind: "summary", title: "Summary" },
    { id: "payments", kind: "payments", title: "Payment schedule" },
    { id: "terms", kind: "terms", title: "Terms & scope" },
    { id: "acceptance", kind: "acceptance", title: "Acceptance" },
  ];
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
  const totals = quoteTotals(quote),
    rooms = [...new Set([...(quote.rooms ?? []).map(r => r.name), ...quote.lines.map((l) => l.room)])].filter(room => quote.lines.some(l => l.room === room));
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
            ? "Room-wise scope"
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
                <button onClick={() => onAdd(page.room!)}>
                  <Plus size={13} />
                  Add item
                </button>
              )}
            </div>
            <table className={d.documentTable}>
              <colgroup>
                {[28, 28, 15, 12, 17].map((w, i) => (
                  <col key={i} style={{ width: `${w}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th>Item description</th>
                  <th>Materials & finishes</th>
                  <th>Unit price</th>
                  <th>Qty / unit</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {page.lines?.map((line) => (
                  <tr
                    key={line.id}
                    data-selected={!preview && selectedItem === line.id}
                  >
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
                      {line.specification && <p>{line.specification}</p>}
                    </td>
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
                        {line.material ||
                          (!line.customMaterials?.length ? "As specified" : "")}
                      </div>
                      {line.finish && <p>{line.finish}</p>}
                      <CustomMaterialSummary materials={line.customMaterials} />
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
                      <DocumentAmount
                        value={line.rate}
                        currency={quote.currency}
                      />
                    </td>
                    <td>
                      {line.quantity}
                      <small>{line.unit}</small>
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
                Add the first item for this room from the sidebar.
              </p>
            )}
            <div className={d.roomTotal}>
              <span>
                Room total
                {quote.lines.filter((l) => l.room === page.room).length !==
                page.lines?.length
                  ? " · all pages"
                  : ""}
              </span>
              <strong>
                {money(
                  quoteTotals({ ...quote, discount: 0, taxRate: 0, lines: quote.lines.filter(l => l.room === page.room) }).total,
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
                          lines: quote.lines.filter((l) => l.room === room),
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
                    : "Quotation total"}
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
              <strong>{money(totals.total, quote.currency)}</strong>
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
