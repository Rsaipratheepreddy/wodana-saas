import { tKey, type MessageKey } from "@/lib/i18n/keys";
import images from "./landing-images.json";

/**
 * Product screenshots on the public pages: real screens of a fictional demo workspace, each in the light theme and,
 * when captured, the dark one. The captures live in public/landing (`<name>.webp`, `<name>-dark.webp`); the page
 * serves only the static AVIF/WebP variants `npm run landing:images` pre-generates from them into public/landing/opt
 * (content-hashed names, listed in landing-images.json), so no image is resized at request time.
 * App screens are 390×844 at 3×, captured with a blank strip at the top and bottom for the drawn status bar and home
 * indicator (see devices.tsx); the same captures feed the store images (apps/mobile/scripts/store-images.mjs).
 */
export type Shot = { name: string; alt: MessageKey };

type Variant = { w: number; avif: string; webp: string };
type Entry = { width: number; height: number; light: Variant[]; dark?: Variant[] };
const IMAGES: Partial<Record<string, Entry>> = images;

const shot = (name: string, alt: MessageKey): Shot => ({ name, alt });
const phone = (name: string, alt: MessageKey): Shot => shot(`app-${name}`, alt);

export const SHOTS = {
  home: shot("home", tKey("Wodana home with the day's work across sales and projects")),
  pipeline: shot("pipeline", tKey("Enquiries on a sales board, by stage")),
  quotation: shot("quotation", tKey("A priced quotation with rooms and items")),
  plan: shot("project-plan", tKey("A project's tasks on a board, by status")),
  purchasing: shot("purchasing", tKey("Purchase orders with suppliers and delivery")),
  factory: shot("factory", tKey("Factory work orders by project")),
  portal: shot("client-portal", tKey("The client portal for one project")),
  appToday: phone("today", tKey("The mobile app: today's sites, tasks and deliveries")),
  appApprovals: phone("approvals", tKey("The mobile app: leave and check-ins to approve")),
  appReport: phone("daily-report", tKey("The mobile app: daily site report")),
  appInbox: phone("inbox", tKey("The mobile app: client chats in the inbox")),
  appMe: phone("me", tKey("The mobile app: profile and attendance")),
} satisfies Record<string, Shot>;

/** A screenshot shows only once its variants are generated, so the page never shows a broken image. */
export function shotReady(shot: Shot) {
  return Boolean(IMAGES[shot.name]);
}

const DARK = "(prefers-color-scheme: dark)";
const srcSet = (variants: Variant[], format: "avif" | "webp") => variants.map((variant) => `${variant[format]} ${variant.w}w`).join(", ");

export type PictureSource = { type: string; media?: string; srcSet: string };
/** Everything a `<picture>` needs: dark sources first (they only match a dark system), then light, AVIF before WebP. */
export type PictureData = { sources: PictureSource[]; src: string; width: number; height: number; sizes: string };

export function pictureOf(shot: Shot, sizes: string): PictureData | null {
  const entry = IMAGES[shot.name];
  if (!entry) return null;
  const sources: PictureSource[] = [];
  if (entry.dark?.length) {
    sources.push({ type: "image/avif", media: DARK, srcSet: srcSet(entry.dark, "avif") });
    sources.push({ type: "image/webp", media: DARK, srcSet: srcSet(entry.dark, "webp") });
  }
  sources.push({ type: "image/avif", srcSet: srcSet(entry.light, "avif") });
  sources.push({ type: "image/webp", srcSet: srcSet(entry.light, "webp") });
  // The fallback for browsers without <source> support: the middle WebP (1080 for desktop, 540 for phones).
  const fallback = entry.light[Math.floor(entry.light.length / 2)] ?? entry.light[0];
  return { sources, src: fallback?.webp ?? "", width: entry.width, height: entry.height, sizes };
}
