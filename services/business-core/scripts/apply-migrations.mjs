#!/usr/bin/env node
// Applies the drizzle migrations that are not yet recorded, in journal order, one transaction each,
// recording them in drizzle.__drizzle_migrations exactly as drizzle-kit does (sha256 of the file,
// created_at = the journal's `when`). Unlike `drizzle-kit migrate`, a migration counts as applied
// only when its own `when` is recorded, so a branch merged later with an older `when` still runs.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = process.env.MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");

const client = new pg.Client({ connectionString: url, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('wodana:migrations'))");
  await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
  await client.query("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)");
  const done = new Set((await client.query("SELECT created_at FROM drizzle.__drizzle_migrations")).rows.map((row) => Number(row.created_at)));
  const { entries } = JSON.parse(readFileSync(join(root, "meta", "_journal.json"), "utf8"));
  let applied = 0;
  for (const entry of entries) {
    if (done.has(entry.when)) continue;
    const sql = readFileSync(join(root, `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [hash, entry.when]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${entry.tag} failed: ${error instanceof Error ? error.message : error}`);
    }
    applied += 1;
    console.log(`applied ${entry.tag}`);
  }
  console.log(`migrations: ${applied} applied, ${entries.length} in the journal`);
} finally {
  await client.end();
}
