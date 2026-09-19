import { chromium } from "@playwright/test";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.WODANA_CAPTURE_URL ?? "http://127.0.0.1:3100";
const output = path.resolve("public/landing");
const videoDirectory = path.join(output, ".recording");

const story = [
  {
    key: "crm",
    path: "/workspace/crm",
    title: "1 · Capture the opportunity",
    copy: "Enquiries, ownership, response time and the next customer action begin in one clear view.",
  },
  {
    key: "enquiry",
    path: "/workspace/crm/leads",
    title: "2 · Qualify without losing context",
    copy: "The brief, conversations and responsibility travel with the customer—not through disconnected sheets.",
  },
  {
    key: "scope",
    path: "/workspace/pre-projects/cases/00000000-0000-4000-8000-000000000001/requirements",
    title: "3 · Turn the brief into confirmed scope",
    copy: "Rooms, requirements, measurements, references and decisions become the source for the quotation.",
  },
  {
    key: "quotation",
    path: "/workspace/pre-projects/cases/00000000-0000-4000-8000-000000000001/quotations?quote=92000000-0000-4000-8000-000000000005",
    title: "4 · Build a visual, connected quotation",
    copy: "Compose client-ready pages while items, quantities, rates and materials stay connected to the system BOQ.",
  },
  {
    key: "project",
    path: "/workspace/projects/demo/overview",
    title: "5 · Release approved work into delivery",
    copy: "The accepted commercial record becomes a live project plan with owners, dates, risk and next actions.",
  },
  {
    key: "delivery",
    path: "/workspace/projects/demo/production",
    title: "6 · Coordinate factory and site",
    copy: "Production, procurement and onsite work share the same scope, evidence and readiness gates.",
  },
  {
    key: "handover",
    path: "/workspace/projects/demo/handover",
    title: "7 · Close with proof",
    copy: "Snags, approvals, handover records and warranty history complete one traceable client journey.",
  },
];

const stills = story.filter(({ key }) => ["crm", "scope", "quotation", "project", "delivery", "handover"].includes(key));

async function setTheme(page, theme) {
  await page.evaluate((value) => {
    localStorage.setItem("wodana-theme", value);
    document.documentElement.dataset.theme = value;
    document.querySelectorAll("[data-wd-theme]").forEach((node) => node.setAttribute("data-wd-theme", value));
  }, theme);
}

async function open(page, scene, theme = "light") {
  await page.goto(`${baseURL}${scene.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await setTheme(page, theme);
  await page.waitForTimeout(900);
  if (scene.key === "quotation") {
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await page.waitForTimeout(700);
  }
  // Captures run against the local development server for fixture data. Never
  // publish Next's local diagnostics button as part of product media.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function addCaption(page, scene) {
  await page.evaluate(({ title, copy }) => {
    document.getElementById("wodana-story-caption")?.remove();
    const caption = document.createElement("aside");
    caption.id = "wodana-story-caption";
    caption.setAttribute("aria-label", "Product tour explanation");
    caption.innerHTML = `<strong>${title}</strong><span>${copy}</span>`;
    Object.assign(caption.style, {
      position: "fixed",
      zIndex: "2147483647",
      left: "50%",
      bottom: "28px",
      width: "min(760px, calc(100vw - 48px))",
      padding: "18px 22px",
      border: "1px solid rgba(255,255,255,.2)",
      borderRadius: "18px",
      color: "#fff",
      background: "rgba(9, 12, 24, .88)",
      boxShadow: "0 24px 70px rgba(0,0,0,.35)",
      backdropFilter: "blur(18px)",
      transform: "translateX(-50%)",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      display: "grid",
      gap: "6px",
    });
    const strong = caption.querySelector("strong");
    const span = caption.querySelector("span");
    Object.assign(strong.style, { fontSize: "17px", letterSpacing: "-.01em" });
    Object.assign(span.style, { color: "rgba(255,255,255,.74)", fontSize: "14px", lineHeight: "1.45" });
    document.body.append(caption);
  }, scene);
}

await mkdir(output, { recursive: true });
await rm(videoDirectory, { recursive: true, force: true });
await mkdir(videoDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      colorScheme: theme,
      deviceScaleFactor: 1,
      viewport: { width: 1440, height: 900 },
    });
    await context.addInitScript((value) => localStorage.setItem("wodana-theme", value), theme);
    const page = await context.newPage();
    for (const scene of stills) {
      await open(page, scene, theme);
      await page.screenshot({
        animations: "disabled",
        path: path.join(output, `${scene.key}-${theme}.webp`),
        type: "webp",
        quality: 86,
      });
    }
    await context.close();
  }

  const context = await browser.newContext({
    colorScheme: "light",
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDirectory, size: { width: 1440, height: 900 } },
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(() => localStorage.setItem("wodana-theme", "light"));
  const page = await context.newPage();
  for (const scene of story) {
    await open(page, scene);
    await addCaption(page, scene);
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollBy({ top: Math.min(260, document.documentElement.scrollHeight - innerHeight), behavior: "smooth" }));
    await page.waitForTimeout(1200);
  }
  const recordedVideo = page.video();
  await context.close();
  if (!recordedVideo) throw new Error("Playwright did not create the product story video.");
  await rename(await recordedVideo.path(), path.join(output, "wodana-complete-flow.webm"));
} finally {
  await browser.close();
  await rm(videoDirectory, { recursive: true, force: true });
}

console.log(`Captured ${stills.length * 2} product screenshots and one complete flow video in ${output}`);
