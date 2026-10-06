import { describe, expect, it } from "vitest";
import { canvaLink } from "./canva";
import { extractProduct, pageText, parseDimensionText, parseLeadTimeText, priceNumber, validateClip } from "./product-extract";

const page = (head: string, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ld = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

describe("product page extraction", () => {
  it("prefers schema.org Product data over OpenGraph and page text", () => {
    const html = page(
      `<title>Shop | Sofa</title>
       <meta property="og:title" content="OG Sofa title"><meta property="product:price:amount" content="999"><meta property="product:price:currency" content="USD">
       <meta property="og:image" content="/img/og.jpg">
       ${ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, { "@type": "Product", name: "Halden 3-seat sofa", brand: { "@type": "Brand", name: "Nordli" }, sku: "HAL-3",
         color: "Moss", material: ["Oak", "Bouclé"], image: ["https://cdn.shop.example.com/a.jpg", { "@type": "ImageObject", url: "/b.jpg" }],
         width: { "@type": "QuantitativeValue", value: 228, unitCode: "CMT" }, depth: { "@type": "QuantitativeValue", value: 95, unitCode: "CMT" }, height: "82 cm",
         offers: { "@type": "Offer", price: "2450.00", priceCurrency: "aed", deliveryLeadTime: { "@type": "QuantitativeValue", maxValue: 6, unitCode: "WEE" } } }] })}`,
      "<p>Size: W 300 x D 100 x H 90 cm</p>");
    const result = extractProduct(html, "https://shop.example.com/p/halden");
    expect(Object.fromEntries(Object.entries(result.fields).map(([field, proposal]) => [field, [proposal!.value, proposal!.source]]))).toEqual({
      name: ["Halden 3-seat sofa", "structured_data"], brand: ["Nordli", "structured_data"], sku: ["HAL-3", "structured_data"], colour: ["Moss", "structured_data"],
      material: ["Oak, Bouclé", "structured_data"], price: ["2450", "structured_data"], currency: ["AED", "structured_data"], lead_time_days: ["42", "structured_data"],
      dimension_unit: ["cm", "structured_data"], width: ["228", "structured_data"], depth: ["95", "structured_data"], height: ["82", "structured_data"],
    });
    expect(result.fields.name!.confidence).toBe(0.95);
    expect(result.images).toEqual(["https://cdn.shop.example.com/a.jpg", "https://shop.example.com/b.jpg", "https://shop.example.com/img/og.jpg"]);
    expect(result.title).toBe("Shop | Sofa");
  });

  it("falls back to OpenGraph, then page text; mixed units come to millimetres", () => {
    const html = page(`<meta property="og:title" content="Rattan &amp; cane chair"><meta property="og:price:amount" content="1.299,00"><meta property="og:price:currency" content="EUR">
      ${ld({ "@type": "Product", width: { value: 0.6, unitCode: "MTR" }, depth: { value: 55, unitCode: "CMT" } })}`, "<div>Ships in 3–5 weeks.</div>");
    const result = extractProduct(html, "https://shop.example.com/chair");
    expect(result.fields.name).toMatchObject({ value: "Rattan & cane chair", source: "open_graph", confidence: 0.8 });
    expect(result.fields.price).toMatchObject({ value: "1299", source: "open_graph" });
    expect(result.fields.width).toMatchObject({ value: "600", source: "structured_data" });
    expect(result.fields.depth).toMatchObject({ value: "550" });
    expect(result.fields.dimension_unit!.value).toBe("mm");
    expect(result.fields.lead_time_days).toMatchObject({ value: "35", source: "page_text", confidence: 0.6, evidence: "Ships in 3–5 weeks" });
  });

  it("reads sizes from page text when nothing else has them", () => {
    const result = extractProduct(page("<title>Lamp</title>", "<li>Dimensions: 80\"W x 40\"D x 30\"H</li>"), "https://shop.example.com/lamp");
    expect([result.fields.width?.value, result.fields.depth?.value, result.fields.height?.value, result.fields.dimension_unit?.value]).toEqual(["80", "40", "30", "in"]);
    expect(result.fields.width?.source).toBe("page_text");
  });

  it("ignores broken JSON-LD and keeps at most six images", () => {
    const images = Array.from({ length: 9 }, (_, index) => `<meta property="og:image" content="https://cdn.example.com/${index}.jpg">`).join("");
    const result = extractProduct(page(`<script type="application/ld+json">{ broken</script>${images}`), "https://shop.example.com/x");
    expect(result.images).toHaveLength(6);
    expect(result.fields.name).toBeUndefined();
  });

  it("parses prices, sizes and lead times in the usual spellings", () => {
    expect(["1,299.00", "1.299,00", "AED 2 450", "12,5", "1.234.567", "x"].map(priceNumber)).toEqual(["1299", "1299", "2450", "12.5", "1234567", null]);
    expect(parseDimensionText("Width 200cm Depth 90cm Height 85cm")).toMatchObject({ width: "200", depth: "90", height: "85", unit: "cm" });
    expect(parseDimensionText("Overall 2000 x 900 x 850 mm")).toMatchObject({ width: "2000", depth: "900", height: "850", unit: "mm" });
    expect(parseDimensionText("no sizes here")).toBeNull();
    expect(parseLeadTimeText("Delivery: 10 working days")?.days).toBe("10");
    expect(parseLeadTimeText("Made to order, dispatched in 8 weeks")?.days).toBe("56");
  });

  it("strips scripts and styles from the page text", () => {
    expect(pageText("<style>.a{}</style><script>alert('x')</script><p>Oak&nbsp;veneer</p>")).toBe("Oak veneer");
  });
});

describe("AI fill (C3 provenance)", () => {
  const text = "Halden sofa. Frame: solid oak. Finish: matt lacquer. Overall W 228 x D 95 x H 82 cm. Lead time 6 weeks.";
  it("keeps only requested, well-formed fields quoted from the page, with capped confidence and the model", () => {
    const answer = { fields: {
      finish: { value: "Matt lacquer", confidence: 0.99, evidence: "Finish: matt lacquer" },
      material: { value: "Solid oak", confidence: 0.8, evidence: "Frame: solid oak" },
      width: { value: "228", confidence: 0.8, evidence: "W 228 x D 95" },
      dimension_unit: { value: "cm", confidence: 0.8, evidence: "H 82 cm" },
      price: { value: "3000", confidence: 0.9, evidence: "Price AED 3000" }, // not on the page: dropped
      colour: { value: "Green", confidence: 0.2, evidence: "Halden sofa" }, // too unsure: dropped
      lead_time_days: { value: "42", confidence: 0.7, evidence: "Lead time 6 weeks" },
      brand: { value: "X", confidence: 0.9, evidence: "Halden" }, // not requested: dropped
    } };
    const out = validateClip(answer, ["finish", "material", "width", "dimension_unit", "price", "colour", "lead_time_days"], text, "test-model");
    expect(Object.keys(out).sort()).toEqual(["dimension_unit", "finish", "lead_time_days", "material", "width"]);
    expect(out.finish).toEqual({ value: "Matt lacquer", source: "ai", confidence: 0.9, evidence: "Finish: matt lacquer", model: "test-model" });
  });
  it("drops sizes without a unit and rejects malformed answers", () => {
    expect(validateClip({ fields: { width: { value: "228", confidence: 0.8, evidence: "W 228" } } }, ["width", "dimension_unit"], text, "m")).toEqual({});
    expect(() => validateClip({ rows: [] }, ["width"], text, "m")).toThrow();
  });
});

describe("Canva links", () => {
  it("recognises design and share links and refuses look-alikes", () => {
    expect(canvaLink("https://www.canva.com/design/DAF1abcDEF/view?utm_content=x#top")).toEqual({ url: "https://www.canva.com/design/DAF1abcDEF/view?utm_content=x", designId: "DAF1abcDEF" });
    expect(canvaLink("https://canva.link/abc123")).toEqual({ url: "https://canva.link/abc123", designId: null });
    expect(canvaLink("https://studio.canva.site/moodboard")?.designId).toBeNull();
    for (const bad of ["http://www.canva.com/design/DAF1abcDEF/view", "https://canva.com.evil.example/design/DAF1abcDEF", "https://evilcanva.com/design/x", "https://user@www.canva.com/design/DAF1abcDEF", "nope"]) expect(canvaLink(bad)).toBeNull();
  });
});
