"use client";
import { EmptyState } from "@/design-system";
import { Fragment } from "react";
import {
  materialAmount,
  materialsRate,
} from "@/lib/commercial/quotation-table";
import type {
  Quote,
  QuoteLine,
  ClientQuote,
  PortalBrand,
} from "@/lib/commercial/types";
import {
  money,
  paymentMilestoneAmounts,
  quoteTotals,
} from "@/lib/commercial/client";
import {
  quotationDescription,
  quotationDimensionsText,
  quotationItemName,
  quotationLineVariant,
} from "@/lib/commercial/presentation";
import { QuotationCover } from "./quotation-cover";
import { QuotationCanvasPreview } from "./quotation-canvas";
import s from "./quotation-document.module.css";

type DocumentQuote = Omit<ClientQuote, "canDecide"> | Quote;
export function QuotationDocument({
  quote,
  brand,
  customerName,
  onConfigure,
  onEditHeader,
}: {
  quote: DocumentQuote;
  brand?: PortalBrand;
  customerName?: string;
  onConfigure?: (room: string, item?: string) => void;
  onEditHeader?: () => void;
}) {
  if (quote.presentation && !onConfigure && !onEditHeader) {
    const printable = {
      ...quote,
      lines: quote.lines.map((line) => ({ ...line, unitCost: "unitCost" in line ? line.unitCost : 0 })),
    } as Quote;
    return <QuotationCanvasPreview quote={printable} brand={brand ?? quote.brand} customerName={customerName ?? quote.cover?.preparedFor ?? "Client"} />;
  }
  const totals = quoteTotals({
    ...quote,
    lines: quote.lines.map((line) => ({
      ...line,
      unitCost: 0,
      optional:
        line.optional &&
        !quote.clientDecision?.selectedOptionLineIds.includes(line.id),
    })),
  });
  const selectedOptionIds = new Set(
    quote.clientDecision?.decision === "accept"
      ? quote.clientDecision.selectedOptionLineIds
      : [],
  );
  const rooms = [
    ...new Set([
      ...(quote.rooms ?? []).map((r) => r.name),
      ...quote.lines.map((l) => l.room),
    ]),
  ];
  return (
    <article className={s.document} aria-label="Quotation document">
      <div className={s.cover}>
        {onEditHeader && (
          <div className={s.coverActions}>
            <button className={s.editHeader} onClick={onEditHeader}>
              Edit header &amp; logo
            </button>
          </div>
        )}
        <QuotationCover
          compact
          quote={quote}
          brand={brand ?? quote.brand}
          customerName={customerName}
        />
      </div>
      <div className={s.body}>
        {!rooms.length && (
          <EmptyState title="Your quotation starts here" description="Add a room from the builder, or let AI suggest a starting point." />
        )}
        {rooms.map((room, index) => {
          const lines = quote.lines.filter((l) => l.room === room);
          return (
            <section
              key={room}
              className={s.room}
              aria-label={`${room} quotation items`}
            >
              <header className={s.roomHeading}>
                <div>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h2>{room}</h2>
                  <small>
                    {lines.length} {lines.length === 1 ? "item" : "items"}
                  </small>
                </div>
                {onConfigure && (
                  <button onClick={() => onConfigure(room)}>Edit room</button>
                )}
              </header>
              {lines.length ? (
                <div className={s.tableScroll}>
                  <table>
                    <colgroup>
                      <col style={{ width: "18%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "24%" }} />
                      <col style={{ width: "8%" }} />
                      <col style={{ width: "13%" }} />
                      <col style={{ width: "13%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Reference image</th>
                        <th>Size</th>
                        <th>Materials &amp; details</th>
                        <th>Qty / unit</th>
                        <th>Rate</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <Fragment key={line.id}>
                          <tr>
                            <td data-label="Item">
                              {onConfigure ? (
                                <button
                                  className={s.itemLink}
                                  aria-label={`Edit ${quotationItemName(line.title, room)}`}
                                  onClick={() => onConfigure(room, line.id)}
                                >
                                  {quotationItemName(line.title, room)}
                                </button>
                              ) : (
                                <strong>
                                  {quotationItemName(line.title, room)}
                                </strong>
                              )}
                              {line.optional ? <small>{selectedOptionIds.has(line.id) ? "Selected option · included in accepted total" : "Option · not included in total"}</small> : null}
                              {(('variantLabel' in line ? line.variantLabel : undefined) || quotationLineVariant(line as QuoteLine)) && <small className={s.variant}>{('variantLabel' in line ? line.variantLabel : undefined) || quotationLineVariant(line as QuoteLine)}</small>}
                            </td>
                            <td data-label="Reference image">
                              {line.photo ? <img className={s.itemPhoto} src={line.photo} alt={`Reference for ${line.title}`} /> : <span className={s.muted}>—</span>}
                            </td>
                            <td data-label="Size">{quotationDimensionsText(line.dimensions) || "—"}</td>
                            <td className={s.description} data-label="Materials & details">
                              {quotationDescription(line) || "—"}
                            </td>
                            <td data-label="Quantity">
                              {line.quantity}{" "}
                              <span className={s.muted}>{line.unit}</span>
                            </td>
                            <td data-label="Rate">{money(line.rate, quote.currency)}</td>
                            <td data-label="Amount">
                              <strong>
                                {money(
                                  line.quantity * line.rate,
                                  quote.currency,
                                )}
                              </strong>
                            </td>
                          </tr>
                          {!!line.materialRows?.length && (
                            <tr className={s.materialBreakdown}>
                              <td colSpan={7}>
                                <p>
                                  Materials per 1 {line.unit} ·{" "}
                                  {line.pricingMode === "materials"
                                    ? "Item rate calculated from these rows"
                                    : "Breakdown only; entered item rate applies"}{" "}
                                  · Not charged again
                                </p>
                                <table
                                  aria-label={`Materials for ${line.title}`}
                                >
                                  <thead>
                                    <tr>
                                      <th>Material / specification</th>
                                      <th>Type</th>
                                      <th>Qty / unit</th>
                                      <th>Rate</th>
                                      <th>Amount per item unit</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {line.materialRows.map((row) => (
                                      <tr key={row.id}>
                                        <td>
                                          <strong>{row.name}</strong>
                                          {row.specification && (
                                            <div>{row.specification}</div>
                                          )}
                                          {row.suppliedByClient && (
                                            <small>
                                              Client supplied · no charge
                                            </small>
                                          )}
                                        </td>
                                        <td>{row.type}</td>
                                        <td>
                                          {row.quantity} {row.unit}
                                        </td>
                                        <td>
                                          {money(row.rate, quote.currency)}
                                        </td>
                                        <td>
                                          {money(
                                            materialAmount(row),
                                            quote.currency,
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr>
                                      <td colSpan={4}>
                                        Materials per 1 {line.unit}
                                      </td>
                                      <td>
                                        {money(
                                          materialsRate(line.materialRows),
                                          quote.currency,
                                        )}
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={s.emptyRoom}>
                  No items yet.{" "}
                  {onConfigure && (
                    <button onClick={() => onConfigure(room)}>
                      Add items →
                    </button>
                  )}
                </div>
              )}
              {!!lines.length && (
                <div className={s.roomTotal}>
                  <span>{room} subtotal</span>
                  <strong>
                    {money(
                      lines.filter((line) => !line.optional || selectedOptionIds.has(line.id)).reduce(
                        (sum, l) =>
                          sum + Math.round(l.quantity * l.rate * 100) / 100,
                        0,
                      ),
                      quote.currency,
                    )}
                  </strong>
                </div>
              )}
            </section>
          );
        })}
        <div className={s.summary}>
          <div>
            <span>QUOTATION SUMMARY</span>
            <p>
              {rooms.length} rooms · {quote.lines.length} items
            </p>
          </div>
          <dl>
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
              <dt>
                {quote.cover?.taxLabel || "Tax"} ({quote.taxRate}%)
              </dt>
              <dd>{money(totals.tax, quote.currency)}</dd>
            </div>
            <div className={s.grandTotal}>
              <dt>
                {quote.direction === "deduction" ? "Client credit" : quote.clientDecision?.decision === "accept" ? "Accepted total" : "Total"}
              </dt>
              <dd>{money(totals.total, quote.currency)}</dd>
            </div>
          </dl>
        </div>
        {!!quote.paymentTerms?.length && (
          <section className={s.terms}>
            <h3>Payment schedule</h3>
            <div className={s.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th>Milestone</th>
                    <th>When due</th>
                    <th>%</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.paymentTerms.map((term, i) => (
                    <tr key={term.id}>
                      <td>
                        {term.title}
                        {term.requiredForRelease && <small>Before project release</small>}
                        {term.requiredForProduction && <small>Before manufacturing starts</small>}
                      </td>
                      <td>{term.trigger}</td>
                      <td>{term.percent}%</td>
                      <td>
                        {money(
                          paymentMilestoneAmounts(
                            quote.clientDecision?.acceptedTotal ?? totals.total,
                            quote.paymentTerms,
                          )[i],
                          quote.currency,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {quote.cover?.taxRegistration && (
          <p className={s.registration}>
            {quote.cover.taxLabel || "Tax"} registration:{" "}
            {quote.cover.taxRegistration}
          </p>
        )}
        {(
          [
            ["Included", "inclusions"],
            ["Not included", "exclusions"],
            ["Terms & conditions", "terms"],
          ] as const
        ).map(
          ([label, key]) =>
            quote[key] && (
              <section className={s.terms} key={key}>
                <h3>{label}</h3>
                <p>{quote[key]}</p>
              </section>
            ),
        )}
        {(quote.cover?.signerName ||
          quote.cover?.signature ||
          quote.cover?.clientSignature) && (
          <section className={s.signatures} aria-label="Signatures">
            {(quote.cover.signerName || quote.cover.signature) && (
              <div>
                {quote.cover.signature && (
                  <img
                    src={quote.cover.signature}
                    alt="Authorized signatory signature"
                  />
                )}
                <strong>{quote.cover.signerName}</strong>
                <span>{quote.cover.signerTitle || "Authorized signatory"}</span>
              </div>
            )}
            {quote.cover.clientSignature && (
              <div>
                <span className={s.signatureLine} />
                <strong>Client signature</strong>
                <span>Name & date</span>
              </div>
            )}
          </section>
        )}
      </div>
    </article>
  );
}
