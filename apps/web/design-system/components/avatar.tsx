/* eslint-disable @next/next/no-img-element */
import type { HTMLAttributes, ReactNode } from "react";
import { identityInitials, identityStyle, identityVariant } from "@/lib/brand/identity";
import { avatarPresetById, defaultAvatarPreset, type AvatarPreset } from "./avatar-presets";

const brightColors = [
  { backgroundColor: "#d9ecff", color: "#315e8f" },
  { backgroundColor: "#e9dfff", color: "#62438e" },
  { backgroundColor: "#ffebc9", color: "#87551f" },
  { backgroundColor: "#ffe2df", color: "#933f4b" },
  { backgroundColor: "#d7f4ff", color: "#255f78" },
  { backgroundColor: "#ffe2f1", color: "#8b3e69" },
] as const;

/** A drawn portrait from the default set. */
export function PresetPortrait({ preset }: { preset: AvatarPreset }) {
  return <svg aria-hidden="true" className="wd-avatar-portrait" focusable="false" viewBox="0 0 64 64">{preset.shapes.map(([Tag, attributes], index) => <Tag key={index} {...toReactAttributes(attributes)} />)}</svg>;
}

const toReactAttributes = (attributes: Record<string, string | number>) => Object.fromEntries(Object.entries(attributes).map(([key, value]) => [key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));

/**
 * A person or record. Photo first; otherwise people get a portrait
 * (`preset` = a chosen id, or "auto" for a stable default from `seed`),
 * and records keep initials.
 */
export function Avatar({ name, src, size = "md", colorVariant, preset, seed }: { name: string; src?: string | null; size?: "sm" | "md" | "lg" | "xl"; colorVariant?: number; preset?: string | null; seed?: string }) {
  const portrait = !src && preset ? avatarPresetById(preset) ?? defaultAvatarPreset(seed ?? name) : null;
  if (portrait) return <span aria-label={name} className="wd-avatar" data-portrait="true" data-size={size} role="img"><PresetPortrait preset={portrait} /></span>;
  const brightVariant = typeof colorVariant === "number" && Number.isFinite(colorVariant) ? ((Math.trunc(colorVariant) % brightColors.length) + brightColors.length) % brightColors.length : undefined;
  return <span aria-label={name} className="wd-avatar" data-size={size} data-identity-variant={brightVariant ?? identityVariant(name)} role="img" style={src ? { background: "var(--wd-color-surface)" } : brightVariant === undefined ? identityStyle(name) : brightColors[brightVariant]}>{src ? <img alt="" src={src} /> : identityInitials(name)}</span>;
}

export function Persona({ description, name, presence, src }: { description?: ReactNode; name: string; presence?: "online" | "busy" | "away" | "offline"; src?: string }) {
  return <span className="wd-persona"><span className="wd-avatar-wrap"><Avatar name={name} src={src} />{presence ? <span aria-label={`${presence} presence`} className="wd-presence" data-presence={presence} role="img" /> : null}</span><span><strong>{name}</strong>{description ? <small>{description}</small> : null}</span></span>;
}

export function AvatarGroup({ children, label = "People", ...props }: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return <div {...props} aria-label={label} className={["wd-avatar-group", props.className].filter(Boolean).join(" ")} role="group">{children}</div>;
}
