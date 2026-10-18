import { Dec } from "./decimal";

export type AttributeType = "text" | "number" | "choice" | "multi_choice" | "color" | "boolean" | "dimension";
export type AttributeDefinition = { id: string; code: string; label: string; valueType: AttributeType; required: boolean; choices: Array<{ value: string; label: string }>; unitCode: string | null };

export class AttributeValueError extends Error {}

/** Normalizes one value to its stored text form, or explains why it is not allowed. */
export function normalizeAttributeValue(definition: AttributeDefinition, raw: unknown): string | null {
  const empty = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "") || (Array.isArray(raw) && raw.length === 0);
  if (empty) {
    if (definition.required) throw new AttributeValueError(`${definition.label} is required`);
    return null;
  }
  const allowed = new Set(definition.choices.map((choice) => choice.value));
  switch (definition.valueType) {
    case "text": {
      const text = String(raw).trim();
      if (text.length > 500) throw new AttributeValueError(`${definition.label} is too long`);
      return text;
    }
    case "number":
    case "dimension": {
      try {
        const value = Dec.of(typeof raw === "number" ? raw : String(raw));
        if (definition.valueType === "dimension" && value.cmp(0) <= 0) throw new AttributeValueError(`${definition.label} must be more than 0`);
        return value.toString();
      } catch (error) {
        if (error instanceof AttributeValueError) throw error;
        throw new AttributeValueError(`${definition.label} must be a number`);
      }
    }
    case "boolean":
      if (raw === true || raw === "true") return "true";
      if (raw === false || raw === "false") return "false";
      throw new AttributeValueError(`${definition.label} must be yes or no`);
    case "color": {
      const color = String(raw).trim().toUpperCase();
      if (!/^#[0-9A-F]{6}$/.test(color)) throw new AttributeValueError(`${definition.label} must be a colour like #1A2B3C`);
      return color;
    }
    case "choice": {
      const value = String(raw);
      if (!allowed.has(value)) throw new AttributeValueError(`${definition.label}: "${value}" is not one of the options`);
      return value;
    }
    case "multi_choice": {
      const values = (Array.isArray(raw) ? raw : String(raw).split(",")).map((value) => String(value).trim()).filter(Boolean);
      const unknown = values.find((value) => !allowed.has(value));
      if (unknown) throw new AttributeValueError(`${definition.label}: "${unknown}" is not one of the options`);
      return [...new Set(values)].join(",");
    }
  }
}

/** Every required attribute has a value; unknown attribute codes are rejected. */
export function normalizeAttributeValues(definitions: AttributeDefinition[], values: Record<string, unknown>) {
  const byCode = new Map(definitions.map((definition) => [definition.code, definition]));
  const unknown = Object.keys(values).find((code) => !byCode.has(code));
  if (unknown) throw new AttributeValueError(`Unknown attribute ${unknown}`);
  const result: Array<{ attributeId: string; value: string }> = [];
  for (const definition of definitions) {
    const value = normalizeAttributeValue(definition, values[definition.code]);
    if (value !== null) result.push({ attributeId: definition.id, value });
  }
  return result;
}
