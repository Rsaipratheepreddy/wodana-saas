import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tours } from "./tours";

/**
 * Every step points at a `data-tour` the product renders, else Woddy stops in front of the person with
 * "I can't find that here". A target is a literal name (`data-tour="quote-send"`, or a `tour="…"` prop a record
 * layout passes through), or a tab named by its prefix and id: `<Tabs tour="project-tab">`, `<PillTabs>`,
 * `<SegmentedControl>` and `moduleTabs({ tour })` name each item `<tour>-<id>`, and a template names its own prefix.
 */
const sources = execSync("git ls-files 'app/**/*.tsx' 'components/**/*.tsx' 'design-system/**/*.tsx'", { encoding: "utf8" })
  .split("\n").filter((file) => file && !/\.(test|stories)\.tsx$/.test(file) && existsSync(file));

/** Items whose ids are declared in another file than the one that names them. */
const IDS_ELSEWHERE: Record<string, string> = {
  nav: "components/workspace/workspace-navigation.ts",
  "case-tab": "lib/pre-project/sections.ts",
  "portal-tab": "lib/client-portal/types.ts",
};
const ITEM_TAGS = /<(?:Tabs|PillTabs|SegmentedControl)\b[^>]*?\btour="([a-z0-9-]+)"/g;

function renderedTargets() {
  const names = new Set<string>();
  const prefixes = new Map<string, string>();
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    for (const [, prefix] of text.matchAll(ITEM_TAGS)) prefixes.set(prefix, IDS_ELSEWHERE[prefix] ?? file);
    for (const [, prefix] of text.matchAll(/\btour:\s*"([a-z0-9-]+)"/g)) prefixes.set(prefix, IDS_ELSEWHERE[prefix] ?? file);
    for (const [, prefix] of text.matchAll(/data-tour=\{`([a-z0-9-]+)-\$\{/g)) prefixes.set(prefix, IDS_ELSEWHERE[prefix] ?? file);
    // A selector in the tour provider (`[data-tour="…"]`) is not an element.
    for (const [, literal] of text.matchAll(/(?<!\[)data-tour="([^"]+)"/g)) literal.split(/\s+/).forEach((name) => names.add(name));
    for (const [, expression] of text.matchAll(/data-tour=\{([^`}]*)\}/g)) for (const [, literal] of expression.matchAll(/"([a-z0-9-]+(?: [a-z0-9-]+)*)"/g)) literal.split(" ").forEach((name) => names.add(name));
    for (const [, name] of text.replace(ITEM_TAGS, "").matchAll(/\btour="([a-z0-9-]+)"/g)) names.add(name);
  }
  const declaresItem = (file: string, id: string) => new RegExp(`\\bid:\\s*"${id}"|"${id}"\\s*[,\\]]`).test(readFileSync(file, "utf8"));
  return (target: string) => names.has(target) || [...prefixes].some(([prefix, file]) => target.startsWith(`${prefix}-`) && declaresItem(file, target.slice(prefix.length + 1)));
}

describe("tour targets", () => {
  it("every step's target and waitFor is a data-tour the product renders", () => {
    const exists = renderedTargets();
    const missing: string[] = [];
    for (const tour of tours) for (const step of tour.steps) {
      for (const field of ["target", "waitFor"] as const) {
        const value = step[field];
        if (!value) continue;
        for (const option of value.split("|")) {
          const name = option.replace(/#\{[a-z]+\}$/, "");
          if (!exists(name)) missing.push(`${tour.id} › ${step.id} › ${field}: ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
