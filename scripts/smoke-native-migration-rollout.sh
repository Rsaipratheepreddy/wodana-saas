#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

for command_name in createdb dropdb psql node; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "Missing required command: $command_name" >&2; exit 1; }
done

database_name="wodana_native_migration_test_$$_${RANDOM}"
if ! [[ "$database_name" =~ ^wodana_native_migration_test_[0-9]+_[0-9]+$ ]]; then
  echo "Refusing to use an unexpected database name." >&2
  exit 1
fi
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/wodana-native-migrations.XXXXXX")"
cleanup() {
  exit_status=$?
  dropdb --force --if-exists "$database_name" >/dev/null 2>&1 || true
  rm -rf "$temporary_root"
  return "$exit_status"
}
trap cleanup EXIT INT TERM

node - "$repository_root" "$temporary_root" <<'NODE'
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const [root, output] = process.argv.slice(2);
const drizzle = join(root, "services/business-core/drizzle");
const entries = JSON.parse(readFileSync(join(drizzle, "meta/_journal.json"), "utf8")).entries;
const cutoff = entries.findIndex((entry) => entry.tag === "0075_workspace_primary_color");
if (cutoff < 0) throw new Error("The production baseline migration was not found.");

const render = (selected) => selected.map((entry) => {
  const source = readFileSync(join(drizzle, `${entry.tag}.sql`));
  const hash = createHash("sha256").update(source).digest("hex");
  return `${source.toString()}\nINSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('${hash}',${entry.when});\n`;
}).join("\n");

writeFileSync(join(output, "baseline.sql"), render(entries.slice(0, cutoff + 1)));
writeFileSync(join(output, "pending.sql"), render(entries.slice(cutoff + 1)));
writeFileSync(join(output, "expected.tsv"), entries.map((entry) => {
  const source = readFileSync(join(drizzle, `${entry.tag}.sql`));
  return `${entry.when}\t${createHash("sha256").update(source).digest("hex")}`;
}).join("\n") + "\n");
writeFileSync(join(output, "counts.json"), JSON.stringify({ baseline: cutoff + 1, pending: entries.length - cutoff - 1, total: entries.length }));
NODE

createdb "$database_name"
database_url="postgresql://127.0.0.1/${database_name}"
psql "$database_url" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE SCHEMA drizzle;
CREATE TABLE drizzle.__drizzle_migrations (
  id serial PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
SQL

{ printf 'BEGIN;\n'; cat "$temporary_root/baseline.sql"; printf '\nCOMMIT;\n'; } | \
  psql "$database_url" -v ON_ERROR_STOP=1 >/dev/null
baseline_count="$(psql "$database_url" -Atc 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
expected_baseline="$(node -e 'process.stdout.write(String(require(process.argv[1]).baseline))' "$temporary_root/counts.json")"
[[ "$baseline_count" == "$expected_baseline" ]]

{ printf 'BEGIN;\n'; cat "$temporary_root/pending.sql"; printf '\nROLLBACK;\n'; } | \
  psql "$database_url" -v ON_ERROR_STOP=1 >/dev/null
rehearsed_count="$(psql "$database_url" -Atc 'SELECT count(*) FROM drizzle.__drizzle_migrations')"
[[ "$rehearsed_count" == "$expected_baseline" ]]

{ printf 'BEGIN;\n'; cat "$temporary_root/pending.sql"; printf '\nCOMMIT;\n'; } | \
  psql "$database_url" -v ON_ERROR_STOP=1 >/dev/null
psql "$database_url" -AtF $'\t' \
  -c 'SELECT created_at,hash FROM drizzle.__drizzle_migrations ORDER BY created_at,id' > "$temporary_root/actual.tsv"
cmp -s "$temporary_root/expected.tsv" "$temporary_root/actual.tsv"

node - "$temporary_root/counts.json" <<'NODE'
const counts = require(process.argv[2]);
process.stdout.write(`${JSON.stringify({ ok: true, ...counts, rehearsalRolledBack: true, finalHistoryExact: true })}\n`);
NODE
