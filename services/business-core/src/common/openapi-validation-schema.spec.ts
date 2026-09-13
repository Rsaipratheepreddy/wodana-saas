import "reflect-metadata";
import { OpenAPIObject } from "@nestjs/swagger";
import { describe, expect, it } from "vitest";
import { CreateQueueDto } from "../crm/leads/dto/leads.dto";
import { enhanceOpenApiFromValidation } from "./openapi-validation-schema";

describe("OpenAPI validation schema enhancement", () => {
  it("documents validator-backed DTOs without duplicate property decorators", () => {
    expect(CreateQueueDto).toBeDefined();
    const document = {
      openapi: "3.0.0",
      info: { title: "test", version: "1" },
      paths: {},
      components: { schemas: { CreateQueueDto: { type: "object", properties: {} } } },
    } as OpenAPIObject;
    enhanceOpenApiFromValidation(document);
    const schema = document.components?.schemas?.CreateQueueDto;
    expect(schema && "$ref" in schema ? null : schema?.properties).toMatchObject({
      code: { type: "string", maxLength: 64 },
      name: { type: "string", maxLength: 160 },
      businessUnitId: { type: "string", format: "uuid" },
      isFallback: { type: "boolean" },
    });
    expect(schema && "$ref" in schema ? [] : schema?.required).toEqual(expect.arrayContaining(["code", "name"]));
    expect(schema && "$ref" in schema ? [] : schema?.required).not.toContain("businessUnitId");
  });
});
