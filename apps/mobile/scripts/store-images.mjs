#!/usr/bin/env node
// Store listing images for the Wodana app, generated from real app screens (no hand-made mock-ups):
//   App Store: 6.7-inch (1290×2796) and 6.5-inch (1242×2688), five each.
//   Google Play: five phone screenshots (1080×1920) and the feature graphic (1024×500).
// Each image is a headline on the brand green with a phone drawn in SVG around a screen captured from the app
// (the landing page's app screens in apps/web/public/landing: 390×844 at 3×, fictional demo workspace, with blank
// strips for the status bar and home indicator that the phone draws on). No Apple or Google artwork is used.
//   Usage: npm run store:images   (writes apps/mobile/store/…)
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, "..");
const repo = join(mobile, "..", "..");
const sharp = createRequire(join(repo, "package.json"))("sharp");
const fonts = createRequire(join(mobile, "package.json"));
const INTER_BOLD = fonts.resolve("@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf");
const INTER_MEDIUM = fonts.resolve("@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf");
const INTER_SEMIBOLD = fonts.resolve("@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf");
const SCREENS = join(repo, "apps", "web", "public", "landing");
const LOGO = join(repo, "apps", "web", "public", "brand", "logo", "wodana-logo-dark.svg");
const OUT = join(mobile, "store");

// Brand colours: the logo's greens and the neutral hardware tones used by the web mock-ups.
const GREEN_DEEP = "#0B4F24";
const GREEN = "#107A34";
const GREEN_BRIGHT = "#01A92D";
const INK = "#171717";

/** The five screens, in store order, with their headline (line breaks chosen by hand) and one supporting line. */
const SLIDES = [
  { screen: "today", title: "Your day on site,\nat a glance", line: "Sites, tasks, follow-ups and deliveries for today" },
  { screen: "approvals", title: "Approve leave and\ncheck-ins on the go", line: "Everything waiting for you in one list" },
  { screen: "daily-report", title: "Send the daily\nreport in minutes", line: "Trades, work done, photos, weather and safety" },
  { screen: "inbox", title: "Answer clients\nfrom anywhere", line: "Client chats in one shared inbox" },
  { screen: "me", title: "Check in with a\nphoto and location", line: "Attendance, leave and your documents" },
];

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Text rendered by Pango with the app's own typeface (Inter), as a transparent PNG. */
async function text(content, { size, fontfile, weight, width, color = "#ffffff", align = "center", tracking = 0, lineHeight = 1.12 }) {
  const markup = `<span foreground="${color}" letter_spacing="${Math.round(tracking * size * 1024)}" line_height="${lineHeight}">${escape(content)}</span>`;
  return sharp({ text: { text: markup, font: `Inter ${weight} ${size}`, fontfile, width, align, rgba: true, dpi: 72, wrap: "word" } })
    .png().toBuffer();
}

/** Signal, Wi-Fi and battery, the same glyphs the web mock-up draws (viewBox 68×14). */
const GLYPHS = `<rect height="4" rx="1" width="3" x="0" y="9"/><rect height="6.5" rx="1" width="3" x="4.5" y="6.5"/>
  <rect height="9" rx="1" width="3" x="9" y="4"/><rect height="11.5" rx="1" width="3" x="13.5" y="1.5"/>
  <path d="M31 12.6 28.4 10a3.7 3.7 0 0 1 5.2 0L31 12.6Zm-4.3-4.3-1.6-1.6a8.3 8.3 0 0 1 11.8 0l-1.6 1.6a6 6 0 0 0-8.6 0Zm-3.3-3.3L21.8 3.4a13 13 0 0 1 18.4 0L38.6 5a10.7 10.7 0 0 0-15.2 0Z"/>
  <rect fill="none" height="11" rx="3.2" stroke="${INK}" stroke-opacity="0.4" stroke-width="1" width="23" x="42.5" y="1.5"/>
  <rect height="8" rx="1.8" width="17" x="44.5" y="3"/><path d="M67 5.5v3.6c.8-.3 1.3-1 1.3-1.8s-.5-1.5-1.3-1.8Z" opacity="0.45"/>`;

/**
 * A phone around one screen, the same geometry as the web's CSS mock-up (apps/web/components/landing/devices.module.css):
 * every measure is a share of the phone's width W. Returns a transparent PNG and its size.
 */
async function phone(kind, width, screenFile) {
  const u = width / 100;
  const iphone = kind === "iphone";
  const rim = (iphone ? 1.3 : 1) * u;
  const bezel = (iphone ? 2.6 : 2.3) * u;
  const screenW = width - 2 * (rim + bezel);
  const screenH = screenW * 844 / 390;
  const height = screenH + 2 * (rim + bezel);
  const button = 0.9 * u;
  const pad = Math.ceil(button + 2 * u);
  const canvasW = Math.ceil(width + 2 * pad);
  const canvasH = Math.ceil(height + 2 * pad);
  const x0 = pad, y0 = pad;
  const sx = x0 + rim + bezel, sy = y0 + rim + bezel;
  const radius = { body: (iphone ? 16.6 : 11.5) * u, bezel: (iphone ? 15.3 : 10.5) * u, screen: (iphone ? 12.7 : 8.2) * u };
  const frame = iphone
    ? `<linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#d4d4d4"/><stop offset="0.14" stop-color="#616161"/><stop offset="0.38" stop-color="#a3a3a3"/>
        <stop offset="0.64" stop-color="#404040"/><stop offset="0.86" stop-color="#a3a3a3"/><stop offset="1" stop-color="#616161"/></linearGradient>`
    : `<linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#616161"/><stop offset="0.3" stop-color="#252525"/><stop offset="0.7" stop-color="#333333"/><stop offset="1" stop-color="#616161"/></linearGradient>`;
  const side = (x, top, length, color = "#767676") => `<rect x="${x}" y="${y0 + top * u}" width="${button + 0.3 * u}" height="${length * u}" rx="${0.6 * u}" fill="${color}"/>`;
  const buttons = iphone
    ? side(x0 - button, 38, 7) + side(x0 - button, 56.5, 12.6) + side(x0 - button, 75.6, 12.6) + side(x0 + width - 0.3 * u, 61, 24)
    : side(x0 + width - 0.3 * u, 50, 14, "#404040") + side(x0 + width - 0.3 * u, 72, 29, "#404040");
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
    <defs>${frame}</defs>
    ${buttons}
    <rect x="${x0}" y="${y0}" width="${width}" height="${height}" rx="${radius.body}" fill="url(#rim)"/>
    <rect x="${x0 + 0.35 * u}" y="${y0 + 0.35 * u}" width="${width - 0.7 * u}" height="${height - 0.7 * u}" rx="${radius.body - 0.35 * u}" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="${0.35 * u}"/>
    <rect x="${x0 + rim}" y="${y0 + rim}" width="${width - 2 * rim}" height="${height - 2 * rim}" rx="${radius.bezel}" fill="#0b0b0b"/>
  </svg>`;

  const screen = await sharp(screenFile).resize(Math.round(screenW), Math.round(screenH), { fit: "cover", position: "top" })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(screenW)}" height="${Math.round(screenH)}"><rect width="100%" height="100%" rx="${radius.screen}" fill="#fff"/></svg>`), blend: "dest-in" }])
    .png().toBuffer();

  // Status bar, island or camera, home indicator and a faint reflection, drawn over the screen.
  const islandW = 29.5 * u;
  const earW = (screenW - islandW) / 2;
  const glyphH = 3.1 * u;
  const glyphW = glyphH * 68 / 14;
  const glyphX = iphone ? sx + screenW - earW / 2 - glyphW / 2 : sx + screenW - 5.5 * u - glyphW;
  const glyphY = iphone ? sy + 6.8 * u - glyphH / 2 : sy + 4.2 * u - glyphH / 2;
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">
    <defs><linearGradient id="glare" x1="0" y1="0" x2="1" y2="0.55">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="0.3" stop-color="#ffffff" stop-opacity="0.05"/><stop offset="0.44" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>
    ${iphone
      ? `<rect x="${sx + screenW / 2 - islandW / 2}" y="${sy + 2.5 * u}" width="${islandW}" height="${8.6 * u}" rx="${4.3 * u}" fill="#0b0b0b"/>`
      : `<circle cx="${sx + screenW / 2}" cy="${sy + 4.3 * u}" r="${1.9 * u}" fill="#0b0b0b"/><circle cx="${sx + screenW / 2 - 0.5 * u}" cy="${sy + 3.8 * u}" r="${0.5 * u}" fill="#404040"/>`}
    <g fill="${INK}" transform="translate(${glyphX} ${glyphY}) scale(${glyphH / 14})">${GLYPHS}</g>
    <rect x="${sx + screenW / 2 - (iphone ? 15.5 : 12) * u}" y="${sy + screenH - (iphone ? 2.9 : 2.8) * u}" width="${(iphone ? 31 : 24) * u}" height="${(iphone ? 1.2 : 1) * u}" rx="${0.6 * u}" fill="${INK}" fill-opacity="${iphone ? 0.85 : 0.6}"/>
    <rect x="${sx}" y="${sy}" width="${screenW}" height="${screenH}" rx="${radius.screen}" fill="url(#glare)"/>
  </svg>`;
  const timeSize = Math.round((iphone ? 4.2 : 3.8) * u);
  const time = await text("9:41", { size: timeSize, fontfile: iphone ? INTER_SEMIBOLD : INTER_MEDIUM, weight: iphone ? "SemiBold" : "Medium", color: INK, align: "left" });
  const timeMeta = await sharp(time).metadata();
  const timeX = iphone ? sx + earW / 2 - timeMeta.width / 2 : sx + 6.5 * u;
  const timeY = (iphone ? sy + 6.8 * u : sy + 4.2 * u) - timeMeta.height / 2;

  const png = await sharp(Buffer.from(body)).composite([
    { input: screen, left: Math.round(sx), top: Math.round(sy) },
    { input: Buffer.from(overlay), left: 0, top: 0 },
    { input: time, left: Math.round(timeX), top: Math.round(timeY) },
  ]).png().toBuffer();
  return { png, width: canvasW, height: canvasH, bodyHeight: height };
}

/** A layer placed at (left, top), cropped to what falls inside a width×height canvas. */
async function place(input, left, top, width, height) {
  const meta = await sharp(input).metadata();
  const x = Math.max(0, -left), y = Math.max(0, -top);
  const w = Math.min(meta.width - x, width - Math.max(0, left));
  const h = Math.min(meta.height - y, height - Math.max(0, top));
  const cropped = x || y || w < meta.width || h < meta.height ? await sharp(input).extract({ left: x, top: y, width: w, height: h }).png().toBuffer() : input;
  return { input: cropped, left: Math.max(0, left), top: Math.max(0, top) };
}

/** A soft drop shadow for a phone, as its own layer. */
async function shadow(width, height, blur) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width + blur * 4}" height="${height + blur * 4}">
    <rect x="${blur * 2}" y="${blur * 2.6}" width="${width}" height="${height}" rx="${width * 0.16}" fill="#000" fill-opacity="0.42"/></svg>`;
  return sharp(Buffer.from(svg)).blur(blur).png().toBuffer();
}

function background(width, height) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GREEN}"/><stop offset="1" stop-color="${GREEN_DEEP}"/></linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.62" r="0.55"><stop offset="0" stop-color="${GREEN_BRIGHT}" stop-opacity="0.55"/><stop offset="1" stop-color="${GREEN_BRIGHT}" stop-opacity="0"/></radialGradient>
      <radialGradient id="light" cx="0.85" cy="0" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/><rect width="100%" height="100%" fill="url(#glow)"/><rect width="100%" height="100%" fill="url(#light)"/>
  </svg>`);
}

/** One portrait store screenshot: headline, supporting line and a phone, sized from the canvas. */
async function portrait({ width, height, kind, slide, layout }) {
  const { titleSize, lineSize, top, phoneWidth, gap } = layout(width, height);
  const textWidth = Math.round(width * 0.84);
  const title = await text(slide.title, { size: titleSize, fontfile: INTER_BOLD, weight: "Bold", width: textWidth, tracking: -0.025, lineHeight: 1.08 });
  const line = await text(slide.line, { size: lineSize, fontfile: INTER_MEDIUM, weight: "Medium", width: textWidth, color: "#e3f2e6", lineHeight: 1.25 });
  const titleMeta = await sharp(title).metadata();
  const lineMeta = await sharp(line).metadata();
  const device = await phone(kind, phoneWidth, join(SCREENS, `app-${slide.screen}.webp`));
  const phoneTop = Math.round(top + titleMeta.height + gap + lineMeta.height + gap * 1.6);
  const blur = Math.round(phoneWidth * 0.035);
  const drop = await shadow(phoneWidth, device.bodyHeight, blur);
  const phoneLeft = Math.round((width - device.width) / 2);
  const image = sharp(background(width, height)).composite([
    { input: title, left: Math.round((width - titleMeta.width) / 2), top: Math.round(top) },
    { input: line, left: Math.round((width - lineMeta.width) / 2), top: Math.round(top + titleMeta.height + gap) },
    await place(drop, phoneLeft + Math.round((device.width - phoneWidth) / 2) - blur * 2, phoneTop - blur * 2, width, height),
    await place(device.png, phoneLeft, phoneTop, width, height),
  ]).flatten({ background: GREEN_DEEP });
  return image;
}

async function save(image, file, { width, height }) {
  mkdirSync(dirname(file), { recursive: true });
  const buffer = await image.png().toBuffer();
  // Store images are opaque; the frame may run off the canvas bottom, so crop to the exact size.
  await sharp(buffer).resize(width, height, { fit: "cover", position: "top" }).removeAlpha()
    .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: "4:4:4" }).toFile(file);
  const meta = await sharp(file).metadata();
  console.log(file.replace(`${repo}/`, ""), `${meta.width}×${meta.height}`);
}

const appStore = (width, height) => ({
  titleSize: Math.round(width * 0.072), lineSize: Math.round(width * 0.034), top: Math.round(height * 0.058),
  phoneWidth: Math.round(width * 0.8), gap: Math.round(width * 0.022),
});
const play = (width, height) => ({
  titleSize: Math.round(width * 0.068), lineSize: Math.round(width * 0.033), top: Math.round(height * 0.05),
  phoneWidth: Math.round(width * 0.64), gap: Math.round(width * 0.02),
});

async function featureGraphic() {
  const width = 1024, height = 500;
  const logo = await sharp(LOGO).resize({ width: 250 }).png().toBuffer();
  const title = await text("Every job, from enquiry to handover.", { size: 50, fontfile: INTER_BOLD, weight: "Bold", width: 520, align: "left", tracking: -0.025, lineHeight: 1.06 });
  const line = await text("Sales, projects, purchasing and site work, with an app for the site.", { size: 22, fontfile: INTER_MEDIUM, weight: "Medium", width: 470, align: "left", color: "#e3f2e6", lineHeight: 1.3 });
  const back = await phone("android", 236, join(SCREENS, "app-daily-report.webp"));
  const front = await phone("iphone", 250, join(SCREENS, "app-today.webp"));
  const titleMeta = await sharp(title).metadata();
  const image = sharp(background(width, height)).composite([
    { input: logo, left: 64, top: 62 },
    { input: title, left: 64, top: 150 },
    { input: line, left: 64, top: 150 + titleMeta.height + 18 },
    await place(back.png, 610, 118, width, height),
    await place(front.png, 752, 58, width, height),
  ]);
  await save(image, join(OUT, "google-play", "feature-graphic.jpg"), { width, height });
}

const sets = [
  { dir: join(OUT, "app-store", "6.7-inch"), width: 1290, height: 2796, kind: "iphone", layout: appStore },
  { dir: join(OUT, "app-store", "6.5-inch"), width: 1242, height: 2688, kind: "iphone", layout: appStore },
  { dir: join(OUT, "google-play", "phone"), width: 1080, height: 1920, kind: "android", layout: play },
];
for (const set of sets) {
  for (const [index, slide] of SLIDES.entries()) {
    const image = await portrait({ ...set, slide });
    await save(image, join(set.dir, `${String(index + 1).padStart(2, "0")}-${slide.screen}.jpg`), set);
  }
}
await featureGraphic();
