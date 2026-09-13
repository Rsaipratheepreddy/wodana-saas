import { OpenAPIObject, SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { getMetadataStorage } from "class-validator";

interface ValidatorMetadata {
  constraints?: unknown[];
  each?: boolean;
  name?: string;
  propertyName: string;
  target: unknown;
}

interface ValidatorStorage {
  validationMetadatas: Map<unknown, ValidatorMetadata[]>;
}

function reflectedSchema(target: unknown, propertyName: string): SchemaObject {
  const constructor = typeof target === "function" ? target : null;
  const value = constructor ? Reflect.getMetadata("design:type", constructor.prototype, propertyName) as { name?: string } | undefined : undefined;
  if (value?.name === "String") return { type: "string" };
  if (value?.name === "Number") return { type: "number" };
  if (value?.name === "Boolean") return { type: "boolean" };
  if (value?.name === "Date") return { type: "string", format: "date-time" };
  if (value?.name === "Array") return { type: "array", items: {} };
  return { type: "object", additionalProperties: true };
}

/**
 * Nest's runtime Swagger scanner cannot infer undecorated DTO properties. The
 * validation decorators already carry the authoritative contract, so mirror
 * that metadata into OpenAPI instead of maintaining a second hand-written copy.
 */
export function enhanceOpenApiFromValidation(document: OpenAPIObject): OpenAPIObject {
  const schemas = document.components?.schemas;
  if (!schemas) return document;
  const storage = getMetadataStorage() as unknown as ValidatorStorage;
  for (const [target, metadata] of storage.validationMetadatas) {
    if (typeof target !== "function") continue;
    const schema = schemas[target.name];
    if (!schema || "$ref" in schema) continue;
    const objectSchema = schema as SchemaObject;
    objectSchema.type ??= "object";
    objectSchema.properties ??= {};
    const grouped = new Map<string, ValidatorMetadata[]>();
    for (const item of metadata) grouped.set(item.propertyName, [...(grouped.get(item.propertyName) ?? []), item]);
    const required = new Set(objectSchema.required ?? []);
    for (const [propertyName, validators] of grouped) {
      const property = { ...reflectedSchema(target, propertyName), ...(objectSchema.properties[propertyName] as SchemaObject | undefined ?? {}) };
      const names = new Set(validators.map((item) => item.name));
      const constraint = (name: string) => validators.find((item) => item.name === name)?.constraints;
      if (names.has("isString")) property.type = "string";
      if (names.has("isBoolean")) property.type = "boolean";
      if (names.has("isInt")) property.type = "integer";
      if (names.has("isNumber")) property.type = "number";
      if (names.has("isArray")) { property.type = "array"; property.items ??= {}; }
      if (names.has("isObject")) { property.type = "object"; property.additionalProperties ??= true; }
      if (names.has("isUuid")) { property.type = "string"; property.format = "uuid"; }
      if (names.has("isEmail")) { property.type = "string"; property.format = "email"; }
      if (names.has("isDateString") || names.has("isISO8601")) { property.type = "string"; property.format = "date-time"; }
      const allowedValidator = validators.find((item) => item.name === "isIn");
      const allowed = allowedValidator?.constraints?.[0];
      if (Array.isArray(allowed)) {
        if (allowedValidator?.each && property.type === "array") property.items = { ...(property.items as SchemaObject), enum: allowed };
        else property.enum = allowed;
      }
      const maxLength = constraint("maxLength")?.[0];
      if (typeof maxLength === "number") property.maxLength = maxLength;
      const minLength = constraint("minLength")?.[0];
      if (typeof minLength === "number") property.minLength = minLength;
      const length = constraint("isLength");
      if (typeof length?.[0] === "number") property.minLength = length[0];
      if (typeof length?.[1] === "number") property.maxLength = length[1];
      const minimum = constraint("min")?.[0];
      if (typeof minimum === "number") property.minimum = minimum;
      const maximum = constraint("max")?.[0];
      if (typeof maximum === "number") property.maximum = maximum;
      const pattern = constraint("matches")?.[0];
      if (pattern instanceof RegExp) property.pattern = pattern.source;
      objectSchema.properties[propertyName] = property;
      if (!names.has("isOptional")) required.add(propertyName);
    }
    objectSchema.required = [...required];
  }
  return document;
}
