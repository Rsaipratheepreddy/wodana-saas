import { regionFixture, regionPerson } from "../ops/scenarios/scenario-regions";

/**
 * The showcase's clients, in the workspace's own country. The showcase was written in the emirates, so an AE workspace
 * keeps that cast as written; any other region takes each client from its region fixture (the demo scenarios' people
 * and places, src/ops/scenarios/scenario-regions.ts): an Indian client in an Indian neighbourhood with an Indian mobile
 * for an IN workspace, the international set where a region has none. Keyed by the region code only, never by a tenant.
 */

export type ShowcaseCastKey = "demo" | "reem" | "haddad" | "faris" | "sofia" | "hessa" | "daniel" | "mariam" | "yusuf" | "aisha" | "nikolai" | "noura";

export type ShowcaseCastMember = {
  displayName: string;
  /** How the team greets them ("Hi Reem"). */
  firstName: string;
  /** How the team speaks of them ("with Reem", "with the Haddads"). */
  called: string;
  email: string;
  mobile: string;
  /** The area or neighbourhood, as typed on the enquiry. */
  area: string;
  /** The area as the team says it in passing ("Marina" for Dubai Marina); the area itself when there is no shorter name. */
  short: string;
  /** The first address level (emirate, state…), by the workspace's option id or its name. */
  region: string;
};

export type ShowcaseCast = {
  country: string;
  people: Record<ShowcaseCastKey, ShowcaseCastMember>;
  /** The formal room for receiving guests that one enquiry is about. */
  formalRoom: string;
  /** The season that enquiry wants it ready for. */
  season: string;
  /** What the showcase's amounts (written in the emirates' money) are multiplied by: the region fixture's priceScale. */
  priceScale: number;
};

const member = (displayName: string, firstName: string, email: string, mobile: string, area: string, extra: Partial<ShowcaseCastMember> = {}): ShowcaseCastMember =>
  ({ displayName, firstName, called: firstName, email, mobile, area, short: area, region: "dubai", ...extra });

/** The cast as the showcase was written, for a workspace in the emirates. */
const AE: ShowcaseCast = {
  country: "AE",
  people: {
    demo: member("Dana Demo", "Dana", "demo.client@example.test", "+971501234567", "Dubai Hills"),
    reem: member("Reem Al Marzouqi", "Reem", "reem.marzouqi@example.test", "+971502000002", "Dubai Marina", { short: "Marina" }),
    haddad: member("Omar and Layla Haddad", "Omar", "haddad.family@example.test", "+971553000003", "Arabian Ranches", { called: "the Haddads", short: "Ranches" }),
    faris: member("Faris Khoury", "Faris", "faris.khoury@example.test", "+971524000004", "Jumeirah Lake Towers", { short: "JLT" }),
    sofia: member("Sofia Bennett", "Sofia", "sofia.bennett@example.test", "+971565000005", "Emirates Hills"),
    hessa: member("Hessa Al Suwaidi", "Hessa", "hessa.suwaidi@example.test", "+971506000011", "Al Barari"),
    daniel: member("Daniel Okafor", "Daniel", "daniel.okafor@example.test", "+971506000012", "Downtown Dubai", { short: "Downtown" }),
    mariam: member("Mariam Haddad", "Mariam", "mariam.haddad@example.test", "+971506000013", "Mirdif"),
    yusuf: member("Yusuf Rahman", "Yusuf", "yusuf.rahman@example.test", "+971506000014", "Business Bay"),
    aisha: member("Aisha Karim", "Aisha", "aisha.karim@example.test", "+971506000015", "Jumeirah"),
    nikolai: member("Nikolai Petrov", "Nikolai", "nikolai.petrov@example.test", "+971506000016", "Palm Jumeirah"),
    noura: member("Noura Sabbagh", "Noura", "noura.sabbagh@example.test", "+971506000017", "Motor City"),
  },
  formalRoom: "majlis",
  season: "Ramadan",
  priceScale: regionFixture("AE").priceScale,
};

const WRITTEN: Record<string, ShowcaseCast> = { AE };

/**
 * Each client's person number in the region fixture: past the scenarios' own numbers (below 100), so nobody is both a
 * showcase and a scenario client; odd for the women and even for the men, as the fixture's first names alternate.
 * Stable: changing one makes a new client.
 */
const PERSON: Record<ShowcaseCastKey, number> = {
  demo: 101, reem: 103, haddad: 100, faris: 102, sofia: 105, hessa: 107, daniel: 104, mariam: 109, yusuf: 106, aisha: 111, nikolai: 108, noura: 113,
};

/** The showcase's clients for a workspace in this country (its region pack's code). */
export function showcaseCast(country: string | null | undefined): ShowcaseCast {
  const code = (country ?? "").toUpperCase();
  const written = WRITTEN[code];
  if (written) return written;
  const fixture = regionFixture(code);
  const people = Object.fromEntries((Object.keys(PERSON) as ShowcaseCastKey[]).map((key) => {
    const person = regionPerson(fixture, PERSON[key], code);
    const place = { area: person.place.area, short: person.place.area, region: person.place.region };
    // The demonstration client keeps their name and reserved address in every country; only the number is local.
    if (key === "demo") return [key, { ...AE.people.demo, ...place, mobile: person.mobile }];
    return [key, { displayName: person.displayName, firstName: person.firstName, called: person.firstName, email: person.email, mobile: person.mobile, ...place }];
  })) as Record<ShowcaseCastKey, ShowcaseCastMember>;
  return { country: code, people, formalRoom: "formal living room", season: "the festive season", priceScale: fixture.priceScale };
}
