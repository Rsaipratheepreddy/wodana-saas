import type { DocumentStyleId } from "./types";

/**
 * The designed looks for a client quotation. Each is a small set of choices — faces, paper and ink,
 * where the accent shows, the cover layout and the table style — applied as CSS variables on the
 * document. "brand" uses the firm's own colour (tenant branding) as the accent.
 */
export type DocumentStyle = {
  id: DocumentStyleId; name: string; mood: string;
  heading: "serif" | "display" | "sans" | "geometric"; body: "sans" | "serif";
  headingCase: "none" | "upper"; headingWeight: number;
  paper: string; ink: string; muted: string; line: string; accent: string | "brand";
  coverPaper: string; coverInk: string; cover: "split" | "centered" | "band" | "frame" | "full" | "block";
  table: "lines" | "zebra" | "boxed";
};

export const DOCUMENT_STYLES: DocumentStyle[] = [
  { id: "atelier", name: "Atelier", mood: "Warm, crafted, serif", heading: "serif", body: "sans", headingCase: "none", headingWeight: 500, paper: "#f6f1e9", ink: "#2b2622", muted: "#7a6f64", line: "#e3d9cb", accent: "#8a6a4b", coverPaper: "#efe7da", coverInk: "#2b2622", cover: "split", table: "lines" },
  { id: "minimal", name: "Minimal", mood: "Clean white, quiet type", heading: "sans", body: "sans", headingCase: "none", headingWeight: 600, paper: "#ffffff", ink: "#141414", muted: "#6b6b6b", line: "#e8e8e8", accent: "brand", coverPaper: "#ffffff", coverInk: "#141414", cover: "centered", table: "lines" },
  { id: "noir", name: "Noir", mood: "Dark cover, gold detail", heading: "display", body: "sans", headingCase: "none", headingWeight: 600, paper: "#ffffff", ink: "#161616", muted: "#6e6a63", line: "#e6e1d8", accent: "#b8964e", coverPaper: "#141414", coverInk: "#f4efe6", cover: "full", table: "lines" },
  { id: "terrazzo", name: "Terrazzo", mood: "Terracotta and warm white", heading: "geometric", body: "sans", headingCase: "upper", headingWeight: 600, paper: "#fbf6f2", ink: "#2e2420", muted: "#8a7568", line: "#efe1d6", accent: "#c0654a", coverPaper: "#f3e5dc", coverInk: "#2e2420", cover: "band", table: "zebra" },
  { id: "nordic", name: "Nordic", mood: "Cool grey, light and airy", heading: "sans", body: "sans", headingCase: "none", headingWeight: 500, paper: "#f7f8f8", ink: "#1f2a30", muted: "#6b7a82", line: "#e1e6e8", accent: "#6b8a99", coverPaper: "#e9eef0", coverInk: "#1f2a30", cover: "frame", table: "lines" },
  { id: "botanical", name: "Botanical", mood: "Sage, calm, natural", heading: "serif", body: "sans", headingCase: "none", headingWeight: 600, paper: "#f4f6f1", ink: "#22301f", muted: "#6c7a67", line: "#dde4d6", accent: "#6f8b6a", coverPaper: "#e3eadc", coverInk: "#22301f", cover: "split", table: "zebra" },
  { id: "coastal", name: "Coastal", mood: "Sand and deep navy", heading: "display", body: "sans", headingCase: "none", headingWeight: 600, paper: "#f7f3ec", ink: "#1d2b44", muted: "#6a7488", line: "#e6ded0", accent: "#2f5d8a", coverPaper: "#1d2b44", coverInk: "#f7f3ec", cover: "band", table: "lines" },
  { id: "monochrome", name: "Monochrome", mood: "Strict black-and-white grid", heading: "geometric", body: "sans", headingCase: "upper", headingWeight: 700, paper: "#ffffff", ink: "#000000", muted: "#555555", line: "#d9d9d9", accent: "#000000", coverPaper: "#ffffff", coverInk: "#000000", cover: "frame", table: "boxed" },
  { id: "heritage", name: "Heritage", mood: "Ivory, deep green, classic", heading: "display", body: "serif", headingCase: "none", headingWeight: 600, paper: "#faf7ef", ink: "#1e2b26", muted: "#6f7a70", line: "#e7e0cd", accent: "#a88b4a", coverPaper: "#1e3b32", coverInk: "#f3ecd9", cover: "full", table: "lines" },
  { id: "linen", name: "Linen", mood: "Soft taupe, light type", heading: "sans", body: "sans", headingCase: "none", headingWeight: 400, paper: "#f8f6f2", ink: "#3a332d", muted: "#8a7f75", line: "#e8e2da", accent: "#7c6f64", coverPaper: "#f0ebe4", coverInk: "#3a332d", cover: "centered", table: "zebra" },
  { id: "studio", name: "Studio", mood: "Bold colour block in your brand", heading: "geometric", body: "sans", headingCase: "none", headingWeight: 700, paper: "#ffffff", ink: "#161616", muted: "#666666", line: "#ececec", accent: "brand", coverPaper: "#ffffff", coverInk: "#161616", cover: "block", table: "boxed" },
  { id: "marble", name: "Marble", mood: "White stone, fine serif", heading: "serif", body: "sans", headingCase: "none", headingWeight: 500, paper: "#fafafa", ink: "#262626", muted: "#7a7a7a", line: "#e6e6e6", accent: "#8c8c8c", coverPaper: "#f2f2f2", coverInk: "#262626", cover: "centered", table: "lines" },
];

const FACE: Record<DocumentStyle["heading"], string> = {
  serif: "var(--font-cormorant), Georgia, serif",
  display: "var(--font-playfair), Georgia, serif",
  sans: "var(--font-inter), Arial, sans-serif",
  geometric: "var(--font-montserrat), Arial, sans-serif",
};

/** The CSS variables a document uses for one style (and the firm's brand colour where the style asks for it). */
export function documentVariables(style: DocumentStyle, brandColor: string, accentOverride: string | null) {
  const accent = accentOverride ?? (style.accent === "brand" ? brandColor : style.accent);
  return {
    "--doc-paper": style.paper, "--doc-ink": style.ink, "--doc-muted": style.muted, "--doc-line": style.line, "--doc-accent": accent,
    "--doc-cover-paper": style.cover === "block" ? accent : style.coverPaper, "--doc-cover-ink": style.cover === "block" ? "#ffffff" : style.coverInk,
    "--doc-heading": FACE[style.heading], "--doc-body": style.body === "serif" ? FACE.serif : FACE.sans,
    "--doc-heading-weight": String(style.headingWeight), "--doc-heading-case": style.headingCase === "upper" ? "uppercase" : "none",
    "--doc-heading-spacing": style.headingCase === "upper" ? "0.08em" : "0",
  } as Record<string, string>;
}

export const styleById = (id: DocumentStyleId) => DOCUMENT_STYLES.find((style) => style.id === id) ?? DOCUMENT_STYLES[0];
