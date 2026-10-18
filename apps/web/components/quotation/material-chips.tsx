"use client";
import { chipHue, Tag } from "@/design-system";

export type MaterialPart = { text: string; name: string; code: string };

/**
 * The materials written on a quotation line, one per " / " (or line): each one's name and its code, written after
 * " · " or in brackets ("Velvet · FB-102", "Velvet (FB-102)"). Fabric is a material like any other.
 */
export function materialParts(value: string | null | undefined): MaterialPart[] {
  return (value ?? "").split(/\s*\/\s*|\n+/).map((part) => part.trim()).filter(Boolean).map((text) => {
    const dot = text.indexOf(" · ");
    if (dot > 0) return { text, name: text.slice(0, dot).trim(), code: text.slice(dot + 3).trim() };
    const bracket = text.match(/^(.+?)\s*\(([^()]+)\)$/);
    return bracket ? { text, name: bracket[1].trim(), code: bracket[2].trim() } : { text, name: text, code: "" };
  });
}

/** How a material reads on its chip: the name, then its code. */
export const materialLabel = (part: MaterialPart) => (part.code ? `${part.name} · ${part.code}` : part.name);

/** A material as one chip; the same material keeps its colour on every line, whatever its code. */
export function MaterialChip({ part, onRemove }: { part: MaterialPart; onRemove?: () => void }) {
  return <Tag hue={chipHue(part.name.toLowerCase())} onRemove={onRemove}>{materialLabel(part)}</Tag>;
}

/** Every material on a line as its own chip (read only), or nothing when there is none. */
export function MaterialChips({ value, className }: { value: string | null | undefined; className?: string }) {
  const parts = materialParts(value);
  if (!parts.length) return null;
  return <span className={className} style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--wd-space-1)" }}>
    {parts.map((part) => <MaterialChip key={part.text} part={part} />)}
  </span>;
}
