import { UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { MfaService } from "./mfa.service";

describe("MFA step-up", () => {
  it("answers a wrong or reused code as a wrong code, not as a signed-out session", async () => {
    const service = Object.create(MfaService.prototype) as MfaService & Record<string, unknown>;
    Object.assign(service, {
      database: { transaction: async (work: (client: unknown) => unknown) => work({}) },
      setActorContext: async () => undefined,
      verifyFactor: async () => ({ ok: false, locked: false }),
    });
    await expect(service.verifyForStepUp("user", "workspace", "123456")).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
