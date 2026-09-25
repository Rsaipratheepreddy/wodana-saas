import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyCommercial } from "./commercial.domain";
import type { CommercialData, Quote } from "./commercial.types";
import { commercialRepository } from "./commercial-repository";

// Opt-in: PROJECT_REPOSITORY_TEST_DATABASE_URL must point at a local, migrated database with a
// superuser role. Every test runs in a transaction that is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const quote = (id: string, number: number, extra: Partial<Quote> = {}): Quote => ({
  id, number, kind: "quotation", status: "draft", title: `Quote ${number}`, currency: "AED",
  validUntil: "2026-10-31", discount: 0, taxRate: 5, terms: "50% advance", exclusions: "Appliances",
  requestIds: [], paymentTerms: [{ id: "t1", label: "Advance", percent: 50, trigger: "On signing" }] as Quote["paymentTerms"],
  createdAt: "2026-09-25T10:15:30.123Z", total: 10500.25,
  lines: [
    { id: "l1", room: "Kitchen", title: "Base cabinets", specification: "BWP ply", material: "Ply", finish: "Acrylic", quantity: 12.5, unit: "rft", unitCost: 400.1, rate: 620.75, materialRows: [] },
    { id: "l2", room: "Kitchen", title: "Soft-close upgrade", specification: "", material: "", finish: "", quantity: 1, unit: "set", unitCost: 0, rate: 850, optional: true, scopeId: "scope-7" },
  ],
  ...extra,
});

integration("commercial repository with PostgreSQL", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withCase(work: (client: PoolClient, workspaceId: string, caseId: string) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), actor = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE workspaces DISABLE TRIGGER ALL");
      await client.query("ALTER TABLE pre_project_cases DISABLE TRIGGER ALL");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Quotes',$2,'AED',$3)", [workspaceId, `quotes-${workspaceId.slice(0, 8)}`, actor]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, randomUUID(), actor]);
      await client.query("ALTER TABLE workspaces ENABLE TRIGGER ALL");
      await client.query("ALTER TABLE pre_project_cases ENABLE TRIGGER ALL");
      await work(client, workspaceId, caseId);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const commercial = (quotes: Quote[]): CommercialData => ({ ...emptyCommercial(), revision: 1, quotes });

  it("round-trips quotes, lines, money and untyped details exactly", async () => {
    await withCase(async (client, workspaceId, caseId) => {
      const first = quote("q1", 1, {
        round: "design", status: "accepted", hash: "abc123", familyId: "fam",
        presentation: { theme: "light", pages: [{ id: "p1", blocks: ["data:cover-client"] }] } as unknown as Quote["presentation"],
        qsEstimate: { quoteHash: "abc123", cost: 5000.5, sellingTotal: 10500.25, reviewedAt: "2026-09-25T11:00:00.000Z", reviewedById: "qs", reviewedBy: "QS" },
        clientDecision: { decision: "accept", quoteHash: "abc123", selectedOptionLineIds: ["l2"], baseTotal: 10500.25, optionsTotal: 850, acceptedTotal: 11350.25, decidedAt: "2026-09-26T08:00:00.000Z", decidedBy: "Client" },
      });
      const second = quote("q2", 2, { kind: "variation", direction: "deduction", validUntil: "", lines: [] });
      const saved = commercial([first, second]);

      await commercialRepository.save(client, workspaceId, caseId, saved);
      const loaded = await commercialRepository.load(client, workspaceId, caseId, { forUpdate: true });

      expect(loaded?.content.quotes).toEqual([first, second]);
      expect(loaded?.content).toEqual(saved);
      const stored = await client.query("SELECT content ? 'quotes' AS embedded FROM commercial_cases WHERE case_id=$1", [caseId]);
      expect(stored.rows[0].embedded).toBe(false);
      const money = await client.query("SELECT total::text, (SELECT sum(quantity*rate)::text FROM commercial_quote_lines WHERE quote_id='q1' AND case_id=$1) AS lines FROM commercial_quotes WHERE id='q1' AND case_id=$1", [caseId]);
      expect(money.rows[0]).toEqual({ total: "10500.25", lines: "8609.375" });
    });
  });

  it("updates, reorders and removes quotes and lines", async () => {
    await withCase(async (client, workspaceId, caseId) => {
      await commercialRepository.save(client, workspaceId, caseId, commercial([quote("a", 1), quote("b", 2)]));
      const revised = quote("b", 2, { status: "issued", lines: [quote("b", 2).lines[1]] });
      await commercialRepository.save(client, workspaceId, caseId, commercial([revised]));
      const loaded = await commercialRepository.load(client, workspaceId, caseId);
      expect(loaded?.content.quotes).toEqual([revised]);
      const lines = await client.query("SELECT count(*)::int AS count FROM commercial_quote_lines WHERE case_id=$1", [caseId]);
      expect(lines.rows[0].count).toBe(1);
    });
  });

  it("rejects a duplicate quote number in one case", async () => {
    await withCase(async (client, workspaceId, caseId) => {
      await expect(commercialRepository.save(client, workspaceId, caseId, commercial([quote("a", 1), quote("b", 1)]))).rejects.toThrow(/unique|duplicate/i);
    });
  });

  it("hides another workspace's quotes", async () => {
    await withCase(async (client, workspaceId, caseId) => {
      await commercialRepository.save(client, workspaceId, caseId, commercial([quote("a", 1)]));
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [randomUUID()]);
      const visible = await client.query("SELECT count(*)::int AS count FROM commercial_quotes WHERE case_id=$1", [caseId]);
      expect(visible.rows[0].count).toBe(0);
    });
  });
});
