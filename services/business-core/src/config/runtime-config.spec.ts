import { describe, expect, it } from "vitest";
import { validateRuntimeConfig } from "./runtime-config";

describe("validateRuntimeConfig", () => {
  it("allows local development authentication", () => {
    expect(validateRuntimeConfig({ DATABASE_URL: "postgresql://local", AUTH_MODE: "development" }))
      .toMatchObject({ AUTH_MODE: "development" });
  });

  it("allows signed local authentication outside production", () => {
    expect(validateRuntimeConfig({
      DATABASE_URL: "postgresql://local",
      AUTH_MODE: "local",
      LOCAL_AUTH_JWT_SECRET: "a-local-secret-that-is-longer-than-32-characters",
    })).toMatchObject({ AUTH_MODE: "local" });
  });

  it("requires a strong local signing secret", () => {
    expect(() => validateRuntimeConfig({
      DATABASE_URL: "postgresql://local",
      AUTH_MODE: "local",
      LOCAL_AUTH_JWT_SECRET: "short",
    })).toThrow("LOCAL_AUTH_JWT_SECRET");
  });

  it("rejects development authentication in production", () => {
    expect(() => validateRuntimeConfig({
      DATABASE_URL: "postgresql://production",
      NODE_ENV: "production",
      AUTH_MODE: "development",
    })).toThrow("Production requires AUTH_MODE=password or AUTH_MODE=oidc");
  });

  it("allows production password login without enabling development authentication", () => {
    const config = {
      DATABASE_URL: "postgresql://production", NODE_ENV: "production", AUTH_MODE: "password",
      LOCAL_AUTH_JWT_SECRET: "a-production-password-secret-longer-than-32-characters",
      LOCAL_AUTH_ISSUER: "https://admin.example.com", LOCAL_AUTH_AUDIENCE: "wodana-web",
      BUSINESS_CORE_INTERNAL_TOKEN: "a-separate-internal-token-longer-than-32-characters",
      WODANA_RELEASE_ID: "test-release", INTELLIGENCE_API_URL: "http://intelligence:8001/api/v1",
    };
    expect(validateRuntimeConfig(config)).toMatchObject({ AUTH_MODE: "password" });
    expect(() => validateRuntimeConfig({ ...config, AUTH_MODE: "local" })).toThrow("Production requires");
    expect(() => validateRuntimeConfig({ ...config, LOCAL_AUTH_JWT_SECRET: "short" })).toThrow("LOCAL_AUTH_JWT_SECRET");
    expect(() => validateRuntimeConfig({ ...config, LOCAL_AUTH_ISSUER: "http://localhost" })).toThrow("LOCAL_AUTH_ISSUER");
    expect(() => validateRuntimeConfig({ ...config, LOCAL_AUTH_AUDIENCE: "" })).toThrow("LOCAL_AUTH_AUDIENCE");
    for (const flag of ["EXPOSE_DEMO_AUTH_TOKENS", "PORTAL_DEMO_OTP", "DEMO_TENANT_ENABLED"]) {
      expect(() => validateRuntimeConfig({ ...config, [flag]: "true" })).toThrow(flag);
    }
  });

  it("requires complete OIDC verification settings", () => {
    expect(() => validateRuntimeConfig({
      DATABASE_URL: "postgresql://production",
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      OIDC_ISSUER: "https://issuer.example.com",
    })).toThrow("OIDC_AUDIENCE is required");

    expect(validateRuntimeConfig({
      DATABASE_URL: "postgresql://production",
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      OIDC_ISSUER: "https://issuer.example.com",
      OIDC_AUDIENCE: "wodana-api",
      OIDC_JWKS_URI: "https://issuer.example.com/.well-known/jwks.json",
      BUSINESS_CORE_INTERNAL_TOKEN: "a-production-token-longer-than-thirty-two-characters",
      WODANA_RELEASE_ID: "test-release", INTELLIGENCE_API_URL: "http://intelligence:8001/api/v1",
    })).toMatchObject({ AUTH_MODE: "oidc" });
  });

  it("requires a strong internal service credential in production", () => {
    expect(() => validateRuntimeConfig({
      DATABASE_URL: "postgresql://production",
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      OIDC_ISSUER: "https://issuer.example.com",
      OIDC_AUDIENCE: "wodana-api",
      OIDC_JWKS_URI: "https://issuer.example.com/.well-known/jwks.json",
      BUSINESS_CORE_INTERNAL_TOKEN: "short",
      WODANA_RELEASE_ID: "test-release", INTELLIGENCE_API_URL: "http://intelligence:8001/api/v1",
    })).toThrow("BUSINESS_CORE_INTERNAL_TOKEN");
  });

  it("never permits the demo tenant in production", () => {
    expect(() => validateRuntimeConfig({
      DATABASE_URL: "postgresql://production",
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      OIDC_ISSUER: "https://issuer.example.com",
      OIDC_AUDIENCE: "wodana-api",
      OIDC_JWKS_URI: "https://issuer.example.com/.well-known/jwks.json",
      BUSINESS_CORE_INTERNAL_TOKEN: "a-production-token-longer-than-thirty-two-characters",
      WODANA_RELEASE_ID: "test-release", INTELLIGENCE_API_URL: "http://intelligence:8001/api/v1",
      DEMO_TENANT_ENABLED: "true",
    })).toThrow("DEMO_TENANT_ENABLED");
  });

  it("requires complete Mailgun credentials when transactional email is enabled", () => {
    expect(() => validateRuntimeConfig({
      DATABASE_URL: "postgresql://local",
      AUTH_MODE: "development",
      MAILGUN_API_KEY: "test-api-key",
    })).toThrow("MAILGUN_API_KEY and MAILGUN_DOMAIN");

    expect(validateRuntimeConfig({
      DATABASE_URL: "postgresql://local",
      AUTH_MODE: "development",
      MAILGUN_API_KEY: "test-api-key",
      MAILGUN_DOMAIN: "mg.example.com",
    })).toMatchObject({ MAILGUN_DOMAIN: "mg.example.com" });
  });

  it("requires HTTPS for the Mailgun endpoint in production", () => {
    expect(() => validateRuntimeConfig({
      DATABASE_URL: "postgresql://production",
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      OIDC_ISSUER: "https://issuer.example.com",
      OIDC_AUDIENCE: "wodana-api",
      OIDC_JWKS_URI: "https://issuer.example.com/.well-known/jwks.json",
      BUSINESS_CORE_INTERNAL_TOKEN: "a-production-token-longer-than-thirty-two-characters",
      WODANA_RELEASE_ID: "test-release", INTELLIGENCE_API_URL: "http://intelligence:8001/api/v1",
      MAILGUN_API_KEY: "test-api-key",
      MAILGUN_DOMAIN: "mg.example.com",
      MAILGUN_BASE_URL: "http://api.mailgun.test",
    })).toThrow("HTTPS MAILGUN_BASE_URL");
  });

});
