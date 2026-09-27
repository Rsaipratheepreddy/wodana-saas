import { NextResponse } from "next/server";
import { getServerLanguage, getServerT } from "@/lib/i18n/server";

const COUNTRY_CODE = /^[A-Z]{2}$/;
const GEO_API = "https://countriesnow.space/api/v0.1/countries";

type CountriesNowResponse = {
  error?: boolean;
  data?: { states?: Array<{ name?: string; state_code?: string }> } | string[];
};

function countryName(code: string): string | null {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const t = await getServerT();
  const language = await getServerLanguage();
  const { searchParams } = new URL(request.url);
  const countryCode = (searchParams.get("countryCode") ?? "").trim().toUpperCase();
  const region = (searchParams.get("region") ?? "").trim();

  if (!COUNTRY_CODE.test(countryCode)) {
    return NextResponse.json({ message: t("A valid ISO country code is required.") }, { status: 400 });
  }
  if (region.length > 120) {
    return NextResponse.json({ message: t("The region name is too long.") }, { status: 400 });
  }

  const country = countryName(countryCode);
  if (!country) {
    return NextResponse.json({ message: t("The selected country is not supported.") }, { status: 400 });
  }

  const upstream = new URL(region ? `${GEO_API}/state/cities/q` : `${GEO_API}/states/q`);
  upstream.searchParams.set("country", country);
  if (region) upstream.searchParams.set("state", region);

  try {
    const response = await fetch(upstream, {
      headers: { accept: "application/json" },
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Geography provider returned ${response.status}.`);

    const payload = await response.json() as CountriesNowResponse;
    if (payload.error) throw new Error("Geography provider rejected the location lookup.");

    const names = region
      ? (Array.isArray(payload.data) ? payload.data : [])
      : (!Array.isArray(payload.data) ? payload.data?.states?.map((item) => item.name ?? "") ?? [] : []);
    const items = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, language))
      .map((name) => ({ id: name, label: name }));

    const result = NextResponse.json({ items });
    result.headers.set("cache-control", "public, max-age=3600, stale-while-revalidate=86400");
    return result;
  } catch {
    return NextResponse.json(
      { message: t("Location suggestions are temporarily unavailable.") },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
