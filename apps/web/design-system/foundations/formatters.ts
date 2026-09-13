export type FormatContext = {
  locale?: string;
  currency?: string;
  timeZone?: string;
};

const defaults: Required<FormatContext> = {
  locale: "en-IN",
  currency: "INR",
  timeZone: "Asia/Kolkata",
};

export function formatMoney(value: number, context: FormatContext = {}) {
  const options = { ...defaults, ...context };
  return new Intl.NumberFormat(options.locale, {
    style: "currency",
    currency: options.currency,
    maximumFractionDigits: 2,
  }).format(value);
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
