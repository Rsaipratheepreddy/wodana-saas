export type FormatContext = {
  locale?: string;
  currency?: string;
  timeZone?: string;
};

// Callers pass the workspace region (useDesignSystem()); these neutral values only apply when they do not.
const defaults: Required<FormatContext> = {
  locale: "en",
  currency: "USD",
  timeZone: "UTC",
};

/**
 * An amount in the workspace's currency and locale: the symbol where the locale puts it and the currency's own decimals
 * (2 for AED, 3 for KWD). A decimal string (money from the API) is formatted exactly, without going through a float.
 */
export function formatMoney(value: number | string, context: FormatContext = {}, format: Pick<Intl.NumberFormatOptions, "signDisplay"> = {}) {
  const options = { ...defaults, ...context };
  return new Intl.NumberFormat(options.locale, {
    style: "currency",
    currency: options.currency,
    ...format,
  }).format(value as number);
}

export function formatNumber(value: number, context: FormatContext = {}, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(context.locale ?? defaults.locale, options).format(value);
}

export function formatPercent(value: number, context: FormatContext = {}) {
  return new Intl.NumberFormat(context.locale ?? defaults.locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(
  value: Date | string | number,
  context: FormatContext = {},
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  return new Intl.DateTimeFormat(context.locale ?? defaults.locale, {
    ...options,
    timeZone: context.timeZone ?? defaults.timeZone,
  }).format(new Date(value));
}

export function formatRelativeTime(value: Date | string | number, context: FormatContext = {}, now = new Date()) {
  const delta = new Date(value).getTime() - now.getTime();
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["week", 604_800_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const [unit, size] = units.find(([, size]) => Math.abs(delta) >= size) ?? ["second", 1_000];
  return new Intl.RelativeTimeFormat(context.locale ?? defaults.locale, { numeric: "auto" }).format(
    Math.round(delta / size),
    unit,
  );
}

/**
 * A quantity as the API sends it (an exact decimal such as "24.0000") the way the locale writes it, without trailing
 * zeros: "24", "2.5", "1,250.75". Formatted from the decimal string, so nothing is rounded through a float.
 */
export function formatDecimal(value: string | number | null | undefined, context: FormatContext = {}, maximumFractionDigits = 4) {
  if (value === null || value === undefined || value === "") return "";
  try {
    return new Intl.NumberFormat(context.locale ?? defaults.locale, { maximumFractionDigits }).format(String(value) as unknown as number);
  } catch {
    return String(value);
  }
}

export function formatQuantity(value: number, unit: string, context: FormatContext = {}) {
  return `${formatNumber(value, context, { maximumFractionDigits: 2 })} ${unit}`;
}

export function formatMeasurement(
  value: number,
  unit: "millimeter" | "centimeter" | "meter" | "inch" | "foot",
  context: FormatContext = {},
) {
  return new Intl.NumberFormat(context.locale ?? defaults.locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: 2,
  }).format(value);
}

export function pluralize(count: number, forms: { one: string; other: string }, context: FormatContext = {}) {
  const rule = new Intl.PluralRules(context.locale ?? defaults.locale).select(count);
  return `${formatNumber(count, context)} ${rule === "one" ? forms.one : forms.other}`;
}
