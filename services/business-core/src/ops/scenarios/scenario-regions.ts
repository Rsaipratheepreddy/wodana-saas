import type { PoolClient } from "pg";
import { Dec } from "../../catalog-core/decimal";

/**
 * The people and places the demo scenarios use, per region pack (country code), so an organization's examples read as
 * its own country's: Indian clients in Indian cities for an IN organization, Emirati and expat clients in the emirates
 * for an AE one. Keyed by the region code only, never by a tenant. A region without its own set gets the international
 * one. Every client is fictional: their email is at example.com and their mobile is a zero-filled number in the
 * country's mobile range (see fictitiousMobile), with no messaging consent recorded.
 */

export type RegionPlace = {
  /** The area or neighbourhood, as typed on an enquiry. */
  area: string;
  /** The city, for site addresses. */
  city: string;
  /** The first address level (emirate, state…) as its name; matched against the workspace's region options. */
  region: string;
};

export type RegionFixture = {
  code: string;
  /**
   * A man's and a woman's name in turn, an even count: person n is a man for an even n and a woman for an odd one, so a
   * story whose wording says "she" picks an odd n.
   */
  firstNames: readonly string[];
  /** A count with no factor in common with 7 (see regionPerson), so every last name is used. */
  lastNames: readonly string[];
  places: readonly RegionPlace[];
  /**
   * What the scenarios' money is multiplied by, so a line priced at 1,000 in the base list reads as a realistic amount
   * in the region's currency (a wardrobe is about AED 14,500 or INR 2,90,000). A whole number: amounts stay exact.
   */
  priceScale: number;
  /** Property words for job titles ("Villa", "Apartment", "Flat"…). */
  homes: readonly string[];
};

const AE: RegionFixture = {
  code: "AE",
  firstNames: ["Hamdan", "Fatima", "Rashid", "Mariam", "Khalid", "Noor", "Omar", "Layla", "Yousef", "Aisha", "Saeed", "Huda", "Tariq", "Reem", "Hassan", "Dina",
    "Ahmed", "Shamma", "Faisal", "Maitha", "Arjun", "Elena", "James", "Sara"],
  lastNames: ["Al Mazrouei", "Al Shamsi", "Al Nuaimi", "Al Ketbi", "Al Falasi", "Al Hashimi", "Al Blooshi", "Al Zaabi", "Al Suwaidi", "Al Amiri", "Al Mehairi",
    "Al Marri", "Haddad", "Mansour", "Qureshi", "Farouk", "Menon", "Whitmore", "Petrova", "Khoury"],
  places: [
    { area: "Dubai Marina", city: "Dubai", region: "Dubai" },
    { area: "Jumeirah Village Circle", city: "Dubai", region: "Dubai" },
    { area: "Al Reem Island", city: "Abu Dhabi", region: "Abu Dhabi" },
    { area: "Saadiyat Island", city: "Abu Dhabi", region: "Abu Dhabi" },
    { area: "Al Barsha", city: "Dubai", region: "Dubai" },
    { area: "Mirdif", city: "Dubai", region: "Dubai" },
    { area: "Al Khan", city: "Sharjah", region: "Sharjah" },
    { area: "Business Bay", city: "Dubai", region: "Dubai" },
    { area: "Yas Island", city: "Abu Dhabi", region: "Abu Dhabi" },
    { area: "Dubai Hills Estate", city: "Dubai", region: "Dubai" },
    { area: "Al Majaz", city: "Sharjah", region: "Sharjah" },
    { area: "Al Raha Beach", city: "Abu Dhabi", region: "Abu Dhabi" },
  ],
  priceScale: 1,
  homes: ["Villa", "Apartment", "Townhouse", "Penthouse", "Office"],
};

const IN: RegionFixture = {
  code: "IN",
  firstNames: ["Aarav", "Priya", "Rohan", "Ananya", "Vikram", "Kavya", "Arjun", "Meera", "Siddharth", "Neha", "Karthik", "Divya", "Rahul", "Sneha", "Aditya",
    "Pooja", "Ishaan", "Lakshmi", "Varun", "Nandini", "Harsh", "Shreya", "Manish", "Tanvi"],
  lastNames: ["Sharma", "Iyer", "Reddy", "Patel", "Mehta", "Nair", "Kapoor", "Rao", "Gupta", "Menon", "Desai", "Banerjee", "Joshi", "Kulkarni", "Chatterjee",
    "Agarwal", "Pillai", "Bhatt", "Saxena", "Shetty"],
  places: [
    { area: "Bandra West", city: "Mumbai", region: "Maharashtra" },
    { area: "Koramangala", city: "Bengaluru", region: "Karnataka" },
    { area: "Jubilee Hills", city: "Hyderabad", region: "Telangana" },
    { area: "Anna Nagar", city: "Chennai", region: "Tamil Nadu" },
    { area: "DLF Phase 5", city: "Gurugram", region: "Haryana" },
    { area: "Whitefield", city: "Bengaluru", region: "Karnataka" },
    { area: "Powai", city: "Mumbai", region: "Maharashtra" },
    { area: "Vasant Kunj", city: "New Delhi", region: "Delhi" },
    { area: "Baner", city: "Pune", region: "Maharashtra" },
    { area: "Gachibowli", city: "Hyderabad", region: "Telangana" },
    { area: "Salt Lake", city: "Kolkata", region: "West Bengal" },
    { area: "Satellite", city: "Ahmedabad", region: "Gujarat" },
  ],
  priceScale: 20,
  homes: ["Villa", "Apartment", "Duplex", "Penthouse", "Office"],
};

const INTERNATIONAL: RegionFixture = {
  code: "*",
  firstNames: ["Alex", "Maya", "Daniel", "Chloe", "Samuel", "Grace", "Leo", "Isla", "Noah", "Zara", "Ethan", "Lina", "Oscar", "Nina", "Adam", "Sofia"],
  lastNames: ["Morgan", "Bennett", "Carter", "Hughes", "Foster", "Reyes", "Novak", "Larsen", "Okafor", "Tanaka", "Silva", "Kowalski", "Byrne", "Sato",
    "Moreau"],
  places: [
    { area: "Old Town", city: "City Centre", region: "" },
    { area: "Riverside", city: "City Centre", region: "" },
    { area: "Harbour District", city: "City Centre", region: "" },
    { area: "Garden Quarter", city: "City Centre", region: "" },
    { area: "Hillside", city: "City Centre", region: "" },
    { area: "Park View", city: "City Centre", region: "" },
    { area: "Lakeside", city: "City Centre", region: "" },
    { area: "Market Square", city: "City Centre", region: "" },
    { area: "University Quarter", city: "City Centre", region: "" },
    { area: "West End", city: "City Centre", region: "" },
    { area: "Canal Side", city: "City Centre", region: "" },
    { area: "Northgate", city: "City Centre", region: "" },
  ],
  priceScale: 1,
  homes: ["House", "Apartment", "Townhouse", "Penthouse", "Office"],
};

const FIXTURES: Record<string, RegionFixture> = { AE, IN };

/** The region's people and places; the international set for a region without its own. */
export function regionFixture(code: string | null | undefined): RegionFixture {
  return FIXTURES[(code ?? "").toUpperCase()] ?? INTERNATIONAL;
}

export type RegionPerson = { displayName: string; firstName: string; email: string; mobile: string; place: RegionPlace };

/**
 * The n-th fictional client of a region: a name from the region's lists (spread so neighbours differ), an example.com
 * address and a zero-filled mobile, both unique per n, and a place.
 */
export function regionPerson(fixture: RegionFixture, n: number, country: string | null | undefined): RegionPerson {
  const first = fixture.firstNames[n % fixture.firstNames.length];
  const last = fixture.lastNames[(n * 7 + 3) % fixture.lastNames.length];
  const displayName = `${first} ${last}`;
  const local = `${first}.${last}`.toLowerCase().normalize("NFKD").replace(/[^a-z0-9.]+/g, "");
  return { displayName, firstName: first, email: `${local}.${100 + n}@example.com`, mobile: fictitiousMobile(country, n), place: fixture.places[n % fixture.places.length] };
}

/**
 * The workspace's country for its examples: the region pack it was set up with, else its first company's country;
 * empty when it has neither (the international set then applies).
 */
export async function workspaceRegionCode(db: Pick<PoolClient, "query">, workspaceId: string): Promise<string> {
  const row = (await db.query<{ country: string | null }>(
    `SELECT coalesce((SELECT setup.region_code FROM workspace_setup_versions setup WHERE setup.workspace_id = workspace.id),
            (SELECT entity.country_code FROM legal_entities entity WHERE entity.workspace_id = workspace.id ORDER BY entity.created_at LIMIT 1)) AS country
       FROM workspaces workspace WHERE workspace.id = $1`, [workspaceId])).rows[0];
  return (row?.country ?? "").toUpperCase();
}

/**
 * A mobile number that is valid in the country's numbering plan but zero-filled, so it belongs to nobody in practice:
 * the first digits of the country's example mobile, zeros, and the scenario number in the last three digits (e.g.
 * +971500000107 in AE, +918100000107 in IN). Checked with the same library the app validates phones with; a country it
 * can't fill falls back to a zero-filled UK mobile.
 */
export function fictitiousMobile(country: string | null | undefined, n: number): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const phones = require("libphonenumber-js/max") as typeof import("libphonenumber-js/max");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const examples = require("libphonenumber-js/mobile/examples");
  const suffix = String(100 + (n % 900));
  const code = (country ?? "").toUpperCase();
  const candidates = [code, "GB"].filter((entry) => entry && phones.isSupportedCountry(entry)) as Array<import("libphonenumber-js/max").CountryCode>;
  for (const candidate of candidates) {
    const example = phones.getExampleNumber(candidate, examples);
    if (!example) continue;
    const national = String(example.nationalNumber);
    for (let keep = 2; keep < national.length - suffix.length; keep += 1) {
      const number = `+${example.countryCallingCode}${national.slice(0, keep)}${"0".repeat(national.length - keep - suffix.length)}${suffix}`;
      const parsed = phones.parsePhoneNumberFromString(number);
      if (parsed?.isValid() && ["MOBILE", "FIXED_LINE_OR_MOBILE"].includes(parsed.getType() ?? "")) return number;
    }
  }
  return `+4474000${suffix.padStart(5, "0")}`;
}

/** An amount from the base list in the region's money (exact: decimal strings, never floats). */
export function regionAmount(fixture: RegionFixture, base: string | number): string {
  return scaleAmount(base, fixture.priceScale);
}

/** An amount multiplied by a region's price scale, exactly (decimal strings, never floats). */
export function scaleAmount(base: string | number, priceScale: number): string {
  return Dec.of(String(base)).mul(priceScale).toFixed(2);
}
