"use client";
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
  quotationItemName,
  quotationLineVariant,
} from "@/lib/commercial/presentation";
import { QuotationCover } from "./quotation-cover";
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
  const totals = quoteTotals({
    ...quote,
    lines: quote.lines.map((l) => ({ ...l, unitCost: 0 })),
  });
  const rooms = [
    ...new Set([
      ...(quote.rooms ?? []).map((r) => r.name),
      ...quote.lines.map((l) => l.room),
    ]),
  ];
  return (
    <article className={s.document} aria-label="Quotation document">
      <div className={s.cover}>
        <QuotationCover
          compact
          quote={quote}
          brand={brand ?? quote.brand}
          customerName={customerName}
        />
        {onEditHeader && (
          <button className={s.editHeader} onClick={onEditHeader}>
            Edit header
          </button>
        )}
      </div>
      <div className={s.body}>
        {!rooms.length && (
          <div className={s.empty}>
            <span>YOUR SCOPE, ROOM BY ROOM</span>
            <h2>Your quotation starts here</h2>
            <p>
              Add a room from the builder or let AI suggest a starting point.
            </p>
          </div>
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
                      <col style={{ width: "20%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "32%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "14%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Variant</th>
                        <th>Description</th>
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
                              {line.photo && (
                                <img
                                  className={s.itemPhoto}
                                  src={line.photo}
                                  alt={line.title}
                                />
                              )}
                            </td>
                            <td data-label="Variant">
                              <span className={s.variant}>
                                {("variantLabel" in line
                                  ? line.variantLabel
                                  : undefined) ||
                                  quotationLineVariant(line as QuoteLine) ||
                                  "—"}
                              </span>
                            </td>
                            <td className={s.description} data-label="Description">
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
                              <td colSpan={6}>
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
                      lines.reduce(
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
                {quote.direction === "deduction" ? "Client credit" : "Total"}
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
                      <td>{term.title}</td>
                      <td>{term.trigger}</td>
                      <td>{term.percent}%</td>
                      <td>
                        {money(
                          paymentMilestoneAmounts(
                            totals.total,
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
