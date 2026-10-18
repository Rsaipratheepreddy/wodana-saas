import { RETURNING_SOURCE } from "../leads/repeat-rules";

type Option = { id: string; allowedRoles?: string[] | null };
type Choices = { sources: Option[]; channels: Record<string, Option[]> };

/**
 * PLM-036 / PLM-028: a shared form link or QR code can preset the enquiry's source and channel,
 * plus a placement name (e.g. showroom-door). Public input, so only an existing, unrestricted
 * source/channel pair is honoured; anything else falls back to the form's own defaults.
 */
export function resolveFormLink(choices: Choices, link: { source?: unknown; channel?: unknown; placement?: unknown } | undefined): { source?: string; channel?: string; placement?: string } | null {
  if (!link) return null;
  const source = typeof link.source === "string" ? link.source : "";
  const channel = typeof link.channel === "string" ? link.channel : "";
  const placement = typeof link.placement === "string" && /^[a-z0-9][a-z0-9-]{0,59}$/.test(link.placement) ? link.placement : undefined;
  const sourceOption = choices.sources.find((option) => option.id === source);
  // Role-limited (e.g. Self Generated), system-set (Returning Customer) and Referral (needs "Referred by") stay staff-only.
  const allowedSource = sourceOption && !(sourceOption.allowedRoles?.length) && source !== RETURNING_SOURCE && source !== "referral";
  const allowedChannel = allowedSource && (choices.channels[source] ?? []).some((option) => option.id === channel);
  if (!allowedSource || !allowedChannel) return placement ? { placement } : null;
  return { source, channel, ...(placement ? { placement } : {}) };
}
