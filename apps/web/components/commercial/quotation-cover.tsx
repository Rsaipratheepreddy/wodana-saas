"use client";

import type { Quote, PortalBrand } from "@/lib/commercial/types";
import type { CSSProperties } from "react";
import { BrandLogo } from "./portal-settings";
import s from "./quotation-cover.module.css";

type CoverQuote = Pick<
  Quote,
  | "id"
  | "number"
  | "title"
  | "cover"
  | "currency"
  | "validUntil"
  | "createdAt"
  | "issuedAt"
  | "brand"
>;

/** The same document cover is used in the editor, client preview and printed quotation. */
export function QuotationCover({
  quote,
  brand = quote.brand,
  customerName = "",
  onChange,
  canvas = false,
  compact = false,
}: {
  quote: CoverQuote;
  canvas?: boolean;
  compact?: boolean;
  brand?: PortalBrand;
  customerName?: string;
  onChange?: (patch: Partial<Quote>) => void;
}) {
  const cover = quote.cover ?? {
    preparedFor: customerName,
    location: "",
    subtitle: "Interior design & fit-out proposal",
  };
  const reference = `QT-${quote.id.slice(0, 8).toUpperCase()}`;
  return (
    <section
      className={s.cover}
      aria-label="Quotation cover"
      data-editable={Boolean(onChange)}
      data-canvas={canvas || undefined}
      data-compact={compact || undefined}
      style={cover.banner ? { '--quotation-banner': `url("${cover.banner}")` } as CSSProperties : undefined}
    >
      <header className={s.top}>
        {cover.logo ? <div className={s.customLogo}><img src={cover.logo} alt={brand?.name || 'Company logo'}/>{brand?.name && <strong>{brand.name}</strong>}</div> : brand ? (
          <BrandLogo brand={brand} />
        ) : (
          <strong>Interior design studio</strong>
        )}
        <span>
          Professional quotation{" "}
          <b>
            V{quote.number} · {quote.currency}
          </b>
        </span>
      </header>
      <div className={s.main}>
        <span className={s.rule} />
        {onChange ? (
          <textarea
            className={s.title}
            rows={3}
            aria-label="Quotation title"
            maxLength={240}
            value={quote.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
        ) : (
          <h1 className={s.title}>{quote.title}</h1>
        )}
        {onChange ? (
          <textarea
            className={s.subtitle}
            rows={2}
            aria-label="Cover subtitle"
            maxLength={500}
            value={cover.subtitle}
            onChange={(e) =>
              onChange({ cover: { ...cover, subtitle: e.target.value } })
            }
          />
        ) : (
          <p className={s.subtitle}>{cover.subtitle}</p>
        )}
      </div>
      <div className={s.prepared}>
        <span className={s.label}>Prepared for</span>
        {onChange ? (
          <>
            <input
              className={s.clientName}
              aria-label="Prepared for"
              maxLength={160}
              value={cover.preparedFor}
              placeholder={customerName}
              onChange={(e) =>
                onChange({ cover: { ...cover, preparedFor: e.target.value } })
              }
            />
            <input
              className={s.location}
              aria-label="Project location"
              maxLength={300}
              value={cover.location}
              placeholder="Project location"
              onChange={(e) =>
                onChange({ cover: { ...cover, location: e.target.value } })
              }
            />
          </>
        ) : (
          <>
            <strong className={s.clientName}>
              {cover.preparedFor || customerName}
            </strong>
            <span className={s.location}>{cover.location}</span>
          </>
        )}
      </div>
      <footer className={s.meta}>
        <div>
          <span className={s.label}>Quotation no.</span>
          <strong>{reference}</strong>
        </div>
        <div>
          <span className={s.label}>
            {quote.issuedAt ? "Issue date" : "Prepared on"}
          </span>
          <strong>
            {new Intl.DateTimeFormat("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            }).format(new Date(quote.issuedAt ?? quote.createdAt))}
          </strong>
        </div>
        <label>
          <span className={s.label}>Valid until</span>
          {onChange ? (
            <input
              type="date"
              aria-label="Quotation valid until"
              value={quote.validUntil}
              onChange={(e) => onChange({ validUntil: e.target.value })}
            />
          ) : (
            <strong>{quote.validUntil}</strong>
          )}
        </label>
        {onChange && (
          <label>
            <span className={s.label}>Currency</span>
            <select
              aria-label="Quotation currency"
              value={quote.currency}
              onChange={(e) => onChange({ currency: e.target.value })}
            >
              {["AED", "INR", "USD", "EUR", "GBP", "SAR", "QAR"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
      </footer>
    </section>
  );
}
