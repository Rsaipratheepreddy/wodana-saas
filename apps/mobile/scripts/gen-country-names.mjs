// Writes src/core/country-names.json: country names per app language, for engines without Intl.DisplayNames (Hermes).
// Run: node scripts/gen-country-names.mjs   (re-run when a language or libphonenumber's country list changes)
import { writeFileSync } from "node:fs";
import { getCountries } from "libphonenumber-js";
const languages = ["en", "ar", "hi"];
const out = {};
for (const language of languages) {
  const names = new Intl.DisplayNames([language], { type: "region" });
  out[language] = Object.fromEntries(getCountries().map((code) => [code, names.of(code) ?? code]));
}
writeFileSync(new URL("../src/core/country-names.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`country names: ${languages.join(", ")} × ${getCountries().length}`);
