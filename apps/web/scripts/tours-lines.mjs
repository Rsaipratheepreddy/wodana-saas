// The narration of Woddy's tours, per step and language, shared by tours-script.mjs and tours-voice.mjs.
// Reads the tour data (lib/tours/tours.ts, plain data) and the message dictionaries directly.
import { readFileSync } from "node:fs";

const web = new URL("../", import.meta.url);
const { tours } = await import(new URL("lib/tours/tours.ts", web).href);

export const LANGUAGES = ["en", "ar", "hi"];

/** ElevenLabs defaults: the voice the owner chose (Brady J) and the model that speaks all three languages. */
export const VOICE = { name: "Brady J", id: "3svOJAOhuPHXwQC2H5eq", model: "eleven_multilingual_v2" };

function dictionary(language) {
  return language === "en" ? {} : JSON.parse(readFileSync(new URL(`lib/i18n/${language}.json`, web), "utf8"));
}

/**
 * One row per step and language. `text` is what the caption shows (it may name the client, read from the
 * screen); `voice` is what the recording says: the same line without names, so one file fits every record.
 * A language gets a row only when that step is translated; English always has one.
 */
export function tourLines(languages = LANGUAGES) {
  const rows = [];
  for (const language of languages) {
    const words = dictionary(language);
    for (const tour of tours) {
      tour.steps.forEach((step, index) => {
        const key = step.voice ?? step.narration;
        const voice = language === "en" ? key : words[key];
        if (!voice) return;
        rows.push({
          tour: tour.id,
          tourTitle: language === "en" ? tour.title : words[tour.title] ?? tour.title,
          step: index + 1,
          stepId: step.id,
          language,
          // What the bubble shows: the short caption when the step has one, else the narration.
          text: language === "en" ? step.caption ?? step.narration : words[step.caption ?? step.narration] ?? voice,
          voice,
          audio: `public/tours/audio/${language}/${tour.id}/${step.id}.mp3`,
        });
      });
    }
  }
  return rows;
}

export function characterCounts(rows) {
  const counts = {};
  for (const row of rows) counts[row.language] = (counts[row.language] ?? 0) + row.voice.length;
  return counts;
}

export { tours };
