import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval, pendingForPerson } from "../../approvals/approval-engine";
import { APPROVAL_OUTCOMES } from "../../approvals/approval-outcomes";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { readJournalLines, readJournal as readPostedJournal } from "../ledger/ledger";
import type { BooksCtx } from "../settings/books-common";
import { readOverview, readSettings, runSettingsCommand } from "../settings/books-settings";
import { listJournals, previewOpening, readJournal, runJournalCommand } from "./manual-journals";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Fixtures are committed in their own
// workspaces; every command runs as the app role under forced RLS, as the API does.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Person = "manager" | "controller" | "preparer" | "approver" | "viewer" | "outsider";

const BOOKS_TABLES = ["books_commands", "books_manual_journal_lines", "books_manual_journals", "books_journal_lines", "books_journals", "books_posting_issues",
  "books_tax_codes", "books_payment_accounts", "books_account_roles", "books_accounts", "books_settings"];

integration("Ledger settings, manual and opening journals on real Postgres (commands, approvals, notices, tenancy)", () => {
  let pool: Pool;
  const ws = randomUUID(), otherWs = randomUUID();
  const people: Record<Person, string> = { manager: randomUUID(), controller: randomUUID(), preparer: randomUUID(), approver: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
  const entity = randomUUID(), otherEntity = randomUUID(), vendor = randomUUID();

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

  /** What a person may do, from their roles (the service asks the workspace access check the same question). */
  const ctx = (client: PoolClient, person: Person, workspaceId = person === "outsider" ? otherWs : ws): BooksCtx => ({
    workspaceId, userId: people[person],
    can: async (code) => Boolean((await client.query(
      `SELECT 1 FROM workspace_memberships membership JOIN effective_member_roles role ON role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = role.role_id JOIN permissions permission ON permission.id = granted.permission_id
        WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active' AND permission.code = $3`, [workspaceId, people[person], code])).rowCount),
  });
  const settingsCommand = (person: Person, body: Record<string, unknown>, commandId = randomUUID()) =>
    tenant(ws, people[person], async (client) => readSettings(client, ctx(client, person), await runSettingsCommand(client, ctx(client, person), { commandId, legalEntityId: entity, ...body })));
  const settings = (person: Person = "manager") => tenant(ws, people[person], (client) => readSettings(client, ctx(client, person), entity));
  const journalCommand = (person: Person, body: Record<string, unknown>, commandId = randomUUID()) =>
    tenant(ws, people[person], async (client) => readJournal(client, ctx(client, person), await runJournalCommand(client, ctx(client, person), { commandId, ...body })));
  const journal = (person: Person, id: string) => tenant(ws, people[person], (client) => readJournal(client, ctx(client, person), id));
  const superQuery = async <R extends Record<string, unknown>>(sql: string, values: unknown[] = []) => (await pool.query<R>(sql, values)).rows;
  const auditCount = async (action: string, entityId: string) =>
    Number((await superQuery<{ count: string }>(`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = $2 AND entity_id = $3`, [ws, action, entityId]))[0].count);
  const notices = (person: Person, code: string) =>
    superQuery<{ subject: string; body: string; channel: string }>(`SELECT subject, body, channel FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = $3 ORDER BY created_at`,
      [ws, people[person], code]);

  let accounts: Record<string, { id: string; version: number }> = {};
  const account = (code: string) => accounts[code].id;
  const refreshAccounts = async () => {
    accounts = Object.fromEntries((await settings()).accounts.map((row) => [row.code, { id: row.id, version: row.version }]));
  };

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 4 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(people)) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${key}-${id.slice(0, 8)}@books.test`, key[0].toUpperCase() + key.slice(1)]);
      }
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const workspace of [ws, otherWs]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Ledger firm',$2,'AED',$3)", [workspace, `a2-${workspace.slice(0, 8)}`, people.manager]);
      }
      const roles: Record<Exclude<Person, "outsider">, string[]> = {
        manager: ["books.view", "books.manage"],
        controller: ["books.view", "books.post", "books.approve", "books.manage"],
        preparer: ["books.view", "books.post"],
        approver: ["books.view", "books.approve"],
        viewer: ["books.view"],
      };
      const member = async (workspace: string, person: Person, code: string, permissions: string[]) => {
        const roleId = randomUUID(), membership = randomUUID();
        await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,$3,$3,false)", [roleId, workspace, code]);
        await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])", [workspace, roleId, permissions]);
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspace, people[person]]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspace, membership, roleId]);
      };
      for (const [person, permissions] of Object.entries(roles) as Array<[Exclude<Person, "outsider">, string[]]>) await member(ws, person, person, permissions);
      await member(otherWs, "outsider", "finance", ["books.view", "books.post", "books.approve", "books.manage"]);
      const company = `INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,$2,$3,$4,$4,'AE','AED','en-AE','Asia/Dubai')`;
      await client.query(company, [entity, ws, "MAIN", "Studio Interiors LLC"]);
      await client.query(company, [otherEntity, otherWs, "OTHER", "Other Firm LLC"]);
      await client.query(`INSERT INTO workspace_vendors(workspace_id,id,code,display_name,created_by,updated_by) VALUES($1,$2,'NILE','Nile Marble',$3,$3)`, [ws, vendor, people.manager]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, ws);
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
      const workspaces = [ws, otherWs];
      for (const table of BOOKS_TABLES) await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [workspaces]);
      for (const table of ["approval_decisions", "approval_requests", "approval_policy_steps", "approval_policy_versions", "approval_policies", "notifications",
        "notification_templates", "document_sequences", "audit_events", "outbox_events", "workspace_vendors", "member_roles", "workspace_memberships", "role_permissions", "roles",
        "legal_entities"]) {
        await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [workspaces]);
      }
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [workspaces]);
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(people)]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    await pool.end();
  });

  it("offers the company's country template first, and only people who set up the Ledger turn it on (once per command id, audited)", async () => {
    const overview = await tenant(ws, people.viewer, (client) => readOverview(client, ctx(client, "viewer")));
    expect(overview.canManage).toBe(false);
    expect(overview.companies).toHaveLength(1);
    expect(overview.companies[0]).toMatchObject({ id: entity, settings: null });
    expect(overview.companies[0].templates.map((item) => [item.code, item.recommended])).toEqual([["AE", true], ["IFRS", false]]);

    await expect(settingsCommand("preparer", { action: "turn_on", templateCode: "AE", startDate: "2026-10-01" })).rejects.toMatchObject({ status: 403 });
    await expect(settingsCommand("manager", { action: "turn_on", templateCode: "GB", startDate: "2026-10-01" })).rejects.toMatchObject({ status: 400 });
    // The template's return splits by region: turning on asks for it (none in the company's address yet), or every sale is in no box.
    expect(overview.companies[0].turnOnRegions?.AE).toMatchObject({ label: "Emirate", suggested: null });
    expect(overview.companies[0].turnOnRegions?.AE?.options.map((region) => region.code)).toContain("DXB");
    expect(overview.companies[0].turnOnRegions?.IFRS).toBeUndefined();
    await expect(settingsCommand("manager", { action: "turn_on", templateCode: "AE", startDate: "2026-10-01" })).rejects.toThrow("Choose the emirate the company's tax return is for.");
    // The company's address names it: that's the suggestion.
    await superQuery(`UPDATE legal_entities SET address = '{"region": "dubai"}'::jsonb WHERE id = $1`, [entity]);
    const suggested = await tenant(ws, people.viewer, (client) => readOverview(client, ctx(client, "viewer")));
    expect(suggested.companies[0].turnOnRegions?.AE?.suggested).toBe("DXB");

    const commandId = randomUUID();
    const on = await settingsCommand("manager", { action: "turn_on", templateCode: "AE", startDate: "2026-10-01", vatRegion: "DXB" }, commandId);
    expect(on.company.settings).toMatchObject({ enabled: true, startDate: "2026-10-01", templateCode: "AE", templateVersion: 1, vatRegion: "DXB", functionalCurrency: "AED" });
    expect(on.accounts).toHaveLength(65);
    expect(on.roles.every((role) => role.accountId)).toBe(true);
    expect(on.regions.options.map((region) => region.code)).toContain("DXB");
    // The same command again changes nothing; a second turn-on is refused.
    const replay = await settingsCommand("manager", { action: "turn_on", templateCode: "AE", startDate: "2026-10-01" }, commandId);
    expect(replay.company.settings!.version).toBe(on.company.settings!.version);
    expect(await auditCount("books.turned_on", entity)).toBe(1);
    await expect(settingsCommand("manager", { action: "turn_on", templateCode: "AE", startDate: "2026-10-01" })).rejects.toMatchObject({ status: 409 });
    await refreshAccounts();
  });

  it("edits the chart: add, rename with version checks, control rules, roles, archive (never delete)", async () => {
    const added = await settingsCommand("manager", { action: "add_account", code: "6195", name: "Software", type: "expense", subtype: "admin" });
    const software = added.accounts.find((row) => row.code === "6195")!;
    expect(software).toMatchObject({ name: "Software", type: "expense", isControl: false, allowManual: true, used: false });
    await expect(settingsCommand("manager", { action: "add_account", code: "6195", name: "Again", type: "expense" })).rejects.toMatchObject({ status: 409 });

    await expect(settingsCommand("manager", { action: "update_account", accountId: software.id, version: software.version + 1, name: "Software subscriptions" }))
      .rejects.toMatchObject({ status: 409 });
    const renamed = await settingsCommand("manager", { action: "update_account", accountId: software.id, version: software.version, name: "Software subscriptions" });
    expect(renamed.accounts.find((row) => row.id === software.id)).toMatchObject({ name: "Software subscriptions", version: software.version + 1 });
    expect(await auditCount("books.account_changed", software.id)).toBe(1);

    // A control account never takes manual entries; receivables stay a control account.
    await expect(settingsCommand("manager", { action: "update_account", accountId: software.id, version: software.version + 1, isControl: true, allowManual: true }))
      .rejects.toMatchObject({ status: 422 });
    const receivables = renamed.accounts.find((row) => row.code === "1200")!;
    expect(receivables).toMatchObject({ isControl: true, allowManual: false, roles: ["ar_control"] });
    await expect(settingsCommand("manager", { action: "update_account", accountId: receivables.id, version: receivables.version, isControl: false, allowManual: true }))
      .rejects.toMatchObject({ status: 422 });

    // Roles: of the right type, control only for receivables and payables, version-checked.
    const roleVersion = renamed.roles.find((row) => row.role === "general_expense")!.version;
    await expect(settingsCommand("manager", { action: "map_role", role: "ar_control", accountId: software.id, version: 1 })).rejects.toMatchObject({ status: 422 });
    await expect(settingsCommand("manager", { action: "map_role", role: "general_expense", accountId: receivables.id, version: roleVersion })).rejects.toMatchObject({ status: 422 });
    await expect(settingsCommand("manager", { action: "map_role", role: "general_expense", accountId: software.id, version: roleVersion + 5 })).rejects.toMatchObject({ status: 409 });
    const mapped = await settingsCommand("manager", { action: "map_role", role: "general_expense", accountId: software.id, version: roleVersion });
    expect(mapped.roles.find((row) => row.role === "general_expense")).toMatchObject({ accountId: software.id, version: roleVersion + 1 });

    // An account a role points at isn't archived; once remapped it is (and restored).
    const current = mapped.accounts.find((row) => row.id === software.id)!;
    await expect(settingsCommand("manager", { action: "archive_account", accountId: software.id, version: current.version })).rejects.toMatchObject({ status: 409 });
    await settingsCommand("manager", { action: "map_role", role: "general_expense", accountId: account("6100"), version: roleVersion + 1 });
    const archived = await settingsCommand("manager", { action: "archive_account", accountId: software.id, version: current.version });
    expect(archived.accounts.find((row) => row.id === software.id)).toMatchObject({ archived: true });
    expect(await auditCount("books.account_archived", software.id)).toBe(1);
    // There is no delete: the app role can't remove an account.
    await expect(tenant(ws, people.manager, (client) => client.query(`DELETE FROM books_accounts WHERE workspace_id = $1 AND id = $2`, [ws, software.id])))
      .rejects.toThrow(/permission denied/);
    await refreshAccounts();
  });

  it("maps payment accounts to open asset accounts, and keeps tax codes effective-dated without overlaps", async () => {
    const before = await settings();
    const cashIn = before.paymentAccounts.find((row) => row.direction === "in" && row.method === "cash")!;
    await expect(settingsCommand("manager", { action: "map_payment_account", direction: "in", method: "cash", accountId: account("4100"), version: cashIn.version }))
      .rejects.toMatchObject({ status: 422 });
    const moved = await settingsCommand("manager", { action: "map_payment_account", direction: "in", method: "cash", accountId: account("1100"), version: cashIn.version });
    expect(moved.paymentAccounts.find((row) => row.direction === "in" && row.method === "cash")).toMatchObject({ accountId: account("1100"), version: cashIn.version + 1 });
    const cleared = await settingsCommand("manager", { action: "map_payment_account", direction: "in", method: "cash", accountId: null, version: cashIn.version + 1 });
    expect(cleared.paymentAccounts.find((row) => row.direction === "in" && row.method === "cash")).toMatchObject({ accountId: null, version: 0 });

    const sales = cleared.taxCodes.find((row) => row.code === "SR" && row.direction === "sales")!;
    expect(sales).toMatchObject({ rate: "5", effectiveFrom: "2018-01-01", effectiveTo: null });
    await expect(settingsCommand("manager", { action: "add_tax_code", code: "SR", name: "Standard rated", direction: "sales", rate: "6", treatment: "standard",
      baseBox: "1", taxBox: "1", effectiveFrom: "2027-01-01" })).rejects.toMatchObject({ status: 409 });
    await expect(settingsCommand("manager", { action: "add_tax_code", code: "XR", name: "Bad", direction: "sales", rate: "5", treatment: "standard", recoverable: true,
      effectiveFrom: "2027-01-01" })).rejects.toMatchObject({ status: 422 });
    await expect(settingsCommand("manager", { action: "update_tax_code", taxCodeId: sales.id, version: sales.version + 1, effectiveTo: "2026-12-31" }))
      .rejects.toMatchObject({ status: 409 });
    await settingsCommand("manager", { action: "update_tax_code", taxCodeId: sales.id, version: sales.version, effectiveTo: "2026-12-31" });
    const added = await settingsCommand("manager", { action: "add_tax_code", code: "SR", name: "Standard rated", direction: "sales", rate: "6", treatment: "standard",
      baseBox: "1", taxBox: "1", effectiveFrom: "2027-01-01" });
    expect(added.taxCodes.filter((row) => row.code === "SR" && row.direction === "sales").map((row) => [row.rate, row.effectiveFrom, row.effectiveTo]))
      .toEqual([["5", "2018-01-01", "2026-12-31"], ["6", "2027-01-01", null]]);
    expect(await auditCount("books.tax_code_changed", sales.id)).toBe(1);
  });

  it("imports opening balances from a trial balance: unknown codes refused by row, the totals must balance, then approval posts it on the start date", async () => {
    const preview = (csv: string) => tenant(ws, people.preparer, (client) => previewOpening(client, ctx(client, "preparer"), { legalEntityId: entity, csv }));
    const unknown = await preview("Code,Account,Debit,Credit\n1100,Bank,\"50,000.00\",\n9999,Mystery,,100\n3100,Retained earnings,,49900\n");
    expect(unknown.errors).toEqual([{ row: 3, message: "There is no account 9999" }]);
    const unbalanced = await preview("Code,Account,Debit,Credit\n1100,Bank,50000,\n3100,Retained earnings,,40000\n");
    expect(unbalanced.balanced).toBe(false);
    expect(unbalanced.errors[0].message).toMatch(/differ by 10000\.0000\. Add the difference to 3900 Opening balance equity/);
    await expect(journalCommand("preparer", { action: "import_opening", id: randomUUID(), legalEntityId: entity,
      csv: "Code,Account,Debit,Credit\n1100,Bank,50000,\n9999,Mystery,,50000\n" })).rejects.toMatchObject({ status: 422, response: { errors: [{ row: 3 }] } });

    // Control accounts (receivables, payables) take opening balances.
    const csv = "Code,Account,Debit,Credit\n1100,Bank,50000,\n1200,Trade receivables,20000,\n2100,Trade payables,,15000\n3900,Opening balance equity,,55000\n";
    const ok = await preview(csv);
    expect(ok).toMatchObject({ balanced: true, errors: [], debit: "70000.0000", credit: "70000.0000", journalDate: "2026-10-01", asAt: "2026-09-30" });
    const id = randomUUID();
    const imported = await journalCommand("preparer", { action: "import_opening", id, legalEntityId: entity, csv });
    expect(imported.journal).toMatchObject({ kind: "opening", status: "submitted", journalDate: "2026-10-01", reference: expect.stringMatching(/^MJ-\d+$/) });
    expect(imported.lines.map((line) => line.accountCode)).toEqual(["1100", "1200", "2100", "3900"]);
    await expect(journalCommand("preparer", { action: "import_opening", id: randomUUID(), legalEntityId: entity, csv })).rejects.toMatchObject({ status: 409 });

    const approved = await journalCommand("approver", { action: "approve", id, version: imported.journal.version });
    expect(approved.journal).toMatchObject({ status: "approved", approvedBy: people.approver, postedNumber: expect.stringMatching(/^MAIN-JV-\d{6}$/) });
    const posted = await tenant(ws, people.approver, (client) => readPostedJournal(client, ws, approved.journal.postedJournalId!));
    expect(posted).toMatchObject({ kind: "opening", journalDate: "2026-10-01", total: "70000.0000", sourceType: "manual_journal", sourceId: id });
  });

  it("runs a manual journal through approval: balanced before submit, control accounts refused, never self-approved, returned with a reason, posted with a JV number", async () => {
    const id = randomUUID();
    const line = (code: string, side: "debit" | "credit", value: string, extra: Record<string, unknown> = {}) =>
      ({ accountId: account(code), [side]: value, ...extra });
    await expect(journalCommand("preparer", { action: "save", id, version: 0, legalEntityId: entity, journalDate: "2026-10-06", memo: "Rent accrual",
      lines: [line("1200", "debit", "100"), line("1100", "credit", "100")] })).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/Line 1: 1200/) });
    await expect(journalCommand("viewer", { action: "save", id, version: 0, legalEntityId: entity, journalDate: "2026-10-06", lines: [] })).rejects.toMatchObject({ status: 403 });

    // A draft may be unbalanced; it can't be submitted until it balances.
    const saveId = randomUUID();
    const draft = await journalCommand("preparer", { action: "save", id, version: 0, legalEntityId: entity, journalDate: "2026-10-06", memo: "Rent accrual",
      lines: [line("6120", "debit", "1500.50", { party: { type: "vendor", id: vendor } }), line("2140", "credit", "1500")] }, saveId);
    expect(draft.journal).toMatchObject({ status: "draft", debit: "1500.5000", credit: "1500.0000", lineCount: 2 });
    expect(draft.lines[0]).toMatchObject({ partyType: "vendor", partyName: "Nile Marble" });
    // The same save again is the same draft.
    await journalCommand("preparer", { action: "save", id, version: 0, legalEntityId: entity, journalDate: "2026-10-06", lines: [] }, saveId);
    expect(await auditCount("books.manual_journal_drafted", id)).toBe(1);
    await expect(journalCommand("preparer", { action: "submit", id, version: draft.journal.version })).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/don't balance/) });

    const fixed = await journalCommand("preparer", { action: "save", id, version: draft.journal.version, legalEntityId: entity, journalDate: "2026-10-06", memo: "Rent accrual",
      lines: [line("6120", "debit", "1500.50", { party: { type: "vendor", id: vendor } }), line("2140", "credit", "1500.50")] });
    await expect(journalCommand("preparer", { action: "submit", id, version: draft.journal.version })).rejects.toMatchObject({ status: 409 });
    const submitted = await journalCommand("preparer", { action: "submit", id, version: fixed.journal.version });
    expect(submitted.journal.status).toBe("submitted");
    expect(submitted.approval).toMatchObject({ kind: "manual_journal", status: "pending", amount: "1500.5", currency: "AED" });

    // It waits in the approver's inbox, not the preparer's; the preparer can't approve it, nor can a viewer.
    const inbox = await tenant(ws, people.approver, (client) => pendingForPerson(client, ws, people.approver));
    expect(inbox.find((item) => item.status.subjectId === id)?.eligibility.canDecide).toBe(true);
    const own = await tenant(ws, people.preparer, (client) => pendingForPerson(client, ws, people.preparer));
    expect(own.find((item) => item.status.subjectId === id)?.eligibility.canDecide ?? false).toBe(false);
    await expect(journalCommand("preparer", { action: "approve", id, version: submitted.journal.version })).rejects.toMatchObject({ status: 403 });
    await expect(journalCommand("viewer", { action: "approve", id, version: submitted.journal.version })).rejects.toMatchObject({ status: 403 });
    expect((await journal("approver", id)).canApprove).toBe(true);
    expect((await journal("preparer", id)).canApprove).toBe(false);

    // Returned with the reason: the preparer hears it, changes it and sends it again.
    await expect(journalCommand("approver", { action: "return", id, version: submitted.journal.version })).rejects.toMatchObject({ status: 400 });
    const returned = await journalCommand("approver", { action: "return", id, version: submitted.journal.version, note: "Split it by month" });
    expect(returned.journal).toMatchObject({ status: "returned", returnedReason: "Split it by month" });
    expect(await notices("preparer", "books.journal_decided")).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "in_app", subject: `${returned.journal.reference} · returned`, body: "Approver: Split it by month" })]));
    const resubmitted = await journalCommand("preparer", { action: "submit", id, version: returned.journal.version });
    const approved = await journalCommand("approver", { action: "approve", id, version: resubmitted.journal.version });
    expect(approved.journal).toMatchObject({ status: "approved", approvedBy: people.approver, postedNumber: expect.stringMatching(/^MAIN-JV-\d{6}$/) });
    const lines = await tenant(ws, people.approver, (client) => readJournalLines(client, ws, approved.journal.postedJournalId!));
    expect(lines.map((row) => [row.debit, row.credit, row.partyType])).toEqual([["1500.5000", "0.0000", "vendor"], ["0.0000", "1500.5000", null]]);
    expect(await notices("preparer", "books.journal_decided")).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "in_app", subject: `${approved.journal.reference} · approved`, body: `Approver: Posted as ${approved.journal.postedNumber}.` }),
      expect.objectContaining({ channel: "email" })]));
    expect(await auditCount("books.manual_journal_approved", id)).toBe(1);

    // A journal approved through the Approvals inbox (the engine and its outcome) posts the same way.
    const inboxId = randomUUID();
    const other = await journalCommand("preparer", { action: "save", id: inboxId, version: 0, legalEntityId: entity, journalDate: "2026-10-07",
      lines: [line("6100", "debit", "200"), line("1100", "credit", "200")] });
    await journalCommand("preparer", { action: "submit", id: inboxId, version: other.journal.version });
    await tenant(ws, people.approver, async (client) => {
      const status = await decideApproval(client, { workspaceId: ws, kind: "manual_journal", subjectId: inboxId, deciderUserId: people.approver, decision: "approve" });
      await APPROVAL_OUTCOMES[status.kind]!(client, ws, status, "approve", people.approver, null);
    });
    expect((await journal("preparer", inboxId)).journal).toMatchObject({ status: "approved", postedNumber: expect.stringMatching(/^MAIN-JV-/) });
  });

  it("refuses a preparer approving their own journal even when they hold the approval permission", async () => {
    const id = randomUUID();
    const draft = await journalCommand("controller", { action: "save", id, version: 0, legalEntityId: entity, journalDate: "2026-10-06",
      lines: [{ accountId: account("6100"), debit: "50" }, { accountId: account("1100"), credit: "50" }] });
    const submitted = await journalCommand("controller", { action: "submit", id, version: draft.journal.version });
    await expect(journalCommand("controller", { action: "approve", id, version: submitted.journal.version })).rejects.toMatchObject({ status: 403 });
    await expect(tenant(ws, people.controller, (client) => decideApproval(client, { workspaceId: ws, kind: "manual_journal", subjectId: id, deciderUserId: people.controller,
      decision: "approve" }))).rejects.toMatchObject({ status: 403 });
    // Cancelled by its preparer: the open approval goes with it.
    const cancelled = await journalCommand("controller", { action: "cancel", id, version: submitted.journal.version });
    expect(cancelled.journal.status).toBe("cancelled");
    expect(cancelled.approval?.status).toBe("cancelled");
  });

  it("moves the lock date only with confirmation, tells the others who set up the Ledger, and then refuses journals dated on or before it", async () => {
    const current = (await settings()).company.settings!;
    await expect(settingsCommand("manager", { action: "update_settings", version: current.version, lockDate: "2026-10-05" })).rejects.toMatchObject({ status: 422 });
    await expect(settingsCommand("manager", { action: "update_settings", version: current.version, lockDate: "2099-01-01", confirmLockDate: true }))
      .rejects.toMatchObject({ status: 422 });
    await expect(settingsCommand("manager", { action: "update_settings", version: current.version - 1, lockDate: "2026-10-05", confirmLockDate: true }))
      .rejects.toMatchObject({ status: 409 });
    await expect(settingsCommand("manager", { action: "update_settings", version: current.version, startDate: "2026-09-01" })).rejects.toMatchObject({ status: 409 });
    const locked = await settingsCommand("manager", { action: "update_settings", version: current.version, lockDate: "2026-10-05", confirmLockDate: true });
    expect(locked.company.settings).toMatchObject({ lockDate: "2026-10-05", version: current.version + 1 });
    expect(await auditCount("books.lock_date_changed", entity)).toBe(1);
    expect(await notices("controller", "books.lock_date_changed")).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "in_app", subject: "Studio Interiors LLC · books locked up to 2026-10-05", body: "Manager changed the lock date. It was none." }),
      expect.objectContaining({ channel: "email" })]));
    expect(await notices("manager", "books.lock_date_changed")).toEqual([]);

    const id = randomUUID();
    const draft = await journalCommand("preparer", { action: "save", id, version: 0, legalEntityId: entity, journalDate: "2026-10-05",
      lines: [{ accountId: account("6100"), debit: "10" }, { accountId: account("1100"), credit: "10" }] });
    await expect(journalCommand("preparer", { action: "submit", id, version: draft.journal.version }))
      .rejects.toMatchObject({ status: 422, response: { code: "locked" } });
    const later = await journalCommand("preparer", { action: "save", id, version: draft.journal.version, legalEntityId: entity, journalDate: "2026-10-06",
      lines: [{ accountId: account("6100"), debit: "10" }, { accountId: account("1100"), credit: "10" }] });
    expect((await journalCommand("preparer", { action: "submit", id, version: later.journal.version })).journal.status).toBe("submitted");
  });

  it("keeps every company's Ledger to its own workspace", async () => {
    const list = await tenant(ws, people.viewer, (client) => listJournals(client, ctx(client, "viewer"), { legalEntityId: entity }));
    expect(list.journals.length).toBeGreaterThan(2);
    const someId = list.journals[0].id;
    await expect(tenant(otherWs, people.outsider, (client) => readJournal(client, ctx(client, "outsider"), someId))).rejects.toMatchObject({ status: 404 });
    await expect(tenant(otherWs, people.outsider, (client) => readSettings(client, ctx(client, "outsider"), entity))).rejects.toMatchObject({ status: 404 });
    const seen = await tenant(otherWs, people.outsider, async (client) => ({
      journals: (await client.query(`SELECT 1 FROM books_manual_journals`)).rowCount,
      commands: (await client.query(`SELECT 1 FROM books_commands`)).rowCount,
      accounts: (await client.query(`SELECT 1 FROM books_accounts`)).rowCount,
    }));
    expect(seen).toEqual({ journals: 0, commands: 0, accounts: 0 });
    await expect(tenant(otherWs, people.outsider, (client) => client.query(
      `INSERT INTO books_commands (workspace_id, id, action, actor_id) VALUES ($1, $2, 'save', $3)`, [ws, randomUUID(), people.outsider]))).rejects.toThrow(/row-level security/);
  });
});
