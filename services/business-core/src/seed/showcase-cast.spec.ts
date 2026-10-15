import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { describe, expect, it } from "vitest";
import { regionFixture, regionPerson } from "../ops/scenarios/scenario-regions";
import { regionOption, showcaseScript } from "./showcase";
import { showcaseCast, type ShowcaseCast } from "./showcase-cast";
import { showcaseChats } from "./showcase-inbox";

/** The emirates' places, numbers and words, which a workspace in another country must not see. */
const EMIRATES = /Dubai|Abu Dhabi|Jumeirah|Marina|Emirat|Sharjah|Ranches|Barari|Mirdif|Business Bay|Motor City|\bJLT\b|\+971|\bAED\b|majlis|Ramadan/i;

/** Every string a person reads in the showcase's records (ids, keys and references left out). */
function readable(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const entry of value) readable(entry, into);
  else if (value && typeof value === "object" && !(value instanceof RegExp))
    for (const [name, entry] of Object.entries(value)) if (!["key", "ns", "reference", "project", "on", "scenario", "template", "event"].includes(name)) readable(entry, into);
  return into;
}

/** Every client the showcase records: the stories' clients and the enquiries, with their place. */
function clients(cast: ShowcaseCast) {
  const script = showcaseScript(cast);
  return [...script.scenarios.map((story) => ({ ...story.client, area: story.area, emirate: story.emirate })), ...script.enquiries];
}

describe("the showcase's clients, in the workspace's country", () => {
  it("gives an India workspace Indian clients with Indian mobiles in Indian places, and nothing from the emirates", () => {
    const cast = showcaseCast("IN");
    const india = regionFixture("IN");
    const people = clients(cast);
    expect(people).toHaveLength(12);
    for (const person of people) {
      const phone = parsePhoneNumberFromString(person.mobile);
      expect(phone?.country, person.mobile).toBe("IN");
      expect(phone?.isValid(), person.mobile).toBe(true);
      expect(phone?.getType(), person.mobile).toBe("MOBILE");
      expect(india.places.map((place) => place.area)).toContain(person.area);
      expect(india.places.map((place) => place.region)).toContain(person.emirate);
    }
    // The fixture's people (the demonstration client keeps their name and reserved address everywhere).
    for (const person of people.filter((row) => row.displayName !== "Dana Demo")) {
      expect(india.firstNames).toContain(person.displayName.split(" ")[0]);
      expect(person.email).toMatch(/@example\.com$/);
    }
    expect(new Set(people.map((person) => person.mobile)).size).toBe(people.length);

    const text = readable({ script: showcaseScript(cast), chats: showcaseChats(cast) });
    expect(text.filter((line) => EMIRATES.test(line))).toEqual([]);
    const written = Object.values(showcaseCast("AE").people).filter((person) => person.displayName !== "Dana Demo").flatMap((person) => [person.displayName, person.firstName]);
    expect(text.filter((line) => written.some((name) => line.includes(name)))).toEqual([]);
  });

  it("keeps the showcase clients apart from the demo scenarios' clients", () => {
    for (const country of ["IN", "SG"]) {
      const scenarioPeople = Array.from({ length: 100 }, (_, n) => regionPerson(regionFixture(country), n, country));
      for (const person of clients(showcaseCast(country))) {
        expect(scenarioPeople.map((row) => row.email)).not.toContain(person.email);
        expect(scenarioPeople.map((row) => row.mobile)).not.toContain(person.mobile);
      }
    }
  });

  it("gives a region without its own people the international ones, with the country's own mobiles", () => {
    const people = clients(showcaseCast("SG"));
    expect(new Set(people.map((person) => person.displayName)).size).toBe(12);
    for (const person of people) expect(parsePhoneNumberFromString(person.mobile)?.country).toBe("SG");
    expect(readable(showcaseScript(showcaseCast("SG"))).filter((line) => EMIRATES.test(line))).toEqual([]);
  });

  it("keeps the showcase as it was written for a workspace in the emirates", () => {
    const cast = showcaseCast("AE");
    const script = showcaseScript(cast);
    expect(script.scenarios.map((story) => [story.title, story.area, story.emirate, story.client.displayName, story.client.email, story.client.mobile])).toEqual([
      ["Demo Client (Villa 12)", "Dubai Hills", "dubai", "Dana Demo", "demo.client@example.test", "+971501234567"],
      ["Marina Apartment 1804", "Dubai Marina", "dubai", "Reem Al Marzouqi", "reem.marzouqi@example.test", "+971502000002"],
      ["Arabian Ranches Townhouse 7", "Arabian Ranches", "dubai", "Omar and Layla Haddad", "haddad.family@example.test", "+971553000003"],
      ["JLT Office Fit-out", "Jumeirah Lake Towers", "dubai", "Faris Khoury", "faris.khoury@example.test", "+971524000004"],
      ["Emirates Hills Penthouse", "Emirates Hills", "dubai", "Sofia Bennett", "sofia.bennett@example.test", "+971565000005"],
    ]);
    expect(script.scenarios.find((story) => story.key === "jlt-office")?.approvers).toEqual([{ displayName: "Dana Demo", email: "demo.client@example.test", mobile: "+971501234567", demoCode: "123456", decides: true }]);
    expect(script.enquiries.map((enquiry) => [enquiry.displayName, enquiry.mobile, enquiry.area, enquiry.title, enquiry.summary])).toEqual([
      ["Hessa Al Suwaidi", "+971506000011", "Al Barari", "Al Barari villa · majlis and dining", "Wants a new majlis and dining room before Ramadan."],
      ["Daniel Okafor", "+971506000012", "Downtown Dubai", "Downtown apartment · living room refresh", "Sofa, rug, lighting and curtains for a one-bedroom apartment."],
      ["Mariam Haddad", "+971506000013", "Mirdif", "Mirdif townhouse · kitchen", "Replace the kitchen cabinets and worktop."],
      ["Yusuf Rahman", "+971506000014", "Business Bay", "Business Bay office · reception and boardroom", "Reception desk, boardroom table and acoustic panels."],
      ["Aisha Karim", "+971506000015", "Jumeirah", "Jumeirah villa · master suite", "Bedroom joinery, dressing room and bathroom vanity."],
      ["Nikolai Petrov", "+971506000016", "Palm Jumeirah", "Palm Jumeirah apartment · full fit-out", "Full fit-out of a three-bedroom apartment."],
      ["Noura Sabbagh", "+971506000017", "Motor City", "Motor City townhouse · study and guest room", "Study desk, shelving and a guest bed."],
    ]);
    expect(script.homeTasks.filter((task) => /Marina|Haddad|Reem/.test(task.title)).map((task) => task.title)).toEqual([
      "Sign off the Marina delivery plan", "Handover walk-through with the Haddads", "Weekly progress call with Reem", "Send the reading-light option to Reem"]);
    expect(script.followUps.map((item) => item.title)).toEqual([
      "Review the Penthouse quotation margin before it goes out", "Call Faris about the JLT decision", "Meet Yusuf Rahman at the Business Bay office",
      "Get the acoustic ceiling contractor's dates for JLT", "Book the Penthouse site visit with Sofia", "Send Hessa the majlis brochure",
      "Site visit at Emirates Hills with Sofia", "Showroom visit with Aisha Karim", "Walk the JLT office with Faris"]);
    const chats = showcaseChats(cast);
    expect(chats.map((chat) => [chat.client, chat.mobile])).toEqual([
      ["Hessa Al Suwaidi", "+971506000011"], ["Daniel Okafor", "+971506000012"], ["Mariam Haddad", "+971506000013"], ["Aisha Karim", "+971506000015"],
      ["Sofia Bennett", "+971565000005"], ["Omar and Layla Haddad", "+971553000003"], ["Faris Khoury", "+971524000004"], ["Nikolai Petrov", "+971506000016"]]);
    expect(chats[0]).toMatchObject({ subject: "Majlis and dining room", lines: [
      { text: "Hello! I saw your majlis project on Instagram. We want to redo the majlis and the dining room before Ramadan. Can you help?" }, {},
      { text: "The majlis is about 6 by 8 metres. Do you also do the curtains and the lighting?" }] });
  });

  it("matches a place's region to the workspace's option by id or by name", () => {
    const states = [{ id: "andhra_pradesh", label: "Andhra Pradesh" }, { id: "karnataka", label: "Karnataka" }, { id: "tamil_nadu", label: "Tamil Nadu" }];
    expect(regionOption(states, "Tamil Nadu")?.id).toBe("tamil_nadu");
    expect(regionOption(states, "karnataka")?.id).toBe("karnataka");
    expect(regionOption(states, "Nowhere")?.id).toBe("andhra_pradesh");
    expect(regionOption([{ id: "abu_dhabi" }, { id: "dubai" }], "dubai")?.id).toBe("dubai");
    expect(regionOption([], "dubai")).toBeUndefined();
  });
});
