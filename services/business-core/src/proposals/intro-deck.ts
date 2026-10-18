import { NotFoundException } from "@nestjs/common";
import { PDFDocument, rgb } from "pdf-lib";
import type { PoolClient } from "pg";
import { effectivePortalBrand } from "../commercial/effective-brand";
import { PdfText, cleanText, type TextWeight } from "./pdf-text";

type Db = Pick<PoolClient, "query">;

export type IntroFacts = {
  brand: { name: string; accent: string | null };
  title: string; reference: string | null; clientName: string; enquiryType: string | null; clientType: string | null;
  location: string | null; area: string | null; areaUnit: string | null; spaces: number | null; clientEmail: string | null; floorPlan: boolean;
  answers: Array<{ label: string; value: string }>;
};

/** A discovery answer as printable text: lists joined, choices by their label, yes/no spelled out. */
export function answerText(value: unknown, options?: Array<{ id: string; label: string }>): string {
  const label = (item: unknown) => options?.find((option) => option.id === item)?.label ?? String(item);
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(label).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.label === "string") return record.label;
    if (typeof record.name === "string") return record.name;
    return "";
  }
  return label(value).trim();
}

/** PLM-106: the opportunity's facts and discovery answers, as the intro deck's page 3 shows them. */
export async function introFacts(db: Db, workspaceId: string, opportunityId: string): Promise<IntroFacts> {
  const row = (await db.query<{ title: string; reference: string | null; clientName: string | null; enquiryType: string | null; clientType: string | null;
    area: string | null; areaUnit: string | null; spaces: number | null; location: string | null; clientEmail: string | null; floorPlan: boolean }>(
    `SELECT opportunity.title, opportunity.reference, party.display_name AS "clientName", enquiry.service_type AS "enquiryType", enquiry.details->>'customerType' AS "clientType",
            discovery.area::text AS area, discovery.area_unit AS "areaUnit", discovery.spaces, discovery.property_location AS location, discovery.client_email AS "clientEmail",
            discovery.floor_plan_asset_id IS NOT NULL AS "floorPlan"
       FROM crm_opportunities opportunity
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       LEFT JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = opportunity.workspace_id AND discovery.opportunity_id = opportunity.id
      WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, opportunityId])).rows[0];
  if (!row) throw new NotFoundException("Opportunity not found.");
  const questions = (await db.query<{ key: string; label: string; configuration: { options?: unknown } | null }>(
    `SELECT question.key, question.label, question.configuration FROM crm_qualification_forms form
       JOIN crm_qualification_questions question ON question.workspace_id = form.workspace_id AND question.form_id = form.id
      WHERE form.workspace_id = $1 AND form.purpose = 'discovery' AND form.status = 'active' AND (form.service_type IS NULL OR form.service_type = $2)
      ORDER BY (form.service_type IS NULL), question.position`, [workspaceId, row.enquiryType])).rows
    .filter((question, index, all) => all.findIndex((other) => other.key === question.key) === index);
  const values = new Map((await db.query<{ key: string; value: unknown }>(
    `SELECT question_key AS key, value FROM crm_opportunity_discovery_values WHERE workspace_id = $1 AND opportunity_id = $2`, [workspaceId, opportunityId])).rows.map((item) => [item.key, item.value]));
  const brand = await effectivePortalBrand(db, workspaceId);
  return {
    brand: { name: brand.name, accent: brand.primaryColor ?? null },
    title: row.title, reference: row.reference, clientName: row.clientName ?? row.title, enquiryType: row.enquiryType, clientType: row.clientType,
    location: row.location, area: row.area, areaUnit: row.areaUnit, spaces: row.spaces, clientEmail: row.clientEmail, floorPlan: row.floorPlan,
    answers: questions.map((question) => {
      const options = Array.isArray(question.configuration?.options)
        ? (question.configuration!.options as unknown[]).map((option) => (typeof option === "string" ? { id: option, label: option } : option as { id: string; label: string }))
        : undefined;
      return { label: question.label, value: answerText(values.get(question.key), options) };
    }).filter((answer) => answer.value),
  };
}

const humanise = (value: string | null) => (value ? value.replace(/[_-]+/g, " ").replace(/^\w/, (first) => first.toUpperCase()) : "");

/** Page 3 of the intro deck, filled in: a 16:9 page with the project's facts and the client's answers. */
export async function introPagePdf(facts: IntroFacts): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(cleanText(`${facts.clientName} · About your project`));
  document.setProducer(cleanText(facts.brand.name));
  const page = document.addPage([960, 540]);
  const t = await PdfText.embed(document);
  const match = /^#([0-9a-f]{6})$/i.exec(facts.brand.accent ?? "");
  const accent = match ? rgb(((Number.parseInt(match[1], 16) >> 16) & 255) / 255, ((Number.parseInt(match[1], 16) >> 8) & 255) / 255, (Number.parseInt(match[1], 16) & 255) / 255) : rgb(0.13, 0.14, 0.16);
  const ink = rgb(0.13, 0.14, 0.16), muted = rgb(0.42, 0.44, 0.48);
  // Wraps within [x, x + width]; a right-to-left value stays anchored at x, its lines aligned to their own end. Returns the baseline below it.
  const draw = (text: string, x: number, y: number, size: number, weight: TextWeight = "regular", color = ink, width = 400) =>
    t.paragraph(page, text, { x, y, width, size, weight, color, hug: true });
  page.drawRectangle({ x: 0, y: 532, width: 960, height: 8, color: accent });
  draw(facts.brand.name, 48, 492, 12, "bold", accent);
  draw("About your project", 48, 456, 26, "bold");
  draw(`${facts.clientName}${facts.reference ? ` · ${facts.reference}` : ""}`, 48, 428, 12, "regular", muted, 860);
  const rows: Array<[string, string]> = [
    ["Project", facts.title],
    ["Enquiry type", humanise(facts.enquiryType)],
    ["Client type", humanise(facts.clientType)],
    ["Location", facts.location ?? ""],
    ["Area", facts.area ? `${facts.area} ${facts.areaUnit === "sqm" ? "m²" : "sq ft"}` : ""],
    ["Spaces", facts.spaces ? String(facts.spaces) : ""],
    ["Floor plan", facts.floorPlan ? "Received" : "Not yet"],
    ["Email", facts.clientEmail ?? ""],
  ];
  let y = 384;
  for (const [label, value] of rows) {
    if (!value) continue;
    draw(label, 48, y, 9, "bold", muted, 120);
    y = Math.min(y - 18, draw(value, 160, y, 11, "regular", ink, 260)) - 4;
  }
  let right = 384;
  draw("What you told us", 480, 404, 12, "bold", accent);
  for (const answer of facts.answers) {
    if (right < 60) break;
    draw(answer.label, 480, right, 9, "bold", muted, 430);
    right = draw(answer.value, 480, right - 13, 11, "regular", ink, 430) - 8;
  }
  return document.save();
}
