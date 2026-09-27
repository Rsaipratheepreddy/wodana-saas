#!/usr/bin/env node
// Exports the narration of Woddy's tours for recording:
//   public/tours/script.json (machine-readable) and public/tours/script.md (to read and record from).
// Usage (from apps/web): node scripts/tours-script.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { VOICE, characterCounts, tourLines, tours } from "./tours-lines.mjs";

const out = new URL("../public/tours/", import.meta.url);
const rows = tourLines();
const characters = characterCounts(rows);

mkdirSync(out, { recursive: true });
writeFileSync(new URL("script.json", out), `${JSON.stringify({
  voice: VOICE,
  characters,
  note: "Record `voice` (name-free). `text` is the caption: {name}, {client} and {project} are filled from the screen, so recordings never say them. The player plays `audio` when the file exists and otherwise paces the caption on screen.",
  lines: rows,
}, null, 2)}\n`);

const markdown = [
  "# Woddy explains: narration script",
  "",
  `Voice: ${VOICE.name} (\`${VOICE.id}\`), model \`${VOICE.model}\`.`,
  "",
  "| Language | Lines | Characters |",
  "| --- | ---: | ---: |",
  ...Object.entries(characters).map(([language, count]) => `| ${language} | ${rows.filter((row) => row.language === language).length} | ${count} |`),
  "",
  "Record the **Voice** line of each step as one MP3 at the path shown. Voice lines never name a person or a record:",
  "the caption fills `{name}`, `{client}` and `{project}` from the screen, and the recording says the name-free version.",
  "When a file is missing, the player falls back to the browser voice or to on-screen pacing.",
  "",
  ...tours.flatMap((tour) => [
    `## ${tour.title} (\`${tour.id}\`)`,
    "",
    ...rows.filter((row) => row.tour === tour.id).flatMap((row) => [
      `**${row.step}. ${row.stepId}** · ${row.language} · \`${row.audio}\``,
      "",
      `> ${row.voice}`,
      "",
      ...(row.text !== row.voice ? [`Caption: ${row.text}`, ""] : []),
    ]),
  ]),
].join("\n");
writeFileSync(new URL("script.md", out), markdown);

console.log(`${rows.length} lines · ${Object.entries(characters).map(([language, count]) => `${language}: ${count} characters`).join(" · ")}`);
