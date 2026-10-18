import { UnprocessableEntityException } from "@nestjs/common";
import { PoolClient } from "pg";

/** Fixed enquiry fields that can be hidden. Name, mobile, region, enquiry type and source always show. */
export const OPTIONAL_ENQUIRY_FIELDS = ["email", "customerType", "area", "budgetRange", "summary", "projectType", "floorPlan"] as const;
/** Custom enquiry field types a capture form can ask for. */
export const ENQUIRY_FIELD_TYPES = ["text", "number", "date", "select", "multi_select"] as const;

export type EnquiryFieldDefinition = { id: string; label: string; dataType: string; configuration: Record<string, unknown>; visible: boolean };
export const customFieldRef = (id: string) => `cf:${id}`;
export const customFieldId = (field: string) => /^cf:[0-9a-f-]{36}$/.test(field) ? field.slice(3) : null;

export async function enquiryFieldDefinitions(client: PoolClient, workspaceId: string, ids?: string[]) {
  const result = await client.query<EnquiryFieldDefinition>(`SELECT id, label, data_type AS "dataType", configuration, visible
    FROM crm_custom_field_definitions WHERE workspace_id=$1 AND entity_type='enquiry' AND status='active'
      AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
    ORDER BY position, label`, [workspaceId, ids ?? null]);
  return result.rows;
}

export const fieldOptions = (definition: Pick<EnquiryFieldDefinition, "configuration">) =>
  (Array.isArray(definition.configuration?.options) ? definition.configuration.options : []).filter((value): value is string => typeof value === "string");

/** How a custom enquiry field is asked on a form: its question type and choices. */
export function questionShape(definition: EnquiryFieldDefinition) {
  const options = fieldOptions(definition).map(label => ({ id: label, label }));
  if (definition.dataType === "select") return { type: "dropdown", options };
  if (definition.dataType === "multi_select") return { type: "checkboxes", options };
  if (definition.dataType === "number") return { type: "number", options: [] };
  if (definition.dataType === "date") return { type: "date", options: [] };
  return { type: definition.configuration?.multiline === true ? "paragraph" : "text", options: [] };
}

/** Stores a submitted form's custom-field answers on the enquiry, one typed row per field. */
export async function writeEnquiryCustomValues(client: PoolClient, workspaceId: string, enquiryId: string, values: Record<string, string | string[]>) {
  const ids = Object.keys(values);
  if (!ids.length) return;
  const definitions = new Map((await enquiryFieldDefinitions(client, workspaceId, ids)).map(definition => [definition.id, definition]));
  for (const [id, value] of Object.entries(values)) {
    // A field removed after the form was published: the answer stays on the response only.
    const definition = definitions.get(id);
    if (!definition) continue;
    const typed = { text: null as string | null, number: null as string | null, timestamp: null as string | null, json: null as string | null };
    if (definition.dataType === "multi_select") typed.json = JSON.stringify(Array.isArray(value) ? value : [value]);
    else if (definition.dataType === "number") typed.number = String(value);
    // A calendar date, kept at UTC midnight so it reads back as the same day everywhere.
    else if (definition.dataType === "date") typed.timestamp = String(value);
    else typed.text = Array.isArray(value) ? value.join(", ") : value;
    await client.query(`INSERT INTO crm_custom_field_values (workspace_id, definition_id, entity_type, entity_id, value_text, value_number, value_timestamp, value_json)
      VALUES ($1,$2,'enquiry',$3,$4,$5::numeric,($6::date::timestamp AT TIME ZONE 'UTC'),$7::jsonb)
      ON CONFLICT (workspace_id, definition_id, entity_type, entity_id) DO UPDATE SET value_text=excluded.value_text, value_number=excluded.value_number,
        value_timestamp=excluded.value_timestamp, value_json=excluded.value_json, updated_at=now()`,
      [workspaceId, id, enquiryId, typed.text, typed.number, typed.timestamp, typed.json]);
  }
}

/** SQL for an enquiry's custom values as { definitionId: value } (dates as YYYY-MM-DD). */
export const enquiryCustomValuesSql = (workspace: string, enquiry: string) => `(SELECT COALESCE(jsonb_object_agg(value.definition_id,
    COALESCE(to_jsonb(value.value_text), to_jsonb(value.value_number), to_jsonb(to_char(value.value_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD')), value.value_json, to_jsonb(value.value_boolean))), '{}'::jsonb)
  FROM crm_custom_field_values value WHERE value.workspace_id=${workspace} AND value.entity_type='enquiry' AND value.entity_id=${enquiry})`;

/**
 * Checks staff-entered values for the workspace's own enquiry fields against each field's type and
 * choices. Blank values clear the field. Unknown or removed fields are rejected.
 */
export function normalizeCustomValues(definitions: EnquiryFieldDefinition[], input: Record<string, unknown>) {
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const set: Record<string, string | string[]> = {};
  const clear: string[] = [];
  for (const [id, raw] of Object.entries(input)) {
    const definition = byId.get(id);
    if (!definition) throw new UnprocessableEntityException("One of these fields no longer exists. Reload and try again");
    const blank = raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && !raw.length);
    if (blank) { clear.push(id); continue; }
    const choices = fieldOptions(definition);
    const fail = () => { throw new UnprocessableEntityException(`Enter a valid value for ${definition.label}`); };
    if (definition.dataType === "multi_select") { if (!Array.isArray(raw) || raw.some(item => typeof item !== "string" || !choices.includes(item))) fail(); set[id] = [...new Set(raw as string[])]; }
    else if (definition.dataType === "select") { if (typeof raw !== "string" || !choices.includes(raw)) fail(); set[id] = raw as string; }
    else if (definition.dataType === "number") { const value = typeof raw === "number" ? raw : Number(raw); if (!Number.isFinite(value) || Math.abs(value) > 1e15) fail(); set[id] = String(value); }
    else if (definition.dataType === "date") { if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) fail(); set[id] = raw as string; }
    else { if (typeof raw !== "string" || raw.trim().length > 10000) fail(); set[id] = (raw as string).trim(); }
  }
  return { set, clear };
}
