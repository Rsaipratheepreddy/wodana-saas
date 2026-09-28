import { describe, expect, it } from "vitest";
import { templatePlaceholders } from "./inbox-rules";
import { metaBodyProblem, sampleValues, STARTER_LANGUAGES, STARTER_PACK } from "./whatsapp-starter-pack";

describe("WhatsApp starter pack", () => {
  it("has one template per client event with unique Meta names", () => {
    expect(new Set(STARTER_PACK.map((template) => template.event)).size).toBe(STARTER_PACK.length);
    expect(new Set(STARTER_PACK.map((template) => template.name)).size).toBe(STARTER_PACK.length);
    for (const template of STARTER_PACK) expect(template.name).toMatch(/^[a-z][a-z0-9_]{0,511}$/);
  });

  it.each(STARTER_PACK.flatMap((template) => STARTER_LANGUAGES.map((language) => [template.key, language, template] as const)))("%s (%s) follows Meta's rules and maps every variable", (_key, language, template) => {
    const body = template.bodies[language];
    expect(metaBodyProblem(body, template.sources.length)).toBeNull();
    expect(templatePlaceholders(body)).toEqual(template.sources.map((_source, index) => index + 1));
  });

  it("refuses what Meta would reject", () => {
    expect(metaBodyProblem("{{1}}, your quote is ready", 1)).toMatch(/start or end/);
    expect(metaBodyProblem("Your quote is ready {{1}}", 1)).toMatch(/start or end/);
    expect(metaBodyProblem("Hi {{1}} and {{3}} here", 2)).toMatch(/numbered/);
    expect(metaBodyProblem("Hi {{1}} {{2}} ok", 2)).toMatch(/fixed text/);
  });

  it("gives Meta sample values in the workspace's currency and name", () => {
    const samples = sampleValues(STARTER_PACK.find((template) => template.key === "invoice_issued")!, { businessName: "Palm Studio", currency: "SAR", locale: "ar-SA", webOrigin: "https://studio.example/" });
    expect(samples[0]).toBe("Noura");
    expect(samples[2]).toMatch(/12,?٬?500|١٢٬٥٠٠/);
    expect(samples[3]).toBe("https://studio.example/portal");
  });
});
