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

// This historical file was intentionally not journaled. Migration 0032 creates
// the same brief tables conditionally because some early environments had
// already reserved/applied 0023. Keeping the exception explicit prevents a new
// unregistered migration from being silently ignored.
const intentionallyUnjournaled = new Set(["0023_pre_project_brief_scope"]);

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
});
