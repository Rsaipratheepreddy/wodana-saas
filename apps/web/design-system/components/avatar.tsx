"use client";

/* eslint-disable @next/next/no-img-element */
import { useState, type HTMLAttributes, type ReactNode } from "react";
import { avatarPath, chosenAvatarKey, roleAvatarPath } from "@wodana/contracts/brand";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { identityInitials, identityStyle, identityVariant } from "@/lib/brand/identity";

const brightColors = [
  { backgroundColor: "#d9ecff", color: "#315e8f" },
  { backgroundColor: "#e9dfff", color: "#62438e" },
  { backgroundColor: "#ffebc9", color: "#87551f" },
  { backgroundColor: "#ffe2df", color: "#933f4b" },
  { backgroundColor: "#d7f4ff", color: "#255f78" },
  { backgroundColor: "#ffe2f1", color: "#8b3e69" },
] as const;

export type AvatarProps = {
  name: string;
  /** The person's own photo. It always wins. */
  src?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  colorVariant?: number;
  /** A picture the person chose from the set (`sales-m`); "auto" or anything else means their role's. */
  preset?: string | null;
  /** The person's id: picks the woman or man of the role avatar, stable for that person. */
  seed?: string;
  /** The person's workspace role codes; their main role chooses the avatar. Unknown roles use the default one. */
  roles?: ReadonlyArray<string> | null;
};

/**
 * A person or record. A person (anything with `seed`, `roles` or `preset`) shows their photo, else the
 * picture they chose, else the role avatar of their main role; initials show only while the picture
 * loads or if it fails. Records (a name alone) keep initials.
 */
export function Avatar({ name, src, size = "md", colorVariant, preset, seed, roles }: AvatarProps) {
  // The picture that failed to load, by URL, so a new photo or role avatar is tried again.
  const [failed, setFailed] = useState<string | null>(null);
  const isPerson = seed !== undefined || roles !== undefined || preset !== undefined;
  const photo = src && failed !== src ? src : null;
  const chosen = chosenAvatarKey(preset);
  const roleAvatar = !photo && isPerson ? (chosen ? avatarPath(chosen) : roleAvatarPath(roles, seed ?? name)) : null;
  const picture = photo ?? (roleAvatar && failed !== roleAvatar ? roleAvatar : null);
  const brightVariant = typeof colorVariant === "number" && Number.isFinite(colorVariant) ? ((Math.trunc(colorVariant) % brightColors.length) + brightColors.length) % brightColors.length : undefined;
  const fallbackStyle = brightVariant === undefined ? identityStyle(name) : brightColors[brightVariant];
  if (photo) return <span aria-label={name} className="wd-avatar" data-size={size} data-identity-variant={brightVariant ?? identityVariant(name)} role="img" style={{ background: "var(--wd-color-surface)" }}><img alt="" onError={() => setFailed(photo)} src={photo} /></span>;
  return <span aria-label={name} className="wd-avatar" data-role-avatar={picture ? "true" : undefined} data-size={size} data-identity-variant={brightVariant ?? identityVariant(name)} role="img" style={fallbackStyle}>
    <span aria-hidden="true" className="wd-avatar-initials">{identityInitials(name)}</span>
    {picture ? <img alt="" decoding="async" draggable={false} onError={() => setFailed(picture)} src={picture} /> : null}
  </span>;
}

const presenceLabels = { online: tKey("Online"), busy: tKey("Busy"), away: tKey("Away"), offline: tKey("Offline") } as const;
export function Persona({ description, name, presence, src, seed, roles }: { description?: ReactNode; name: string; presence?: "online" | "busy" | "away" | "offline"; src?: string; seed?: string; roles?: ReadonlyArray<string> | null }) {
  const t = useT();
  return <span className="wd-persona"><span className="wd-avatar-wrap"><Avatar name={name} roles={roles} seed={seed} src={src} />{presence ? <span aria-label={t(presenceLabels[presence])} className="wd-presence" data-presence={presence} role="img" /> : null}</span><span><strong>{name}</strong>{description ? <small>{description}</small> : null}</span></span>;
}

export function AvatarGroup({ children, label, ...props }: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  const t = useT();
  return <div {...props} aria-label={label ?? t("People")} className={["wd-avatar-group", props.className].filter(Boolean).join(" ")} role="group">{children}</div>;
}
