import type { CSSProperties } from "react";

export const WODDY_MARK_SRC = "/brand/wodana/woddy-mark-v4.png";
export const IDENTITY_VARIANT_COUNT = 6;

/** A consistent identity color across lists, profiles, navigation and messages. */
export function identityVariant(identity: string): number {
  const normalized = identity.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  let hash = 0;
  for (const character of normalized) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return hash % IDENTITY_VARIANT_COUNT;
}

export function identityStyle(identity: string, imageUrl?: string): CSSProperties {
  if (imageUrl) return {
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
    backgroundColor: "var(--wd-color-surface)",
    backgroundPosition: "center",
    backgroundSize: "cover",
  };
  return {
    backgroundImage: `var(--wd-identity-gradient-${identityVariant(identity)})`,
    backgroundColor: "var(--wd-identity-base)",
    color: "var(--wd-identity-ink)",
  };
}

export function identityInitials(name: string): string {
  return name.trim().split(/\s+/u).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toUpperCase() || "?";
}
