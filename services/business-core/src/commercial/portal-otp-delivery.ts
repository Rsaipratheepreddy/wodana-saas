import { Logger, ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { deliveryAllowlist, NOT_ALLOWLISTED } from "../notifications/delivery-allowlist";
export async function deliverPortalOtp(
  config: ConfigService,
  workspaceId: string,
  challengeId: string,
  phone: string,
  code: string,
) {
  // Local and UAT: a number that isn't on DELIVERY_ALLOWLIST gets nothing (the email fallback is guarded too).
  if (!deliveryAllowlist(config).allowsPhone(phone)) {
    new Logger("PortalOtpDelivery").warn(`Portal code by WhatsApp suppressed (${NOT_ALLOWLISTED})`);
    throw new ServiceUnavailableException("WhatsApp could not accept the sign-in code. Please try again later or contact the project team.");
  }
  const base =
    config.get<string>("INTELLIGENCE_API_URL") ??
    "http://127.0.0.1:8001/api/v1";
  const token = config.get<string>("BUSINESS_CORE_INTERNAL_TOKEN");
  if (!token)
    throw new ServiceUnavailableException(
      "WhatsApp sign-in needs the configured delivery service.",
    );
  const response = await fetch(
    `${base.replace(/\/$/, "")}/integrations/providers/internal/portal-otp`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-wodana-internal-token": token,
      },
      body: JSON.stringify({ workspaceId, challengeId, phone, code }),
      signal: AbortSignal.timeout(15000),
    },
  ).catch(() => null);
  if (!response?.ok)
    throw new ServiceUnavailableException(
      "WhatsApp could not accept the sign-in code. Please try again later or contact the project team.",
    );
  const result = (await response.json()) as { id?: unknown; status?: unknown };
  if (
    typeof result.id !== "string" ||
    !result.id ||
    result.status !== "accepted"
  )
    throw new ServiceUnavailableException(
      "WhatsApp did not confirm the code delivery request.",
    );
}
