#!/usr/bin/env node
// Replays every Woddy tour headless against a running app and fails when a step's target is missing.
// Usage (from apps/web): TOURS_BASE_URL=http://localhost:3000 TOURS_COOKIES=/path/cookies.json node scripts/tours-replay.mjs [tour-id…]
// TOURS_COOKIES is a JSON array of { name, value } session cookies for a signed-in test account (never a real one).
// Each step is allowed to act and settle, then the replay moves on without waiting for the narration.
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { tours } from "./tours-lines.mjs";

const base = (process.env.TOURS_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const only = process.argv.slice(2);
const cookies = process.env.TOURS_COOKIES ? JSON.parse(readFileSync(process.env.TOURS_COOKIES, "utf8")) : [];
const width = Number(process.env.TOURS_WIDTH ?? 1440);
const STEP_TIMEOUT = 40_000;

const browser = await chromium.launch({ headless: true, channel: process.env.TOURS_CHANNEL ?? "chrome" });
const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-US" });
await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: base })));
const results = [];

for (const tour of tours.filter((item) => !only.length || only.includes(item.id))) {
  const page = await context.newPage();
  const missing = [];
  const blocked = [];
  page.on("request", (request) => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !request.url().includes("/api/auth/")) blocked.push(`${request.method()} ${request.url()}`); });
  const started = Date.now();
  try {
    await page.goto(`${base}/workspace?tour=${tour.id}`, { waitUntil: "load", timeout: 120_000 });
    let step = 0;
    while (true) {
      const state = await page.waitForFunction((previous) => {
        const root = document.querySelector(".wd-tour");
        if (!root) return null;
        const current = Number(root.getAttribute("data-step"));
        const phase = root.getAttribute("data-phase");
        if (phase === "finished") return { current, phase, missing: false };
        if (current <= previous) return null;
        if (root.hasAttribute("data-missing")) return { current, phase, missing: true };
        return phase === "speaking" || phase === "resting" ? { current, phase, missing: false } : null;
      }, step, { timeout: STEP_TIMEOUT, polling: 100 }).then((handle) => handle.jsonValue());
      if (state.phase === "finished") break;
      step = state.current;
      const definition = tour.steps[step - 1];
      if (state.missing) missing.push(`${step}. ${definition?.id} (${definition?.target})`);
      // The next step is the arrow that points forward in the page's direction.
      else await page.locator(".wd-tour-bubble").press(await page.evaluate(() => document.documentElement.dir) === "rtl" ? "ArrowLeft" : "ArrowRight");
    }
  } catch (error) {
    missing.push(`stopped: ${String(error).split("\n")[0].slice(0, 160)}`);
  }
  results.push({ tour: tour.id, steps: tour.steps.length, missing, blocked, seconds: Math.round((Date.now() - started) / 1000) });
  console.log(`${missing.length || blocked.length ? "FAIL" : "ok  "} ${tour.id}: ${tour.steps.length} steps in ${Math.round((Date.now() - started) / 1000)} s${missing.length ? ` · missing ${missing.join("; ")}` : ""}${blocked.length ? ` · writes sent ${blocked.join("; ")}` : ""}`);
  await page.close();
}

await browser.close();
process.exit(results.some((result) => result.missing.length || result.blocked.length) ? 1 : 0);
