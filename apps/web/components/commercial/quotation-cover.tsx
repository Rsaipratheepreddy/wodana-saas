"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { SelectField, useDesignSystem } from "@/design-system";
import type { Quote, PortalBrand } from "@/lib/commercial/types";
import { quoteCurrencyChoices } from "@/lib/commercial/client";
import type { CSSProperties } from "react";
import { BrandLogo } from "./brand-logo";
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
  | "letterhead"
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
  const t = useT();
  const { locale, currency: workspaceCurrency } = useDesignSystem();
  const cover = quote.cover ?? {
    preparedFor: customerName,
    location: "",
    subtitle: t("Interior design & fit-out proposal"),
  };
  // The same quote number the team uses (Q-1), never a derived id.
  const reference = t("Q-{number}", { number: quote.number });
  const coverStyle = {
    "--quotation-cover-color": brand?.primaryColor || "#E4E3DE",
    ...(cover.banner
      ? { "--quotation-banner": `url("${cover.banner}")` }
      : {}),
  } as CSSProperties;
  return (
    <section
      className={s.cover}
      aria-label={t("Quotation cover")}
      data-editable={Boolean(onChange)}
      data-canvas={canvas || undefined}
      data-compact={compact || undefined}
      style={coverStyle}
    >
      <header className={s.top}>
        {cover.logo ? <div className={s.customLogo}><img src={cover.logo} alt={brand?.name || t('Company logo')}/>{brand?.name && <strong>{brand.name}</strong>}</div>
          // The issuing business's own logo and name (PLM-112), when it has a logo.
          : quote.letterhead?.logoUrl ? <div className={s.customLogo}><img src={quote.letterhead.logoUrl} alt={quote.letterhead.legalName}/><strong>{quote.letterhead.legalName}</strong></div> : brand ? (
          <BrandLogo brand={brand} />
        ) : (
          <strong>{t("Interior design studio")}</strong>
        )}
        <span>
          {t("Estimate proposal")}{" "}
          <b>
            {t("V{number} · {currency}", { number: quote.number, currency: quote.currency })}
          </b>
        </span>
      </header>
      <div className={s.main}>
        <span className={s.rule} />
        {onChange ? (
          <textarea
            className={s.title}
            rows={3}
            aria-label={t("Quotation title")}
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
            aria-label={t("Cover subtitle")}
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
        <span className={s.label}>{t("Prepared for")}</span>
        {onChange ? (
          <>
            <input
              className={s.clientName}
              aria-label={t("Prepared for")}
              maxLength={160}
              value={cover.preparedFor}
              placeholder={customerName}
              onChange={(e) =>
                onChange({ cover: { ...cover, preparedFor: e.target.value } })
              }
            />
            <input
              className={s.location}
              aria-label={t("Project location")}
              maxLength={300}
              value={cover.location}
              placeholder={t("Project location")}
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
          <span className={s.label}>{t("Quotation no.")}</span>
          <strong>{reference}</strong>
        </div>
        <div>
          <span className={s.label}>
            {t(quote.issuedAt ? "Issue date" : "Prepared on")}
          </span>
          <strong>
            {new Intl.DateTimeFormat(locale, {
              day: "2-digit",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            }).format(new Date(quote.issuedAt ?? quote.createdAt))}
          </strong>
        </div>
        <label>
          <span className={s.label}>{t("Valid until")}</span>
          {onChange ? (
            <input
              type="date"
              aria-label={t("Quotation valid until")}
              value={quote.validUntil}
              onChange={(e) => onChange({ validUntil: e.target.value })}
            />
          ) : (
            <strong>{/^\d{4}-\d{2}-\d{2}$/.test(quote.validUntil ?? "")
              ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${quote.validUntil}T00:00:00Z`))
              : quote.validUntil}</strong>
          )}
        </label>
        {onChange && (
          <div>
            <span className={s.label}>{t("Currency")}</span>
            <SelectField
              aria-label={t("Quotation currency")}
              label={<span className="wd-visually-hidden">{t("Quotation currency")}</span>}
              items={quoteCurrencyChoices(workspaceCurrency).map((c) => ({ id: c, label: c }))}
              selectedKey={quote.currency}
              onSelectionChange={(key) => key !== null && onChange({ currency: String(key) })}
            />
          </div>
        )}
      </footer>
    </section>
  );
}
