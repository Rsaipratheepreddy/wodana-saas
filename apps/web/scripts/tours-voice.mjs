#!/usr/bin/env node
// Records Woddy's tour narration with ElevenLabs: one MP3 per step and language, at
// public/tours/audio/<lang>/<tour>/<step>.mp3. Resumable: files that exist are skipped.
// Usage (from apps/web): ELEVENLABS_API_KEY=… node scripts/tours-voice.mjs [--lang en] [--tour home] [--dry-run]
// Options: --voice <id> and --model <id> override the defaults (Brady J, eleven_multilingual_v2).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VOICE, tourLines } from "./tours-lines.mjs";

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
const dryRun = args.includes("--dry-run");
const languages = option("lang") ? [option("lang")] : undefined;
const onlyTour = option("tour");
const voiceId = option("voice") ?? VOICE.id;
const model = option("model") ?? VOICE.model;
const web = fileURLToPath(new URL("../", import.meta.url));

const pending = tourLines(languages).filter((row) => !onlyTour || row.tour === onlyTour).filter((row) => !existsSync(`${web}${row.audio}`));
const characters = pending.reduce((sum, row) => sum + row.voice.length, 0);
console.log(`${pending.length} lines to record (${characters} characters) with voice ${voiceId}, model ${model}.`);
if (dryRun || !pending.length) process.exit(0);

// The key comes from the environment only; it is never printed or written anywhere.
const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error("Set ELEVENLABS_API_KEY to record.");
  process.exit(1);
}

for (const row of pending) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text: row.voice,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
  });
  if (!response.ok) {
    console.error(`Stopped at ${row.audio}: ElevenLabs answered ${response.status}. Run again to resume.`);
    process.exit(1);
  }
  const file = `${web}${row.audio}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  console.log(`recorded ${row.audio}`);
}
