import { describe, expect, it } from "vitest";
import {
  assertValidIdempotencyKey,
  provisioningRequestHash,
} from "./provisioning-idempotency";

describe("provisioning idempotency", () => {
  it("hashes semantically identical object keys consistently", () => {
    expect(provisioningRequestHash({ owner: { email: "a@b.com", name: "A" }, slug: "a" }))
      .toBe(provisioningRequestHash({ slug: "a", owner: { name: "A", email: "a@b.com" } }));
  });

  it("requires a bounded opaque key", () => {
    expect(assertValidIdempotencyKey("portal:tenant-123")).toBe("portal:tenant-123");
    expect(() => assertValidIdempotencyKey("short")).toThrow(/Idempotency-Key/);
    expect(() => assertValidIdempotencyKey("contains spaces")).toThrow(/Idempotency-Key/);
  });
});
