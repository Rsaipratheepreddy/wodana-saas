"use client";
import { Pencil, Plus, ShieldCheck } from "lucide-react";
import type { Quote, QuoteLine, PortalBrand } from "@/lib/commercial/types";
import { acceptedQuoteTotals, money, quoteTotals, paymentMilestoneAmounts } from "@/lib/commercial/client";
import { quotationDescription } from "@/lib/commercial/presentation";
import { QuotationCover } from "./quotation-cover";
import { BrandLogo } from "./brand-logo";
import { LetterheadFooter, LetterheadHeader } from "../documents/document-letterhead";
import d from "./quotation-studio.module.css";
import {isReferenceLayout,referenceItemGroups} from '@/lib/commercial/quotation-reference-template';
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translatorFor, type Translate } from "@/lib/i18n/keys";
import { Button, formatDate, useDesignSystem } from "@/design-system";

export type DocumentPage = {
  id: string;
  kind: "cover" | "room" | "summary" | "payments" | "terms" | "acceptance" | "custom";
  title: string;
  room?: string;
  lines?: QuoteLine[];
};
export function quotationPages(q: Quote, t: Translate = translatorFor({})): DocumentPage[] {
  const pages: DocumentPage[] = [
    { id: "cover", kind: "cover", title: t("Cover") },
  ];
  const reference=isReferenceLayout(q.presentation?.template);
  const groups=reference?referenceItemGroups(q.lines):Array.from({length:Math.max(1,Math.ceil(q.lines.length/3))},(_,index)=>({start:index*3,count:3}));
  for (const {start,count} of groups)
    pages.push({
      id: `items:${start}`,
      kind: isReferenceLayout(q.presentation?.template)?"custom":"room",
      title: start ? t("Scope & Items · {number}", { number: groups.findIndex(group=>group.start===start)+1 }) : t("Scope & Items"),
      lines: q.lines.slice(start, start + count),
    });
  const all: DocumentPage[] = [
    ...pages,
    { id: "summary", kind: "summary", title: t("Summary") },
    { id: "payments", kind: "payments", title: t("Payment schedule") },
    { id: "terms", kind: "terms", title: t("Terms & scope") },
    { id: "acceptance", kind: "acceptance", title: t("Acceptance") },
    ...(q.presentation?.pages.filter(page => page.kind === "custom" && !page.id.startsWith("items:") && !["cover","summary","payments","terms","acceptance"].includes(page.id)).map(page => ({ id: page.id, kind: "custom" as const, title: page.title || t("Custom page") })) ?? []),
  ];
  const rendered = all.map(page => q.presentation?.pages.some(override => override.id === page.id && override.kind === "custom") ? { ...page, kind: "custom" as const } : page);
  const ordered = q.presentation?.pageOrder
    ? q.presentation.pageOrder.flatMap(id => id === "scope" ? rendered.filter(page => page.id.startsWith("items:")) : rendered.filter(page => page.id === id))
    : rendered;
  return ordered.filter(page=>!q.presentation?.hiddenPages?.includes(page.id)&&!(page.id.startsWith("items:")&&q.presentation?.hiddenPages?.includes("scope"))).map((page,index)=>reference?{...page,title:page.id.startsWith('items:')?t('Scope & Items'):t('Page {number}',{number:index+1})}:page);
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
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
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
      aria-label={t("{title} document page", { title: page.title })}
    >
      <header className={d.documentHeader}>
        {/* The issuing business's letterhead (PLM-112), else the brand. */}
        <LetterheadHeader letterhead={quote.letterhead} fallback={brand ? <BrandLogo brand={brand} /> : <strong>{t("Quotation")}</strong>} />
        <span>
          {t("QUOTATION")}<strong>{t("Q-{number}", { number: quote.number })}</strong>
          <small>{t("Version {number}", { number: quote.number })}</small>
        </span>
      </header>
      <div className={d.documentBody}>
        <span className={d.eyebrow}>
          {t(page.kind === "room"
            ? "Estimate proposal · item schedule"
            : "Your project, clearly defined")}
        </span>
        <h2>{page.title}</h2>
        {page.kind === "room" && (
          <>
            <div className={d.roomCaption}>
              <span>
                {t(page.lines?.length === 1 ? "{count} item · {currency}" : "{count} items · {currency}", { count: page.lines?.length ?? 0, currency: quote.currency })}
              </span>
              {!preview && (
                <Button size="compact" onPress={() => onAdd(page.lines?.[0]?.room ?? "General")}>
                  <Plus size={13} />
                  {t("Add item")}
                </Button>
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
                  <th>{t("SN")}</th>
                  <th>{t("Description of item")}</th>
                  <th>{t("Inspiration")}</th>
                  <th>{t("Length")}</th>
                  <th>{t("Height")}</th>
                  <th>{t("Depth")}</th>
                  <th>{t("Materials requested")}</th>
                  <th>{t("Qty")}</th>
                  <th>{t("Unit price")}</th>
                  <th>{t("Total amount")}</th>
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
                        <Button size="compact"
                          className={d.documentItem}
                          aria-label={t("Edit {title}", { title: line.title })}
                          onPress={() => onSelect(line.id)}
                        >
                          <strong>{line.title}</strong>
                          <Pencil size={12} />
                        </Button>
                      )}
                      {line.optional ? <small>{t(selectedOptionIds.has(line.id) ? "Selected option · included in accepted total" : "Option · not included in total")}</small> : null}
                      {line.variant ? <small>{line.variant}</small> : null}
                      <small>{line.room}</small>
                    </td>
                    <td>{line.photo ? <img className={d.itemImage} src={line.photo} alt={t("Inspiration for {title}", { title: line.title })} /> : <span>—</span>}</td>
                    <td>{line.dimensions?.length != null ? t("L {value} {unit}", { value: line.dimensions.length, unit: line.dimensions.unit }) : "—"}</td>
                    <td>{line.dimensions?.height != null ? t("H {value} {unit}", { value: line.dimensions.height, unit: line.dimensions.unit }) : "—"}</td>
                    <td>{line.dimensions?.depth != null ? t("D {value} {unit}", { value: line.dimensions.depth, unit: line.dimensions.unit }) : "—"}</td>
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
                        {quotationDescription(line) || t("As specified")}
                      </div>
                      {!preview && (
                        <Button size="compact"
                          className={d.editMaterial}
                          aria-label={t("Edit material for {title}", { title: line.title })}
                          onPress={() => onSelect(line.id, true)}
                        >
                          <Pencil size={11} />
                          {t("Edit materials")}
                        </Button>
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
                {t("Add the first quoted item from the Items view.")}
              </p>
            )}
            <div className={d.roomTotal}>
              <span>
                {t(quote.lines.length !== page.lines?.length
                  ? "Items subtotal · all item pages"
                  : "Items subtotal")}
              </span>
              <strong>
                {money(
                  quoteTotals({ ...quote, discount: 0, taxRate: 0, lines: quote.lines.map(line => line.optional && selectedOptionIds.has(line.id) ? {...line, optional:false} : line) }).total,
                  quote.currency,
                  locale,
                )}
              </strong>
            </div>
          </>
        )}
        {page.kind === "summary" && (
          <>
            <p className={d.documentIntro}>
              {t("The investment for your space, room by room.")}
            </p>
            <table className={d.documentTable}>
              <thead>
                <tr>
                  <th>{t("Room")}</th>
                  <th>{t("Items")}</th>
                  <th>{t("Amount")}</th>
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
                        locale,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className={d.documentTotals}>
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
                <dt>{t("Tax · {rate}%", { rate: quote.taxRate })}</dt>
                <dd>{money(totals.tax, quote.currency, locale)}</dd>
              </div>
              <div>
                <dt>
                  {t(quote.direction === "deduction"
                    ? "Client credit"
                    : quote.status === "accepted" ? "Accepted total" : "Quotation total")}
                </dt>
                <dd>{money(totals.total, quote.currency, locale)}</dd>
              </div>
            </dl>
          </>
        )}
        {page.kind === "payments" &&
          (quote.direction === "deduction" ? (
            <p>{t("Client credit · {amount}", { amount: money(totals.total, quote.currency, locale) })}</p>
          ) : (
            <>
              <p className={d.documentIntro}>
                {t("Payments are linked to the agreed milestones below.")}
              </p>
              <table className={d.documentTable}>
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
                        <strong>{term.title || t("Milestone")}</strong>
                        {term.requiredForRelease && (
                          <small>{t("Before project release")}</small>
                        )}
                        {term.requiredForProduction && (
                          <small>{t("Before manufacturing starts")}</small>
                        )}
                      </td>
                      <td>{term.trigger}</td>
                      <td>{term.percent}%</td>
                      <td>
                        {money(
                          paymentMilestoneAmounts(totals.total, quote.paymentTerms, quote.currency)[i],
                          quote.currency,
                          locale,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!quote.paymentTerms.length && (
                <p className={d.emptyDocument}>
                  {t("No payment schedule added yet.")}
                </p>
              )}
            </>
          ))}
        {page.kind === "terms" && (
          <div className={d.documentTerms}>
            {([
              [tKey("Included"), quote.inclusions],
              [tKey("Excluded"), quote.exclusions],
              [tKey("Terms & conditions"), quote.terms],
            ] as const).map(([label, content]) => (
              <section key={label}>
                <h3>{t(label)}</h3>
                <p>{content || "—"}</p>
              </section>
            ))}
          </div>
        )}
        {page.kind === "acceptance" && (
          <>
            <p className={d.documentIntro}>
              {t("Review the scope, selected materials, prices and payment schedule before confirming this version.")}
            </p>
            <div className={d.acceptance}>
              <ShieldCheck size={28} />
              <h3>
                {t(quote.status === "accepted"
                  ? "Quotation accepted"
                  : "Client acceptance")}
              </h3>
              <p>
                {quote.status === "accepted"
                  ? quote.decidedAt
                    ? t("Accepted by {name} on {date}.", { name: quote.decidedBy ?? t("the client"), date: formatDate(quote.decidedAt, { locale, timeZone }, { dateStyle: "short" }) })
                    : t("Accepted by {name}.", { name: quote.decidedBy ?? t("the client") })
                  : t("Your client can approve this quotation or request changes through the client portal after it is issued.")}
              </p>
              <strong>{money(quote.clientDecision?.acceptedTotal ?? totals.total, quote.currency, locale)}</strong>
            </div>
          </>
        )}
      </div>
      <footer className={d.documentFooter}>
        <span>
          {quote.letterhead?.legalName ?? brand?.name} · {quote.cover?.preparedFor || customerName}
        </span>
        <span>
          {String(pageIndex + 1).padStart(2, "0")} /{" "}
          {String(pageCount).padStart(2, "0")}
        </span>
      </footer>
      <LetterheadFooter letterhead={quote.letterhead} />
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
  const { locale } = useDesignSystem();
  const formatted = new Intl.NumberFormat(locale, {
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
