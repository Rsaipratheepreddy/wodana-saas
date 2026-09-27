import type { CSSProperties } from "react";

export const IDENTITY_VARIANT_COUNT = 6;

type IdentityImageOptions = {
  fit?: "contain" | "cover";
  surface?: "brand" | "neutral";
};

/** A consistent identity color across lists, profiles, navigation and messages. */
export function identityVariant(identity: string): number {
  const normalized = identity.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  let hash = 0;
  for (const character of normalized) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return hash % IDENTITY_VARIANT_COUNT;
}

export function identityStyle(identity: string, imageUrl?: string, options: IdentityImageOptions = {}): CSSProperties {
  if (imageUrl) return {
    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
    backgroundColor: options.surface === "brand"
      ? "var(--wd-workspace-brand-light-100, var(--wd-color-surface))"
      : "var(--wd-color-surface)",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: options.fit ?? "cover",
  };
  return {
    backgroundImage: "none",
    backgroundColor: `var(--wd-identity-color-${identityVariant(identity)})`,
    color: "var(--wd-identity-ink)",
  };
}

export function identityInitials(name: string): string {
  // Brackets, quotes and other marks never become an initial: "Sara (Account Manager)" is "SA".
  return name.trim().split(/\s+/u).map((part) => part.replace(/^[^\p{L}\p{N}]+/u, "")).filter(Boolean)
    .slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toUpperCase() || "?";
}
