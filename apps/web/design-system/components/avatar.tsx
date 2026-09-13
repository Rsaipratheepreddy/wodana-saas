/* eslint-disable @next/next/no-img-element */
import type { HTMLAttributes, ReactNode } from "react";
import { identityInitials, identityStyle, identityVariant } from "@/lib/brand/identity";

export function Avatar({ name, src, size = "md" }: { name: string; src?: string; size?: "sm" | "md" | "lg" }) {
  return <span aria-label={name} className="wd-avatar" data-size={size} data-identity-variant={identityVariant(name)} role="img" style={src ? { background: "var(--wd-color-surface)" } : identityStyle(name)}>{src ? <img alt="" src={src} /> : identityInitials(name)}</span>;
}

export function Persona({ description, name, presence, src }: { description?: ReactNode; name: string; presence?: "online" | "busy" | "away" | "offline"; src?: string }) {
  return <span className="wd-persona"><span className="wd-avatar-wrap"><Avatar name={name} src={src} />{presence ? <span aria-label={`${presence} presence`} className="wd-presence" data-presence={presence} role="img" /> : null}</span><span><strong>{name}</strong>{description ? <small>{description}</small> : null}</span></span>;
}

export function AvatarGroup({ children, label = "People", ...props }: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return <div {...props} aria-label={label} className={["wd-avatar-group", props.className].filter(Boolean).join(" ")} role="group">{children}</div>;
}
