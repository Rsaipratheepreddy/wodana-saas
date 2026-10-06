import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WORKSPACE_CLEAR_LINKED_TABLES,
  WORKSPACE_CLEAR_TABLES,
  WORKSPACE_CLEARED_FILE_COLUMNS,
  WORKSPACE_FILE_LEDGER_TABLES,
  WORKSPACE_KEEP_TABLES,
  WORKSPACE_RESET_TABLES,
  WORKSPACE_TABLE_CLASSIFICATION,
} from "./workspace-clear-records.classification";

const drizzle = resolve(process.cwd(), "drizzle");
const migrations = readdirSync(drizzle)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort()
  .map((name) => readFileSync(resolve(drizzle, name), "utf8").replace(/--[^\n]*/g, ""));

function closingParen(sql: string, open: number) {
  let depth = 0;
  for (let index = open; index < sql.length; index += 1) {
    if (sql[index] === "(") depth += 1;
    else if (sql[index] === ")" && --depth === 0) return index;
  }
  return sql.length;
}

/** Tables that end up with a workspace_id column after every migration, read from the SQL itself. */
function tenantTablesFromMigrations(files: string[]) {
  const tables = new Set<string>();
  const name = String.raw`(?:public\.)?"?([a-z_][a-z0-9_]*)"?`;
  for (const sql of files) {
    const events: Array<{ at: number; apply: () => void }> = [];
    for (const match of sql.matchAll(new RegExp(String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${name}\s*\(`, "gi"))) {
      const open = (match.index ?? 0) + match[0].length - 1;
      const body = sql.slice(open + 1, closingParen(sql, open));
      const table = match[1];
      if (/(^|[,(])\s*"?workspace_id"?\s+uuid/im.test(body)) events.push({ at: match.index ?? 0, apply: () => tables.add(table) });
    }
    for (const match of sql.matchAll(new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${name}\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?workspace_id"?\s`, "gi"))) {
      events.push({ at: match.index ?? 0, apply: () => tables.add(match[1]) });
    }
    for (const match of sql.matchAll(new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${name}\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?workspace_id"?\b`, "gi"))) {
      events.push({ at: match.index ?? 0, apply: () => tables.delete(match[1]) });
    }
    for (const match of sql.matchAll(new RegExp(String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?${name}\s+RENAME\s+TO\s+"?([a-z_][a-z0-9_]*)"?`, "gi"))) {
      events.push({ at: match.index ?? 0, apply: () => { if (tables.delete(match[1])) tables.add(match[2]); } });
    }
    for (const match of sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+);/gi)) {
      const names = match[1].replace(/\b(CASCADE|RESTRICT)\b/gi, "").split(",")
        .map((part) => part.trim().replace(/^public\./, "").replace(/"/g, "")).filter(Boolean);
      events.push({ at: match.index ?? 0, apply: () => names.forEach((table) => tables.delete(table)) });
    }
    events.sort((left, right) => left.at - right.at).forEach((event) => event.apply());
  }
  return tables;
}

/** The classification rows seeded by the migrations (later rows win, as with ON CONFLICT DO UPDATE). */
function seededClassification(files: string[]) {
  const rows = new Map<string, { disposition: string; predicate: string | null; files: string[] }>();
  for (const sql of files) {
    for (const statement of sql.matchAll(/INSERT\s+INTO\s+workspace_record_classification\b[\s\S]*?;/gi)) {
      for (const row of statement[0].matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*'([a-z_]+)'\s*,\s*(NULL|'((?:[^']|'')*)')\s*,\s*('\{\}'|ARRAY\[([^\]]*)\])\s*\)/g)) {
        rows.set(row[1], {
          disposition: row[2],
          predicate: row[3] === "NULL" ? null : row[4].replace(/''/g, "'"),
          files: row[6] ? [...row[6].matchAll(/'([a-z0-9_]+)'/g)].map((column) => column[1]) : [],
        });
      }
    }
  }
  return rows;
}

describe("go-live reset classification", () => {
  it("names every table once", () => {
    const all = [
      ...WORKSPACE_KEEP_TABLES, ...WORKSPACE_CLEAR_TABLES, ...WORKSPACE_RESET_TABLES,
      ...WORKSPACE_FILE_LEDGER_TABLES, ...Object.keys(WORKSPACE_CLEAR_LINKED_TABLES),
    ];
    expect(all.filter((table, index) => all.indexOf(table) !== index)).toEqual([]);
    expect(all.length).toBe(WORKSPACE_TABLE_CLASSIFICATION.size);
  });

  it("classifies every tenant table the migrations create (a new table must be added to keep or clear)", () => {
    const tenant = tenantTablesFromMigrations(migrations);
    expect([...tenant].filter((table) => !WORKSPACE_TABLE_CLASSIFICATION.has(table)).sort(),
      "unclassified tenant tables: add them to workspace-clear-records.classification.ts and seed them in a migration").toEqual([]);
    expect([...WORKSPACE_TABLE_CLASSIFICATION.keys()].filter((table) => !tenant.has(table)).sort(),
      "classified tables no migration creates").toEqual([]);
  });

  it("matches the classification the migrations seed for the SQL function", () => {
    const seeded = seededClassification(migrations);
    const expected = [...WORKSPACE_TABLE_CLASSIFICATION.entries()].map(([table, disposition]) => [table, {
      disposition,
      predicate: WORKSPACE_CLEAR_LINKED_TABLES[table] ?? null,
      files: [...(WORKSPACE_CLEARED_FILE_COLUMNS[table] ?? [])],
    }] as const).sort(([left], [right]) => left.localeCompare(right));
    expect([...seeded.entries()].sort(([left], [right]) => left.localeCompare(right))).toEqual(expected);
  });

  it("only collects files from rows the reset removes", () => {
    for (const table of Object.keys(WORKSPACE_CLEARED_FILE_COLUMNS)) {
      expect(["clear", "clear_linked"], table).toContain(WORKSPACE_TABLE_CLASSIFICATION.get(table));
    }
  });

  it("keeps people, access, configuration and the audit trail", () => {
    for (const table of [
      "workspace_memberships", "workspace_member_profiles", "member_roles", "roles", "role_permissions", "workspace_teams",
      "workspace_invitations", "crm_flows", "crm_flow_versions", "crm_pipelines", "crm_pipeline_stages", "legal_entities",
      "workspace_brand_assets", "notification_templates", "integration_connections", "approval_policies", "document_sequences",
      "project_templates", "workspace_quotation_settings", "workspace_proposal_kits", "audit_events", "hrms_employees",
    ]) expect(WORKSPACE_TABLE_CLASSIFICATION.get(table), table).toBe("keep");
  });

  it("clears the funnel, delivery, suppliers and catalogue items", () => {
    for (const table of [
      "crm_leads", "crm_parties", "crm_opportunities", "crm_conversations", "pre_project_cases", "commercial_cases",
      "commercial_quotes", "client_invoices", "delivery_projects", "purchase_orders", "stock_movements", "workspace_vendors",
      "catalog_items", "price_entries", "work_orders", "client_portal_grants", "notifications", "outbox_events", "ai_agent_runs",
    ]) expect(WORKSPACE_TABLE_CLASSIFICATION.get(table), table).toBe("clear");
  });
});
