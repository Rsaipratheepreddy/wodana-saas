#!/usr/bin/env node
// Translates the labels that are in lib/i18n/en.json but missing from another language file, with Gemini.
//
//   npm run i18n:translate --workspace @wodana/web                 all languages, missing labels only
//   npm run i18n:translate --workspace @wodana/web -- --languages ar,ur --limit 50
//   npm run i18n:translate --workspace @wodana/web -- --check      validate what is already translated (no API calls)
//   npm run i18n:translate --workspace @wodana/web -- --check --fix   drop invalid entries so the next run redoes them
//
// Options: --languages a,b  --batch-size 150  --limit N (per language)  --model NAME  --concurrency N (languages at once)
//          --dry-run (show what would be sent)  --redo "Label" (retranslate one label; repeatable)
//
// GEMINI_API_KEY comes from the environment, or else from the monorepo root .env (never printed or copied).
// Each result is validated (placeholders, not empty, not left in English, no quotes or markdown added) and
// retried; files are written after every batch in en.json order, so a stopped run resumes where it left off.
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const i18nDir = join(webRoot, "lib/i18n");
const glossaryPath = join(webRoot, "scripts/i18n-glossary.json");
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const options = {
  languages: option("languages", "")?.split(",").map((value) => value.trim()).filter(Boolean),
  batchSize: Math.max(1, Number(option("batch-size", "150"))),
  limit: Number(option("limit", "0")) || Infinity,
  model: option("model", process.env.GEMINI_MODEL || DEFAULT_MODEL),
  concurrency: Math.max(1, Number(option("concurrency", "3"))),
  attempts: Math.max(1, Number(option("attempts", "4"))),
  dryRun: flag("dry-run"),
  check: flag("check"),
  fix: flag("fix"),
  redo: argv.flatMap((value, index) => (argv[index - 1] === "--redo" ? [value] : [])),
};

// ---------------------------------------------------------------- languages
/** What the prompt says about each language, and the script its labels must be written in. */
const LANGUAGE_GUIDE = {
  ar: {
    name: "Arabic",
    script: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/u,
    notes: "Modern Standard Arabic as used in Gulf (UAE, Saudi) business software. Use the established commercial and legal terms: عرض سعر for a quotation, ضريبة for tax, ضريبة القيمة المضافة for VAT, فاتورة ضريبية for a tax invoice, دفعات for payment milestones. Use Arabic punctuation (، ؛ ؟).",
  },
  ur: {
    name: "Urdu",
    script: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/u,
    notes: "Standard Urdu in Arabic script as used in Pakistani business software. Prefer established Urdu business vocabulary (کوٹیشن is acceptable for quotation, ٹیکس for tax, ادائیگی for payment, قسط for a payment instalment). Write English loanwords in Urdu script only where professionals really say them (ای میل). Use Urdu punctuation (، ؟ ۔).",
  },
  hi: {
    name: "Hindi",
    script: /[ऀ-ॿ]/u,
    notes: "Everyday business Hindi in Devanagari as used in Indian business software. Common English business words that Hindi speakers use (कोटेशन, इनवॉइस, ईमेल, प्रोजेक्ट) may be written in Devanagari when they are clearer than a Sanskritised term.",
  },
  te: {
    name: "Telugu",
    script: /[ఀ-౿]/u,
    notes: "Everyday business Telugu in Telugu script as used in Indian business software. Common English business words may be written in Telugu script when clearer (కొటేషన్, ఇన్‌వాయిస్).",
  },
  ml: {
    name: "Malayalam",
    script: /[ഀ-ൿ]/u,
    notes: "Everyday business Malayalam in Malayalam script as used in Indian business software. Common English business words may be written in Malayalam script when clearer (ക്വട്ടേഷൻ, ഇൻവോയ്സ്).",
  },
  ta: {
    name: "Tamil",
    script: /[஀-௿]/u,
    notes: "Everyday business Tamil in Tamil script as used in Indian business software. Common English business words may be written in Tamil script when clearer (கொட்டேஷன், இன்வாய்ஸ்).",
  },
};

function languageList() {
  const source = readFileSync(join(i18nDir, "languages.ts"), "utf8");
  const ids = [...source.matchAll(/id:\s*["'](\w+)["']/g)].map((match) => match[1]).filter((id) => id !== "en");
  const unknown = options.languages.filter((id) => !ids.includes(id));
  if (unknown.length) throw new Error(`Unknown language(s): ${unknown.join(", ")} (see lib/i18n/languages.ts)`);
  return options.languages.length ? ids.filter((id) => options.languages.includes(id)) : ids;
}

function guideFor(id) {
  if (LANGUAGE_GUIDE[id]) return LANGUAGE_GUIDE[id];
  let name = id;
  try { name = new Intl.DisplayNames(["en"], { type: "language" }).of(id) ?? id; } catch { /* keep the code */ }
  return { name, script: null, notes: "" };
}

// ---------------------------------------------------------------- files
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const english = readJson(join(i18nDir, "en.json"));
const englishKeys = Object.keys(english);

/** Writes a language file with keys in en.json order (entries that are no longer in en.json are dropped). */
function writeDictionary(id, dictionary) {
  const ordered = {};
  for (const key of englishKeys) if (typeof dictionary[key] === "string" && dictionary[key].trim()) ordered[key] = dictionary[key];
  const path = join(i18nDir, `${id}.json`);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(ordered, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

function readDictionary(id) {
  const path = join(i18nDir, `${id}.json`);
  return existsSync(path) ? readJson(path) : {};
}

// ---------------------------------------------------------------- API key
/** The key comes from the environment or the monorepo root .env; it is never printed or written anywhere. */
function apiKey() {
  if (process.env.GEMINI_API_KEY?.trim()) return process.env.GEMINI_API_KEY.trim();
  let root = webRoot;
  for (let dir = webRoot; dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest) && readJson(manifest).workspaces) { root = dir; break; }
  }
  for (const file of [join(webRoot, ".env.local"), join(webRoot, ".env"), join(root, ".env")]) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8").split(/\r?\n/).find((entry) => /^\s*(export\s+)?GEMINI_API_KEY\s*=/.test(entry));
    const value = line?.replace(/^\s*(export\s+)?GEMINI_API_KEY\s*=\s*/, "").trim().replace(/^(['"])(.*)\1$/, "$2");
    if (value) return value;
  }
  throw new Error("GEMINI_API_KEY is not set (environment or the monorepo root .env)");
}

// ---------------------------------------------------------------- glossary
const glossary = readJson(glossaryPath);
const KEEP = [...glossary.keep].sort((a, b) => b.length - a.length);

// ---------------------------------------------------------------- validation
const PLACEHOLDER = /\{\w+\}/g;
const QUOTES = `"'“”„«»‘’‚「」`;
const placeholders = (text) => (text.match(PLACEHOLDER) ?? []).sort();
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEEP_PATTERN = new RegExp(`(^|[^\\p{Script=Latin}])(${KEEP.map(escape).join("|")})(?=$|[^\\p{Script=Latin}])`, "gu");

/** Labels whose translation may legitimately equal the English: brands, codes, units and numbers. */
function mayStayEnglish(key) {
  const rest = key.replace(PLACEHOLDER, " ").replace(KEEP_PATTERN, "$1 ");
  // What is left must not contain a real word: codes (PDF, L, D, H), numbers and symbols only.
  return !/\p{Ll}{2,}|\p{Lu}\p{Ll}+/u.test(rest);
}

/** Problems with one translation; `soft` problems are tolerated on the last attempt. */
function problems(key, value, guide) {
  const hard = [];
  const soft = [];
  if (typeof value !== "string" || !value.trim()) return { hard: ["the translation is empty"], soft };
  const text = value;
  if (JSON.stringify(placeholders(text)) !== JSON.stringify(placeholders(key))) {
    hard.push(`placeholders must be exactly ${placeholders(key).join(" ") || "none"} (untranslated, with braces)`);
  }
  const exempt = mayStayEnglish(key);
  if (text.trim() === key.trim() && !exempt) hard.push("it is still English");
  if (guide.script && !exempt && !guide.script.test(text.replace(PLACEHOLDER, ""))) hard.push(`it is not written in ${guide.name} script`);
  if (/\*\*|__|`|^\s*#{1,6}\s|^\s*[-*]\s/.test(text) && !/\*\*|__|`|^\s*#|^\s*[-*]\s/.test(key)) hard.push("it adds markdown");
  const wrapped = QUOTES.includes(text.trim()[0]) && QUOTES.includes(text.trim().at(-1));
  if (wrapped && !(QUOTES.includes(key.trim()[0]) && QUOTES.includes(key.trim().at(-1)))) hard.push("it adds quotation marks around the label");
  if (/\n/.test(text) && !/\n/.test(key)) hard.push("it adds a line break");
  if (text !== text.trim() && key === key.trim()) soft.push("it adds leading or trailing spaces");
  if (text.length > key.length * 4 + 40) soft.push("it is much longer than the English");
  // English words left behind (other than brands, codes and units) usually mean a half translation.
  const leftover = (text.replace(PLACEHOLDER, " ").replace(KEEP_PATTERN, "$1 ").match(/\p{Script=Latin}{3,}/gu) ?? [])
    .filter((word) => /\p{Ll}/u.test(word));
  if (guide.script && leftover.length) soft.push(`it leaves English words untranslated (${leftover.join(", ")})`);
  return { hard, soft };
}

// ---------------------------------------------------------------- Gemini
let resolvedModel = null;
const unavailable = new Set();
async function modelName(key) {
  if (resolvedModel) return resolvedModel;
  const response = await fetch(`${ENDPOINT}?pageSize=200`, { headers: { "x-goog-api-key": key } });
  if (!response.ok) throw new Error(`Listing Gemini models failed (${response.status})`);
  const names = ((await response.json()).models ?? [])
    .filter((model) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((model) => model.name.replace(/^models\//, ""))
    .filter((name) => !unavailable.has(name));
  if (names.includes(options.model)) return (resolvedModel = options.model);
  // Fall back to the newest general flash model (not lite, tts, image, audio or live).
  const version = (name) => name.match(/\d+(\.\d+)?/)[0].split(".").map(Number);
  const flash = names.filter((name) => /^gemini-\d+(\.\d+)?-flash$/.test(name))
    .sort((a, b) => version(b)[0] - version(a)[0] || (version(b)[1] ?? 0) - (version(a)[1] ?? 0));
  if (!flash.length) throw new Error(`Model ${options.model} is not available and no flash model was found`);
  console.warn(`Model ${options.model} is not available; using ${flash[0]}`);
  return (resolvedModel = flash[0]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generate(key, system, prompt, schema) {
  let model = await modelName(key);
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 },
  };
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(240_000),
      });
    } catch (error) {
      if (attempt >= 6) throw error;
      await sleep(2 ** attempt * 1000);
      continue;
    }
    if (response.ok) {
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      if (!text) throw new Error(`Empty response (${data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason ?? "unknown"})`);
      return JSON.parse(text);
    }
    const retryable = response.status === 429 || response.status >= 500;
    const detail = await response.text().catch(() => "");
    // A listed model can still be closed to this key: pick the newest flash model instead, once.
    if (response.status === 404 && model === options.model) {
      unavailable.add(model);
      if (resolvedModel === model) resolvedModel = null;
      model = await modelName(key);
      attempt -= 1;
      continue;
    }
    if (!retryable || attempt >= 6) throw new Error(`Gemini ${response.status}: ${detail.slice(0, 300)}`);
    const hinted = Number(detail.match(/"retryDelay":\s*"(\d+)s"/)?.[1] ?? 0) * 1000;
    await sleep(Math.max(hinted, 2 ** attempt * 1000));
  }
}

const itemSchema = { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "INTEGER" }, text: { type: "STRING" } }, required: ["id", "text"] } };

function systemPrompt(guide, terms) {
  return [
    `You translate the user interface of Wodana, a business app (ERP) for interior design and fit-out companies, from English into ${guide.name}.`,
    "The app covers sales enquiries, planning cases (design and estimating before a project is signed), site visits and measurements, quotations and client proposals, scope sign-off, projects with sprints and tasks, snag lists and handover, variation orders, purchase orders, suppliers, materials and stock, a joinery factory, crews, attendance and timesheets, payments, invoices and tax. Users are office staff, site supervisors and homeowners.",
    "",
    "Rules:",
    "1. Keep every {placeholder} exactly as written, braces and name unchanged and untranslated. Move it wherever the grammar needs it.",
    `2. Do not translate brand names, codes or units: ${glossary.keep.join(", ")}.`,
    "3. The labels are buttons, menu items, column headers, field labels and short messages. Keep each one as short as the English. Do not add explanations, quotation marks, markdown, or punctuation the English does not have.",
    `4. Use natural punctuation and word order for ${guide.name}. Use a neutral, professional register and the polite form of "you".`,
    "5. Use the glossary terms below every time the concept appears, including inside longer labels.",
    "6. Keep digits as they are. Labels are listed in app order, so neighbouring labels usually belong to the same screen.",
    guide.notes ? `7. ${guide.notes}` : "",
    "",
    "Glossary (English = your language):",
    ...terms.map((term) => `- ${term.en} = ${term.translation}`),
    "",
    "Answer with a JSON array of {\"id\", \"text\"}, one entry for every input id.",
  ].filter((line) => line !== null).join("\n");
}

// ---------------------------------------------------------------- glossary per language
async function ensureGlossary(key, id, guide) {
  const missing = glossary.terms.filter((term) => !term[id]?.trim());
  if (!missing.length) return;
  const system = [
    `You are building the ${guide.name} terminology for Wodana, a business app for interior design and fit-out companies.`,
    "Give the single best short term a professional in that industry would expect to see in business software. No explanations, no quotation marks.",
    guide.notes,
    "Answer with a JSON array of {\"id\", \"text\"}.",
  ].join("\n");
  const prompt = JSON.stringify(missing.map((term, index) => ({ id: index, text: term.en, meaning: term.note })));
  const result = await generate(key, system, prompt, itemSchema);
  for (const entry of Array.isArray(result) ? result : []) {
    const term = missing[entry.id];
    if (term && typeof entry.text === "string" && entry.text.trim() && !QUOTES.includes(entry.text.trim()[0])) term[id] = entry.text.trim();
  }
  writeFileSync(glossaryPath, `${JSON.stringify(glossary, null, 2)}\n`);
  console.log(`${id}: glossary filled for ${missing.filter((term) => term[id]).length} term(s)`);
}

// ---------------------------------------------------------------- translation
async function translateLanguage(key, id) {
  const guide = guideFor(id);
  const dictionary = readDictionary(id);
  for (const label of options.redo) delete dictionary[label];
  const todo = englishKeys.filter((label) => !dictionary[label]?.trim()).slice(0, options.limit);
  if (!todo.length) { console.log(`${id}: nothing to translate`); return { id, translated: 0, failed: [] }; }
  if (options.dryRun) {
    console.log(`${id}: would translate ${todo.length} label(s) in ${Math.ceil(todo.length / options.batchSize)} batch(es)`);
    return { id, translated: 0, failed: [] };
  }
  await ensureGlossary(key, id, guide);
  const terms = glossary.terms.filter((term) => term[id]).map((term) => ({ en: term.en, translation: term[id] }));
  const system = systemPrompt(guide, terms);
  const failed = [];
  const warned = [];
  let translated = 0;
  for (let start = 0; start < todo.length; start += options.batchSize) {
    let pending = todo.slice(start, start + options.batchSize).map((label) => ({ label, feedback: null }));
    for (let attempt = 1; attempt <= options.attempts && pending.length; attempt += 1) {
      const last = attempt === options.attempts;
      const input = pending.map((item, index) => ({ id: index, text: item.label, ...(item.feedback ? { fix: item.feedback } : {}) }));
      let result;
      try {
        result = await generate(key, system, `Translate these labels.${pending.some((item) => item.feedback) ? " Entries with \"fix\" were rejected before: correct what it says." : ""}\n${JSON.stringify(input)}`, itemSchema);
      } catch (error) {
        console.warn(`${id}: batch ${start / options.batchSize + 1} attempt ${attempt} failed: ${error.message}`);
        continue;
      }
      const byId = new Map((Array.isArray(result) ? result : []).map((entry) => [entry.id, entry.text]));
      const retry = [];
      pending.forEach((item, index) => {
        const value = typeof byId.get(index) === "string" ? byId.get(index).trim() : byId.get(index);
        const { hard, soft } = problems(item.label, value, guide);
        if (!hard.length && (!soft.length || last)) {
          dictionary[item.label] = value;
          translated += 1;
          if (soft.length) warned.push(`${item.label} → ${value} (${soft.join("; ")})`);
        } else {
          retry.push({ label: item.label, feedback: `Your answer "${value ?? ""}" was rejected: ${[...hard, ...soft].join("; ")}.` });
        }
      });
      pending = retry;
      writeDictionary(id, dictionary);
    }
    failed.push(...pending.map((item) => `${item.label} (${item.feedback})`));
    console.log(`${id}: ${Math.min(start + options.batchSize, todo.length)} of ${todo.length} processed, ${translated} translated, ${failed.length} failed`);
  }
  for (const line of warned) console.log(`${id}: accepted with a warning: ${line}`);
  for (const line of failed) console.log(`${id}: not translated: ${line}`);
  return { id, translated, failed };
}

// ---------------------------------------------------------------- check mode
function check(ids) {
  let invalid = 0;
  for (const id of ids) {
    const guide = guideFor(id);
    const dictionary = readDictionary(id);
    for (const [label, value] of Object.entries(dictionary)) {
      if (!(label in english)) { console.log(`${id}: not in en.json: ${label}`); invalid += 1; if (options.fix) delete dictionary[label]; continue; }
      const { hard, soft } = problems(label, value, guide);
      if (hard.length || soft.length) console.log(`${id}: ${hard.length ? "INVALID" : "warning"}: ${label} → ${value} (${[...hard, ...soft].join("; ")})`);
      if (hard.length) { invalid += 1; if (options.fix) delete dictionary[label]; }
    }
    if (options.fix) writeDictionary(id, dictionary);
  }
  console.log(`${invalid} invalid translation(s)${options.fix ? " removed" : ""}`);
  return invalid;
}

// ---------------------------------------------------------------- main
const ids = languageList();
if (options.check) {
  process.exitCode = check(ids) && !options.fix ? 1 : 0;
} else {
  const key = options.dryRun ? "" : apiKey();
  // Settle the model with one small call before the languages run in parallel.
  if (!options.dryRun) {
    await generate(key, "Reply with a JSON array.", "[{\"id\":0,\"text\":\"ok\"}]", itemSchema);
    console.log(`Translating with ${resolvedModel}`);
  }
  const queue = [...ids];
  const results = [];
  await Promise.all(Array.from({ length: Math.min(options.concurrency, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        results.push(await translateLanguage(key, id));
      } catch (error) {
        console.error(`${id}: stopped: ${error.message}`);
        results.push({ id, translated: 0, failed: ["(stopped)"] });
      }
    }
  }));
  for (const result of results.sort((a, b) => a.id.localeCompare(b.id))) {
    const left = englishKeys.filter((label) => !readDictionary(result.id)[label]?.trim()).length;
    console.log(`${result.id}: ${result.translated} translated this run, ${left} still missing`);
  }
  if (results.some((result) => result.failed.length)) process.exitCode = 1;
}
