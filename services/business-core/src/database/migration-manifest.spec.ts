import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Journal = {
  entries: Array<{ idx: number; tag: string }>;
};

const drizzleDirectory = resolve(process.cwd(), "drizzle");
const journal = JSON.parse(
  readFileSync(resolve(drizzleDirectory, "meta/_journal.json"), "utf8"),
) as Journal;
const migrationFiles = readdirSync(drizzleDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .map((name) => name.replace(/\.sql$/, ""))
  .sort();

// v1 migrations are archived in drizzle/archive-v1 and squashed into 0000_v2_baseline.
// Every SQL file in drizzle/ must be journaled; there are no exceptions in v2.
const intentionallyUnjournaled = new Set<string>();

describe("database migration manifest", () => {
  it("has a SQL file for every journal entry", () => {
    const files = new Set(migrationFiles);
    expect(journal.entries.filter(({ tag }) => !files.has(tag))).toEqual([]);
  });

  it("does not silently leave new SQL migrations outside the journal", () => {
    const registered = new Set(journal.entries.map(({ tag }) => tag));
    expect(
      migrationFiles.filter(
        (tag) => !registered.has(tag) && !intentionallyUnjournaled.has(tag),
      ),
    ).toEqual([]);
  });

  it("keeps journal indexes unique and increasing", () => {
    const indexes = journal.entries.map(({ idx }) => idx);
    expect(new Set(indexes).size).toBe(indexes.length);
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
  });

  it("keeps journal timestamps increasing, so the migrator never skips a newer entry", () => {
    // drizzle applies an entry only when its `when` is later than the last one applied to the database.
    const stamps = (journal.entries as Array<{ tag: string; when: number }>).map(({ tag, when }) => ({ tag, when }));
    const backwards = stamps.filter((entry, index) => index > 0 && entry.when <= stamps[index - 1].when).map(({ tag }) => tag);
    expect(backwards).toEqual([]);
  });

  it("never switches tenant isolation off in a migration", () => {
    const offenders = migrationFiles.filter((tag) =>
      /DISABLE\s+ROW\s+LEVEL\s+SECURITY|NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(
        readFileSync(resolve(drizzleDirectory, `${tag}.sql`), "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
