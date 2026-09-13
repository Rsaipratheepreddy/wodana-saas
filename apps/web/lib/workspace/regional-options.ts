const ISO_COUNTRY_CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");

const FALLBACK_CURRENCIES = "AED AUD BHD CAD CHF CNY DKK EUR GBP HKD IDR INR JPY KRW KWD MYR NOK NZD OMR PHP PKR QAR SAR SEK SGD THB TRY USD ZAR".split(" ");

export type RegionalOption = { id: string; label: string };

function labelFor(code: string, type: "region" | "currency", locale = "en"): string {
  try {
    return new Intl.DisplayNames([locale], { type }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function countryOptions(locale = "en"): RegionalOption[] {
  const collator = new Intl.Collator(locale);
  return ISO_COUNTRY_CODES.map((code) => ({ id: code, label: `${labelFor(code, "region", locale)} · ${code}` }))
    .sort((a, b) => collator.compare(a.label, b.label));
}

export function currencyOptions(locale = "en"): RegionalOption[] {
  const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const codes = supportedValuesOf?.("currency") ?? FALLBACK_CURRENCIES;
  const collator = new Intl.Collator(locale);
  return codes.map((code) => ({ id: code, label: `${code} · ${labelFor(code, "currency", locale)}` }))
    .sort((a, b) => collator.compare(a.label, b.label));
}

export function timeZoneOptions(): RegionalOption[] {
  const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = supportedValuesOf?.("timeZone") ?? ["UTC", "Asia/Dubai", "Asia/Kolkata", "Europe/London", "America/New_York"];
  return ["UTC", ...zones.filter((zone) => zone !== "UTC")].map((zone) => ({ id: zone, label: zone.replaceAll("_", " ") }));
}

export const localeOptions: RegionalOption[] = [
  ["en-AE", "English (United Arab Emirates)"], ["ar-AE", "Arabic (United Arab Emirates)"],
  ["en-IN", "English (India)"], ["hi-IN", "Hindi (India)"], ["en-GB", "English (United Kingdom)"],
  ["en-US", "English (United States)"], ["en-AU", "English (Australia)"], ["en-CA", "English (Canada)"],
  ["ar-SA", "Arabic (Saudi Arabia)"], ["fr-FR", "French (France)"], ["de-DE", "German (Germany)"],
  ["es-ES", "Spanish (Spain)"], ["it-IT", "Italian (Italy)"], ["nl-NL", "Dutch (Netherlands)"],
  ["pt-BR", "Portuguese (Brazil)"], ["zh-CN", "Chinese (Simplified)"], ["ja-JP", "Japanese"],
].map(([id, label]) => ({ id, label }));
