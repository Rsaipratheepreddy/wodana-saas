import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  enabledBooksSettings, LedgerError, postJournal, readJournalLines, resolveRole, reversalDraft, toFunctional,
  type JournalDraft, type PostOutcome, type PostedJournal,
} from "./ledger";
import { applyTemplate } from "./templates";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Fixtures are committed in their own
// workspaces; every Ledger call runs as the app role under forced RLS, as the API and the sweep do.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const BOOKS_TABLES = ["books_settings", "books_accounts", "books_account_roles", "books_payment_accounts", "books_tax_codes", "books_journals",
  "books_journal_lines", "books_posting_issues", "books_manual_journals", "books_manual_journal_lines", "books_bill_captures"];

integration("Ledger core on real Postgres (templates, posting, numbering, immutability, tenancy)", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const ws = randomUUID(), otherWs = randomUUID();
  const people = { finance: randomUUID(), approver: randomUUID(), other: randomUUID() };
  const entity = randomUUID(), idleEntity = randomUUID(), otherEntity = randomUUID();

  async function tenant<T>(workspaceId: string, userId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, userId]);
      await client.query("SET LOCAL ROLE wodana_app");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  const post = (draft: JournalDraft, workspaceId = ws) => tenant(workspaceId, people.finance, (client) => postJournal(client, workspaceId, draft));
  const posted = (outcome: PostOutcome): PostedJournal => {
    if (outcome.status !== "posted" && outcome.status !== "existing") throw new Error(`Not posted: ${JSON.stringify(outcome)}`);
    return outcome.journal;
  };
  const source = (id = randomUUID(), event = "issued", type = "client_invoice") => ({ type, id, event, label: `INV ${id.slice(0, 4)}`, href: `/workspace/finance/invoices/${id}` });
  const invoice = (patch: Partial<JournalDraft> = {}): JournalDraft => ({
    legalEntityId: entity, eventDate: "2026-10-05", source: source(), currency: "AED",
    lines: [
      { account: { role: "ar_control" }, side: "debit", amount: "105000", party: { type: "client", id: people.other } },
      { account: { role: "revenue_project" }, side: "credit", amount: "100000" },
      { account: { role: "vat_output" }, side: "credit", amount: "5000" },
    ],
    ...patch,
  });
  const numberOf = (journal: PostedJournal) => Number(journal.number.split("-").pop());
  const sequenceNext = async () => (await pool.query<{ next: number }>(
    `SELECT next_number AS next FROM document_sequences WHERE workspace_id = $1 AND legal_entity_id = $2 AND document_type = 'JOURNAL'`, [ws, entity])).rows[0].next;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 6 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(people)) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${key}-${run}@books.test`, key]);
      }
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const workspace of [ws, otherWs]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Ledger firm',$2,'AED',$3)", [workspace, `books-${workspace.slice(0, 8)}`, people.finance]);
      }
      const company = `INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,$2,$3,$4,$4,'AE','AED','en-AE','Asia/Dubai')`;
      await client.query(company, [entity, ws, "MAIN", "Studio Interiors LLC"]);
      await client.query(company, [idleEntity, ws, "IDLE", "Studio Trading LLC"]);
      await client.query(company, [otherEntity, otherWs, "OTHER", "Other Firm LLC"]);
      await client.query(`INSERT INTO exchange_rates(workspace_id,base_currency,quote_currency,rate,effective_at,source,is_manual)
        VALUES($1,'USD','AED',3.6725,'2026-09-01T00:00:00Z','manual',true)`, [ws]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixture teardown only: immutable rows go with their workspace
      for (const table of [...BOOKS_TABLES].reverse()) await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [[ws, otherWs]]);
      for (const table of ["document_sequences", "exchange_rates", "audit_events", "legal_entities"]) {
        await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [[ws, otherWs]]);
      }
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [[ws, otherWs]]);
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(people)]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    await pool.end();
  });

  it("applies the AE template: settings off, the chart, every role, payment accounts and VAT codes; again changes nothing", async () => {
    const first = await tenant(ws, people.finance, (client) => applyTemplate(client, ws, entity, "AE", { actorId: people.finance, startDate: "2026-09-01" }));
    expect(first).toMatchObject({ template: { code: "AE", version: 1 }, accountsCreated: 65, rolesMapped: 26, paymentAccountsMapped: 12, taxCodesCreated: 10 });
    expect(first.settings).toMatchObject({ enabled: false, startDate: "2026-09-01", functionalCurrency: "AED", templateCode: "AE", templateVersion: 1, taxPointOnPayment: true });
    const again = await tenant(ws, people.finance, (client) => applyTemplate(client, ws, entity, "AE", { actorId: people.finance }));
    expect(again).toMatchObject({ accountsCreated: 0, rolesMapped: 0, paymentAccountsMapped: 0, taxCodesCreated: 0 });
    expect(again.settings.version).toBe(first.settings.version);
    await expect(tenant(ws, people.finance, (client) => applyTemplate(client, ws, entity, "IFRS"))).rejects.toMatchObject({ code: "template_conflict" });
    await expect(tenant(ws, people.finance, (client) => applyTemplate(client, ws, entity, "XX"))).rejects.toMatchObject({ code: "unknown_template" });

    const roles = await tenant(ws, people.finance, async (client) => ({
      ar: await resolveRole(client, ws, entity, "ar_control"), rounding: await resolveRole(client, ws, entity, "rounding"),
      vat: (await client.query<{ code: string; direction: string; box: string | null }>(
        `SELECT code, direction, rc_output_box AS box FROM books_tax_codes WHERE workspace_id = $1 AND legal_entity_id = $2 AND code IN ('RC', 'IG') ORDER BY code`,
        [ws, entity])).rows,
      cash: (await client.query<{ code: string }>(
        `SELECT account.code FROM books_payment_accounts payment JOIN books_accounts account ON account.id = payment.account_id
          WHERE payment.workspace_id = $1 AND payment.legal_entity_id = $2 AND payment.direction = 'out' AND payment.method = 'cash'`, [ws, entity])).rows[0].code,
    }));
    expect(roles).toMatchObject({ ar: { code: "1200", name: "Trade receivables" }, rounding: { code: "6990" }, cash: "1150",
      vat: [{ code: "IG", direction: "purchases", box: "6" }, { code: "RC", direction: "purchases", box: "3" }] });

    // The other tenant gets its own copy (for the isolation checks); the Ledger goes on from 1 Sep for both.
    await tenant(otherWs, people.other, (client) => applyTemplate(client, otherWs, otherEntity, "IFRS", { startDate: "2026-09-01" }));
    for (const [workspace, company] of [[ws, entity], [otherWs, otherEntity]]) {
      await tenant(workspace, people.finance, (client) => client.query(
        `UPDATE books_settings SET enabled = true, version = version + 1 WHERE workspace_id = $1 AND legal_entity_id = $2`, [workspace, company]));
    }
    expect((await tenant(ws, people.finance, (client) => enabledBooksSettings(client, ws))).map((row) => row.legalEntityId)).toEqual([entity]);
    const listed = await tenant(ws, people.finance, async (client) => (await client.query<{ workspace_id: string }>("SELECT workspace_id FROM list_books_workspaces()")).rows
      .map((row) => row.workspace_id));
    expect(listed).toEqual(expect.arrayContaining([ws, otherWs]));
  });

  it("posts an AED 105,000 invoice as Dr AR 105,000 / Cr revenue 100,000 / Cr VAT 5,000, numbered from the company's sequence", async () => {
    const draft = invoice();
    const outcome = await post(draft);
    expect(outcome.status).toBe("posted");
    const journal = posted(outcome);
    expect(journal).toMatchObject({ legalEntityId: entity, journalDate: "2026-10-05", late: false, kind: "auto", currency: "AED", functionalCurrency: "AED",
      rate: "1.000000000000", total: "105000.0000", sourceType: "client_invoice", sourceEvent: "issued" });
    expect(journal.number).toMatch(/^MAIN-JV-\d{6}$/);
    const lines = await tenant(ws, people.finance, (client) => readJournalLines(client, ws, journal.id));
    const codes = await tenant(ws, people.finance, async (client) => new Map((await client.query<{ id: string; code: string }>(
      "SELECT id, code FROM books_accounts WHERE workspace_id = $1", [ws])).rows.map((row) => [row.id, row.code])));
    expect(lines.map((line) => [codes.get(line.accountId), line.debit, line.credit])).toEqual([
      ["1200", "105000.0000", "0.0000"], ["4100", "0.0000", "100000.0000"], ["2200", "0.0000", "5000.0000"]]);
    expect(lines[0]).toMatchObject({ partyType: "client", partyId: people.other, docAmount: "105000.0000" });

    // Posting the same source event again (another sweep) returns the same journal and uses no number.
    const next = await sequenceNext();
    for (let sweep = 0; sweep < 3; sweep += 1) {
      const again = await post(draft);
      expect(again.status).toBe("existing");
      expect(posted(again).id).toBe(journal.id);
    }
    expect(await sequenceNext()).toBe(next);
  });

  it("never changes or deletes a posted journal: the app role can't, and the trigger stops even the owner", async () => {
    const journal = posted(await post(invoice()));
    await expect(tenant(ws, people.finance, (client) => client.query("UPDATE books_journals SET description = 'x' WHERE id = $1", [journal.id])))
      .rejects.toMatchObject({ code: "42501" });
    await expect(tenant(ws, people.finance, (client) => client.query("DELETE FROM books_journal_lines WHERE journal_id = $1", [journal.id])))
      .rejects.toMatchObject({ code: "42501" });
    await expect(pool.query("UPDATE books_journals SET description = 'x' WHERE id = $1", [journal.id])).rejects.toThrow(/never change/);
    await expect(pool.query("DELETE FROM books_journals WHERE id = $1", [journal.id])).rejects.toThrow(/never change/);
    await expect(pool.query("UPDATE books_journal_lines SET debit = debit + 1 WHERE journal_id = $1", [journal.id])).rejects.toThrow(/never change/);
    await expect(pool.query("DELETE FROM books_journal_lines WHERE journal_id = $1", [journal.id])).rejects.toThrow(/never change/);
  });

  it("refuses at commit a journal whose lines don't balance or don't add up to its total", async () => {
    const accounts = await tenant(ws, people.finance, async (client) => ({
      cash: (await resolveRole(client, ws, entity, "general_expense"))!.accountId, bank: (await resolveRole(client, ws, entity, "grni"))!.accountId,
    }));
    const attempt = async (lines: Array<[string, string, string]>, total = "100") => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ws]);
        await client.query("SET LOCAL ROLE wodana_app");
        const id = (await client.query<{ id: string }>(
          `INSERT INTO books_journals (workspace_id, legal_entity_id, number, journal_date, event_date, kind, source_type, source_id, source_event, currency,
                                       functional_currency, total)
           VALUES ($1, $2, $3, '2026-10-06', '2026-10-06', 'auto', 'labour', $4, 'costed', 'AED', 'AED', $5) RETURNING id`,
          [ws, entity, `TEST-${randomUUID().slice(0, 8)}`, randomUUID(), total])).rows[0].id;
        for (const [index, [account, debit, credit]] of lines.entries()) {
          await client.query(`INSERT INTO books_journal_lines (workspace_id, legal_entity_id, journal_id, position, account_id, debit, credit) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [ws, entity, id, index, account, debit, credit]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };
    await expect(attempt([[accounts.cash, "100", "0"], [accounts.bank, "0", "90"]])).rejects.toMatchObject({ code: "23514", constraint: "books_journal_balanced" });
    await expect(attempt([[accounts.cash, "90", "0"], [accounts.bank, "0", "90"]])).rejects.toMatchObject({ constraint: "books_journal_balanced" });
    await expect(attempt([])).rejects.toMatchObject({ constraint: "books_journal_balanced" });
    await expect(attempt([[accounts.cash, "100", "100"], [accounts.bank, "0", "0"]])).rejects.toMatchObject({ code: "23514" });
  });

  it("numbers gap-free when two transactions post at once, and a race on the same event posts it once", async () => {
    const waitForLockWait = async () => {
      for (let tries = 0; tries < 100; tries += 1) {
        const waiting = (await pool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")).rows[0].count;
        if (waiting > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("The second transaction never waited");
    };
    const open = async () => {
      const client = await pool.connect();
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ws]);
      await client.query("SET LOCAL ROLE wodana_app");
      return client;
    };
    const race = async (first: JournalDraft, second: JournalDraft) => {
      const a = await open(), b = await open();
      try {
        const one = posted(await postJournal(a, ws, first));
        const pending = postJournal(b, ws, second).then((outcome) => ({ outcome }), (error: unknown) => ({ error }));
        await waitForLockWait();
        await a.query("COMMIT");
        const settled = await pending;
        if ("error" in settled) throw settled.error;
        const two = settled.outcome;
        await b.query("COMMIT");
        return [one, two] as const;
      } finally {
        a.release();
        b.release();
      }
    };

    const [x, y] = await race(invoice(), invoice());
    expect(numberOf(posted(y))).toBe(numberOf(x) + 1);

    const same = invoice();
    const [z, again] = await race(same, same);
    expect(again.status).toBe("existing");
    expect(posted(again).id).toBe(z.id);
    const w = posted(await post(invoice()));
    expect(numberOf(w)).toBe(numberOf(z) + 1);
    // Every number from the first to the last is used exactly once.
    const numbers = await tenant(ws, people.finance, async (client) => (await client.query<{ number: string }>(
      `SELECT number FROM books_journals WHERE workspace_id = $1 AND legal_entity_id = $2 AND number LIKE 'MAIN-JV-%' ORDER BY number`, [ws, entity])).rows
      .map((row) => Number(row.number.split("-").pop())));
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => numbers[0] + index));
  });

  it("moves an event in the locked period to the first open day as late, refuses a manual journal there, and skips what came before the start", async () => {
    await tenant(ws, people.finance, (client) => client.query(
      `UPDATE books_settings SET lock_date = '2026-09-30', version = version + 1 WHERE workspace_id = $1 AND legal_entity_id = $2`, [ws, entity]));
    const late = posted(await post(invoice({ eventDate: "2026-09-29" })));
    expect(late).toMatchObject({ journalDate: "2026-10-01", eventDate: "2026-09-29", late: true });
    const manual = (eventDate: string): JournalDraft => ({
      legalEntityId: entity, kind: "manual", eventDate, source: { type: "manual_journal", id: randomUUID(), event: "approved" }, currency: "AED", postedBy: people.approver,
      lines: [{ account: { role: "general_expense" }, side: "debit", amount: "50" }, { account: { role: "employee_claims_payable" }, side: "credit", amount: "50" }],
    });
    await expect(post(manual("2026-09-29"))).rejects.toMatchObject({ code: "locked" });
    expect(posted(await post(manual("2026-10-02")))).toMatchObject({ kind: "manual", late: false, postedBy: people.approver });
    expect(await post(invoice({ eventDate: "2026-08-15" }))).toEqual({ status: "skipped", reason: "before_start" });
    await expect(post(manual("2026-08-15"))).rejects.toMatchObject({ code: "before_start" });
  });

  it("converts to the functional currency at the day's rate with the rounding residual on the rounding account", async () => {
    const journal = posted(await post({
      legalEntityId: entity, eventDate: "2026-10-07", source: source(randomUUID(), "approved", "supplier_bill"), currency: "USD",
      lines: [
        { account: { role: "cost_materials" }, side: "debit", amount: "100.00" },
        { account: { role: "ap_control" }, side: "credit", amount: "33.33" },
        { account: { role: "ap_control" }, side: "credit", amount: "33.33" },
        { account: { role: "ap_control" }, side: "credit", amount: "33.34" },
      ],
    }));
    expect(journal).toMatchObject({ currency: "USD", functionalCurrency: "AED", rate: "3.672500000000", total: "367.2500" });
    const lines = await tenant(ws, people.finance, (client) => readJournalLines(client, ws, journal.id));
    expect(lines.map((line) => [line.debit, line.credit, line.docAmount])).toEqual([
      ["367.2500", "0.0000", "100.0000"], ["0.0000", "122.4000", "33.3300"], ["0.0000", "122.4000", "33.3300"], ["0.0000", "122.4400", "33.3400"],
      ["0.0000", "0.0100", null]]);
    expect(lines[4].accountId).toBe((await tenant(ws, people.finance, (client) => resolveRole(client, ws, entity, "rounding")))!.accountId);
    // The inverse pair works too, and a currency without a rate is an issue to retry, not an error.
    expect(await tenant(ws, people.finance, (client) => toFunctional(client, ws, { amount: "367.25", currency: "AED", functionalCurrency: "USD", onDay: "2026-10-07" })))
      .toEqual({ amount: "100.0000", rate: "0.272294077604" });
    expect(await post(invoice({ currency: "EUR" }))).toMatchObject({ status: "issue", code: "missing_rate" });
  });

  it("returns issues for what can't post yet, and refuses what can never post", async () => {
    expect(await post(invoice({ legalEntityId: idleEntity }))).toMatchObject({ status: "issue", code: "entity_not_enabled" });
    const foreignAccount = (await pool.query<{ id: string }>("SELECT id FROM books_accounts WHERE workspace_id = $1 LIMIT 1", [otherWs])).rows[0].id;
    expect(await post(invoice({ lines: [{ account: { accountId: foreignAccount }, side: "debit", amount: "10" }, { account: { role: "revenue_other" }, side: "credit", amount: "10" }] })))
      .toMatchObject({ status: "issue", code: "missing_account" });
    expect(await post(invoice({ lines: [{ account: { role: "ar_control" }, side: "debit", amount: "10", taxCodeId: randomUUID() }, { account: { role: "revenue_other" }, side: "credit", amount: "10" }] })))
      .toMatchObject({ status: "issue", code: "unknown_tax" });
    await expect(post(invoice({ lines: [{ account: { role: "ar_control" }, side: "debit", amount: "10" }, { account: { role: "revenue_other" }, side: "credit", amount: "9" }] })))
      .rejects.toMatchObject({ code: "unbalanced" });
    // A manual journal never touches a control account; an opening balance may.
    const onControl = (kind: "manual" | "opening"): JournalDraft => ({
      legalEntityId: entity, kind, eventDate: "2026-10-03", source: { type: "manual_journal", id: randomUUID(), event: "approved" }, currency: "AED",
      lines: [{ account: { role: "ar_control" }, side: "debit", amount: "500" }, { account: { role: "opening_balance_equity" }, side: "credit", amount: "500" }],
    });
    await expect(post(onControl("manual"))).rejects.toBeInstanceOf(LedgerError);
    await expect(post(onControl("manual"))).rejects.toMatchObject({ code: "manual_not_allowed" });
    expect(posted(await post(onControl("opening"))).kind).toBe("opening");
  });

  it("reverses a journal once, with every line negated and linked to it", async () => {
    const original = posted(await post(invoice({ eventDate: "2026-10-08" })));
    const reversal = await tenant(ws, people.finance, async (client) => {
      const lines = await readJournalLines(client, ws, original.id);
      return posted(await postJournal(client, ws, reversalDraft(original, lines, { eventDate: "2026-10-09", source: source(original.sourceId, "credited") })));
    });
    expect(reversal).toMatchObject({ kind: "reversal", reversesJournalId: original.id, total: original.total, journalDate: "2026-10-09" });
    const [before, after] = await tenant(ws, people.finance, async (client) => [await readJournalLines(client, ws, original.id), await readJournalLines(client, ws, reversal.id)]);
    expect(after.map((line) => [line.accountId, line.debit, line.credit])).toEqual(before.map((line) => [line.accountId, line.credit, line.debit]));
    await expect(tenant(ws, people.finance, async (client) => postJournal(client, ws,
      reversalDraft(original, before, { eventDate: "2026-10-09", source: source(original.sourceId, "cancelled") })))).rejects.toMatchObject({ code: "23505" });
  });

  it("fixes the functional currency once the company has journals", async () => {
    await expect(tenant(ws, people.finance, (client) => client.query(
      `UPDATE books_settings SET functional_currency = 'USD' WHERE workspace_id = $1 AND legal_entity_id = $2`, [ws, entity]))).rejects.toThrow(/fixed once/);
  });

  it("keeps every Ledger table to its own workspace: nothing read, written or changed across tenants", async () => {
    const own = await tenant(ws, people.finance, async (client) => Object.fromEntries(await Promise.all(BOOKS_TABLES.map(async (table) =>
      [table, (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count] as const))));
    expect(own.books_journals).toBeGreaterThan(0);
    const seen = await tenant(otherWs, people.other, async (client) => Object.fromEntries(await Promise.all(BOOKS_TABLES.map(async (table) =>
      [table, (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} WHERE workspace_id = $1`, [ws])).rows[0].count] as const))));
    expect(seen).toEqual(Object.fromEntries(BOOKS_TABLES.map((table) => [table, 0])));

    const account = randomUUID(), journal = randomUUID(), manual = randomUUID();
    const inserts: Record<string, [string, unknown[]]> = {
      books_settings: ["INSERT INTO books_settings (workspace_id, legal_entity_id, start_date, functional_currency) VALUES ($1, $2, '2026-01-01', 'AED')", [ws, idleEntity]],
      books_accounts: ["INSERT INTO books_accounts (id, workspace_id, legal_entity_id, code, name, type) VALUES ($3, $1, $2, 'X1', 'X', 'asset')", [ws, entity, account]],
      books_account_roles: ["INSERT INTO books_account_roles (workspace_id, legal_entity_id, role, account_id) VALUES ($1, $2, 'rounding', $3)", [ws, entity, account]],
      books_payment_accounts: ["INSERT INTO books_payment_accounts (workspace_id, legal_entity_id, direction, method, account_id) VALUES ($1, $2, 'in', 'bank', $3)", [ws, entity, account]],
      books_tax_codes: [`INSERT INTO books_tax_codes (workspace_id, legal_entity_id, code, name, rate, treatment, direction, effective_from)
        VALUES ($1, $2, 'X', 'X', 5, 'standard', 'sales', '2026-01-01')`, [ws, entity]],
      books_journals: [`INSERT INTO books_journals (id, workspace_id, legal_entity_id, number, journal_date, event_date, kind, source_type, source_id, source_event, currency,
        functional_currency, total) VALUES ($3, $1, $2, 'X-1', '2026-10-01', '2026-10-01', 'auto', 'labour', 'x', 'costed', 'AED', 'AED', 1)`, [ws, entity, journal]],
      books_journal_lines: [`INSERT INTO books_journal_lines (workspace_id, legal_entity_id, journal_id, position, account_id, debit) VALUES ($1, $2, $3, 0, $4, 1)`,
        [ws, entity, journal, account]],
      books_posting_issues: ["INSERT INTO books_posting_issues (workspace_id, source_type, source_id, source_event, code) VALUES ($1, 'labour', 'x', 'costed', 'no_cost')", [ws]],
      books_manual_journals: [`INSERT INTO books_manual_journals (id, workspace_id, legal_entity_id, reference, journal_date, currency, prepared_by)
        VALUES ($3, $1, $2, 'MJ-999', '2026-10-01', 'AED', $4)`, [ws, entity, manual, people.other]],
      books_manual_journal_lines: [`INSERT INTO books_manual_journal_lines (workspace_id, legal_entity_id, manual_journal_id, position, account_id, debit)
        VALUES ($1, $2, $3, 0, $4, 1)`, [ws, entity, manual, account]],
      books_bill_captures: [`INSERT INTO books_bill_captures (workspace_id, storage_key, sha256, created_by) VALUES ($1, 'x', $2, $3)`, [ws, "a".repeat(64), people.other]],
    };
    expect(Object.keys(inserts).sort()).toEqual([...BOOKS_TABLES].sort());
    for (const [table, [statement, values]] of Object.entries(inserts)) {
      await expect(tenant(otherWs, people.other, (client) => client.query(statement, values)), table).rejects.toThrow(/row-level security/);
    }
    const changed = await tenant(otherWs, people.other, async (client) => (await client.query(
      "UPDATE books_settings SET enabled = false WHERE workspace_id = $1", [ws])).rowCount);
    expect(changed).toBe(0);
    // The other tenant's own Ledger works and stays its own.
    expect(posted(await post({ ...invoice(), legalEntityId: otherEntity }, otherWs)).number).toMatch(/^OTHER-JV-/);
    await expect(post({ ...invoice(), legalEntityId: otherEntity }, ws)).resolves.toMatchObject({ status: "issue", code: "entity_not_enabled" });
  });

  it("is cleared by the go-live reset: journals and issues go, the chart and settings stay", async () => {
    await tenant(ws, people.finance, (client) => client.query(
      "INSERT INTO books_posting_issues (workspace_id, legal_entity_id, source_type, source_id, source_event, code) VALUES ($1, $2, 'labour', 'x', 'costed', 'no_cost')",
      [ws, entity]));
    const slug = (await pool.query<{ slug: string }>("SELECT slug FROM workspaces WHERE id = $1", [ws])).rows[0].slug;
    const counts = async () => Object.fromEntries(await Promise.all(BOOKS_TABLES.map(async (table) =>
      [table, (await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} WHERE workspace_id = $1`, [ws])).rows[0].count] as const)));
    const before = await counts();
    await tenant(ws, people.finance, (client) => client.query("SELECT * FROM workspace_clear_records($1, $2, false)", [ws, slug]));
    const after = await counts();
    expect(after).toMatchObject({ books_journals: 0, books_journal_lines: 0, books_posting_issues: 0, books_settings: before.books_settings,
      books_accounts: before.books_accounts, books_account_roles: 26, books_tax_codes: 10 });
    // The immutable guards are back on.
    const guards = (await pool.query<{ enabled: string }>(
      "SELECT tgenabled AS enabled FROM pg_trigger WHERE tgname IN ('books_journals_immutable', 'books_journal_lines_immutable')")).rows;
    expect(guards.map((row) => row.enabled)).toEqual(["O", "O"]);
  });
});
