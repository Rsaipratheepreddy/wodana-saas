"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown } from "@/lib/i18n/keys";
import { EmptyState, useDesignSystem } from "@/design-system";
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
  const t = useT();
  const { locale } = useDesignSystem();
  if (quote.presentation && !onConfigure && !onEditHeader) {
    const printable = {
      ...quote,
      lines: quote.lines.map((line) => ({ ...line, unitCost: "unitCost" in line ? line.unitCost : 0 })),
    } as Quote;
    return <QuotationCanvasPreview quote={printable} brand={brand ?? quote.brand} customerName={customerName ?? quote.cover?.preparedFor ?? t("Client")} />;
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
    <article className={s.document} aria-label={t("Quotation document")}>
      <div className={s.cover}>
        {onEditHeader && (
          <div className={s.coverActions}>
            <button className={s.editHeader} onClick={onEditHeader}>
              {t("Edit header & logo")}
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
          <EmptyState title={t("Your quotation starts here")} description={t("Add a room from the builder, or let AI suggest a starting point.")} />
        )}
        {rooms.map((room, index) => {
          const lines = quote.lines.filter((l) => l.room === room);
          return (
            <section
              key={room}
              className={s.room}
              aria-label={t("{room} quotation items", { room })}
            >
              <header className={s.roomHeading}>
                <div>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h2>{room}</h2>
                  <small>
                    {t(lines.length === 1 ? "{count} item" : "{count} items", { count: lines.length })}
                  </small>
                </div>
                {onConfigure && (
                  <button onClick={() => onConfigure(room)}>{t("Edit room")}</button>
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
                        <th>{t("Item")}</th>
                        <th>{t("Reference image")}</th>
                        <th>{t("Size")}</th>
                        <th>{t("Materials & details")}</th>
                        <th>{t("Qty / unit")}</th>
                        <th>{t("Rate")}</th>
                        <th>{t("Amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <Fragment key={line.id}>
                          <tr>
                            <td data-label={t("Item")}>
                              {onConfigure ? (
                                <button
                                  className={s.itemLink}
                                  aria-label={t("Edit {title}", { title: quotationItemName(line.title, room) })}
                                  onClick={() => onConfigure(room, line.id)}
                                >
                                  {quotationItemName(line.title, room)}
                                </button>
                              ) : (
                                <strong>
                                  {quotationItemName(line.title, room)}
                                </strong>
                              )}
                              {line.optional ? <small>{t(selectedOptionIds.has(line.id) ? "Selected option · included in accepted total" : "Option · not included in total")}</small> : null}
                              {(('variantLabel' in line ? line.variantLabel : undefined) || quotationLineVariant(line as QuoteLine)) && <small className={s.variant}>{('variantLabel' in line ? line.variantLabel : undefined) || quotationLineVariant(line as QuoteLine)}</small>}
                            </td>
                            <td data-label={t("Reference image")}>
                              {line.photo ? <img className={s.itemPhoto} src={line.photo} alt={t("Reference for {title}", { title: line.title })} /> : <span className={s.muted}>—</span>}
                            </td>
                            <td data-label={t("Size")}>{quotationDimensionsText(line.dimensions) || "—"}</td>
                            <td className={s.description} data-label={t("Materials & details")}>
                              {quotationDescription(line) || "—"}
                            </td>
                            <td data-label={t("Quantity")}>
                              {line.quantity}{" "}
                              <span className={s.muted}>{line.unit}</span>
                            </td>
                            <td data-label={t("Rate")}>{money(line.rate, quote.currency, locale)}</td>
                            <td data-label={t("Amount")}>
                              <strong>
                                {money(
                                  line.quantity * line.rate,
                                  quote.currency,
                                  locale,
                                )}
                              </strong>
                            </td>
                          </tr>
                          {!!line.materialRows?.length && (
                            <tr className={s.materialBreakdown}>
                              <td colSpan={7}>
                                <p>
                                  {t(line.pricingMode === "materials"
                                    ? "Materials per 1 {unit} · Item rate calculated from these rows · Not charged again"
                                    : "Materials per 1 {unit} · Breakdown only; entered item rate applies · Not charged again", { unit: line.unit })}</p>
                                <table
                                  aria-label={t("Materials for {title}", { title: line.title })}
                                >
                                  <thead>
                                    <tr>
                                      <th>{t("Material / specification")}</th>
                                      <th>{t("Type")}</th>
                                      <th>{t("Qty / unit")}</th>
                                      <th>{t("Rate")}</th>
                                      <th>{t("Amount per item unit")}</th>
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
                                              {t("Client supplied · no charge")}</small>
                                          )}
                                        </td>
                                        <td>{translateKnown(t, row.type)}</td>
                                        <td>
                                          {row.quantity} {row.unit}
                                        </td>
                                        <td>
                                          {money(row.rate, quote.currency, locale)}
                                        </td>
                                        <td>
                                          {money(
                                            materialAmount(row),
                                            quote.currency,
                                            locale,
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr>
                                      <td colSpan={4}>
                                        {t("Materials per 1 {unit}", { unit: line.unit })}
                                      </td>
                                      <td>
                                        {money(
                                          materialsRate(line.materialRows),
                                          quote.currency,
                                          locale,
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
                  {t("No items yet.")}{" "}
                  {onConfigure && (
                    <button onClick={() => onConfigure(room)}>
                      {t("Add items →")}</button>
                  )}
                </div>
              )}
              {!!lines.length && (
                <div className={s.roomTotal}>
                  <span>{t("{room} subtotal", { room })}</span>
                  <strong>
                    {money(
                      lines.filter((line) => !line.optional || selectedOptionIds.has(line.id)).reduce(
                        (sum, l) =>
                          sum + Math.round(l.quantity * l.rate * 100) / 100,
                        0,
                      ),
                      quote.currency,
                      locale,
                    )}
                  </strong>
                </div>
              )}
            </section>
          );
        })}
        <div className={s.summary}>
          <div>
            <span>{t("QUOTATION SUMMARY")}</span>
            <p>
              {t("{rooms} rooms · {items} items", { rooms: rooms.length, items: quote.lines.length })}</p>
          </div>
          <dl>
            <div>
              <dt>{t("Subtotal")}</dt>
              <dd>{money(totals.subtotal, quote.currency, locale)}</dd>
            </div>
            {quote.discount > 0 && (
              <div>
                <dt>{t("Discount")}</dt>
                <dd>−{money(quote.discount, quote.currency, locale)}</dd>
              </div>
            )}
            <div>
              <dt>
                {t("{label} ({rate}%)", { label: translateKnown(t, quote.cover?.taxLabel || "Tax"), rate: quote.taxRate })}
              </dt>
              <dd>{money(totals.tax, quote.currency, locale)}</dd>
            </div>
            <div className={s.grandTotal}>
              <dt>
                {t(quote.direction === "deduction" ? "Client credit" : quote.clientDecision?.decision === "accept" ? "Accepted total" : "Total")}
              </dt>
              <dd>{money(totals.total, quote.currency, locale)}</dd>
            </div>
          </dl>
        </div>
        {!!quote.paymentTerms?.length && (
          <section className={s.terms}>
            <h3>{t("Payment schedule")}</h3>
            <div className={s.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th>{t("Milestone")}</th>
                    <th>{t("When due")}</th>
                    <th>%</th>
                    <th>{t("Amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.paymentTerms.map((term, i) => (
                    <tr key={term.id}>
                      <td>
                        {term.title}
                        {term.requiredForRelease && <small>{t("Before project release")}</small>}
                        {term.requiredForProduction && <small>{t("Before manufacturing starts")}</small>}
                      </td>
                      <td>{term.trigger}</td>
                      <td>{term.percent}%</td>
                      <td>
                        {money(
                          paymentMilestoneAmounts(
                            quote.clientDecision?.acceptedTotal ?? totals.total,
                            quote.paymentTerms,
                            quote.currency,
                          )[i],
                          quote.currency,
                          locale,
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
            {t("{label} registration: {number}", { label: translateKnown(t, quote.cover.taxLabel || "Tax"), number: quote.cover.taxRegistration })}
          </p>
        )}
        {(
          [
            [tKey("Included"), "inclusions"],
            [tKey("Not included"), "exclusions"],
            [tKey("Terms & conditions"), "terms"],
          ] as const
        ).map(
          ([label, key]) =>
            quote[key] && (
              <section className={s.terms} key={key}>
                <h3>{t(label)}</h3>
                <p>{quote[key]}</p>
              </section>
            ),
        )}
        {(quote.cover?.signerName ||
          quote.cover?.signature ||
          quote.cover?.clientSignature) && (
          <section className={s.signatures} aria-label={t("Signatures")}>
            {(quote.cover.signerName || quote.cover.signature) && (
              <div>
                {quote.cover.signature && (
                  <img
                    src={quote.cover.signature}
                    alt={t("Authorized signatory signature")}
                  />
                )}
                <strong>{quote.cover.signerName}</strong>
                <span>{quote.cover.signerTitle || t("Authorized signatory")}</span>
              </div>
            )}
            {quote.cover.clientSignature && (
              <div>
                <span className={s.signatureLine} />
                <strong>{t("Client signature")}</strong>
                <span>{t("Name & date")}</span>
              </div>
            )}
          </section>
        )}
      </div>
    </article>
  );
}
