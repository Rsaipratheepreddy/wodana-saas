import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { readBillLines } from "../../purchasing/payables";
import { PayablesService } from "../../purchasing/payables.service";
import { applyTemplate } from "../ledger/templates";
import { BillCaptureService } from "./bill-capture.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test runs in one transaction that is
// rolled back; the services run as the app role under forced RLS.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const ALL = ["payables.view", "payables.manage", "payables.approve"];

/** A UAE tax invoice as the model reads it: Al Noor's bill for oak veneer on PO-0042, plus delivery. */
const reading = (patch: Record<string, unknown> = {}) => ({
  supplierName: "Al Noor Joinery Workshop L.L.C", supplierNameAlt: "ورشة النور للنجارة ذ.م.م", supplierTaxNumber: "100-2345-6789-0003", buyerTaxNumber: "100987654300003",
  invoiceNumber: "INV-2026-0418", invoiceDate: "2026-10-04", dueDate: "2026-11-03", currency: "AED", poNumber: "LPO # PO-0042",
  lines: [
    { description: "Oak veneer MDF 18mm sheets", quantity: "20", unitPrice: "1250.00", net: "25000.00", taxRate: "5", taxAmount: "1250.00" },
    { description: "Delivery to site, Villa 12", quantity: "1", unitPrice: "350.00", net: "350.00", taxRate: "5", taxAmount: "17.50" },
  ],
  net: "25350.00", tax: "1267.50", total: "26617.50", confidence: 0.91, uncertain: ["dueDate"], ...patch,
});

type World = {
  client: PoolClient; workspaceId: string; finance: string; other: string; company: string; vendor: string; order: string; orderLine: string;
  ai: { generate: ReturnType<typeof vi.fn> }; captures: BillCaptureService; payables: PayablesService; files: Map<string, Buffer>;
};

integration("Ledger bill capture on real Postgres (photo → reading → draft bill, nothing posted)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool?.end());

  async function world(work: (world: World) => Promise<void>, permissions = ALL) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), finance = randomUUID(), other = randomUUID(), company = randomUUID(), vendor = randomUUID(), order = randomUUID(), orderLine = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Fatima Finance'),($3,$4,'Omar Other')",
        [finance, `${finance.slice(0, 8)}@capture.test`, other, `${other.slice(0, 8)}@capture.test`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,default_locale,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai','en-AE',$3)",
        [workspaceId, `cap-${workspaceId.slice(0, 8)}`, finance]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [randomUUID(), workspaceId, finance, randomUUID(), other]);
      await client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone,tax_registration_number)
        VALUES($1,$2,'MAIN','Studio Interiors','Studio Interiors LLC','AE','AED','en-AE','Asia/Dubai','100987654300003')`, [company, workspaceId]);
      await client.query(`INSERT INTO workspace_vendors(workspace_id,id,code,display_name,legal_name,capabilities,tax_registration_number,default_currency,status,created_by,updated_by)
        VALUES($1,$2,'AL-NOOR','Al Noor Joinery Workshop','Al Noor Joinery Workshop LLC','{materials}','100234567890003','AED','active',$3,$3),
              ($1,$4,'FAJR','مؤسسة الفجر للتجارة',NULL,'{materials}',NULL,'AED','active',$3,$3)`, [workspaceId, vendor, finance, randomUUID()]);
      await client.query(`INSERT INTO purchase_orders(id,workspace_id,number,legal_entity_id,vendor_id,currency,status,payment_terms,credit_days,approved_at,sent_at,created_by,subtotal,tax_total,total)
        VALUES($1,$2,'PO-0042',$3,$4,'AED','sent','credit',30,now(),now(),$5,25000,1250,26250)`, [order, workspaceId, company, vendor, finance]);
      await client.query(`INSERT INTO purchase_order_lines(id,workspace_id,order_id,position,source,description,quantity,unit,unit_price,tax_rate,net,tax,total)
        VALUES($1,$2,$3,0,'free','Oak veneer MDF 18mm',20,'sheets',1250,5,25000,1250,26250)`, [orderLine, workspaceId, order]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, finance]);
      await client.query("SET LOCAL ROLE wodana_app");
      await applyTemplate(client, workspaceId, company, "AE", { actorId: finance, startDate: "2026-09-01" });

      const access = (userId: string) => {
        const run = async (_a: unknown, _w: string, code: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => {
          if (!permissions.includes(code)) throw new ForbiddenException("Not allowed");
          return fn(client, { userId });
        };
        return { withPermission: run, hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
      };
      const files = new Map<string, Buffer>();
      const storage = { put: async (key: string, body: Buffer) => { files.set(key, body); }, read: async (key: string) => ({ body: files.get(key)!, byteSize: files.get(key)!.length }) } as never;
      const ai = { generate: vi.fn(async () => ({ text: JSON.stringify(reading()), finishReason: "STOP", model: "gemini-3-flash", provider: "gemini" })) };
      const payables = new PayablesService(access(finance), storage);
      const captures = new BillCaptureService(access(finance), ai as never, payables, storage);
      await work({ client, workspaceId, finance, other, company, vendor, order, orderLine, ai, captures, payables, files });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const photo = async (seed = 0) => ({
    buffer: await sharp({ create: { width: 64 + seed, height: 48, channels: 3, background: { r: 240, g: 240 - seed, b: 230 } } }).png().toBuffer(),
    originalname: `bill-${seed}.png`, mimetype: "image/png", size: 0,
  });
  const journals = async (w: World) => Number((await w.client.query<{ n: string }>(`SELECT count(*) AS n FROM books_journals WHERE workspace_id = $1`, [w.workspaceId])).rows[0].n);

  it("reads a photographed UAE bill into a draft invoice: supplier by TRN, the PO's line, a charge, VAT codes; provenance kept; nothing posted", async () => {
    await world(async (w) => {
      const result = await w.captures.upload(actor, w.workspaceId, await photo());
      expect(result.duplicate).toBe(false);
      expect(result.capture).toMatchObject({ status: "drafted", contentType: "image/jpeg", model: "gemini:gemini-3-flash", confidence: "0.9100", createdByName: "Fatima Finance" });
      // The photo is normalised to JPEG for the AI and for the person; the bill text goes in as an attachment.
      const call = w.ai.generate.mock.calls[0] as unknown as [unknown, string, { feature: string; request: { contents: Array<{ parts: Array<Record<string, { mimeType: string }>> }> } }];
      expect(call[2].feature).toBe("books.bill_capture");
      expect(call[2].request.contents[0].parts[1].inlineData.mimeType).toBe("image/jpeg");
      expect(result.proposal).toMatchObject({ vendorId: w.vendor, vendorMatch: "tax_number", legalEntityId: w.company, currency: "AED", orderId: w.order, orderNumber: "PO-0042",
        number: "INV-2026-0418", statedTotal: "26617.50", warnings: [], hints: { dueDate: "check" } });

      const billId = result.capture.billId!;
      const bill = await w.payables.bill(actor, w.workspaceId, billId);
      expect(bill.bill).toMatchObject({ status: "draft", vendorId: w.vendor, legalEntityId: w.company, number: "INV-2026-0418", invoiceDate: "2026-10-04", dueDate: "2026-11-03",
        statedTotal: "26617.5000", total: "26617.5000", createdBy: w.finance });
      expect(bill.lines.map((line) => [line.orderLineId, line.description, line.quantity, line.unitPrice, line.taxRate, line.taxCode])).toEqual([
        [w.orderLine, "Oak veneer MDF 18mm", "20.0000", "1250.0000", "5.0000", "SR"],
        [null, "Delivery to site, Villa 12", "1.0000", "350.0000", "5.0000", "SR"],
      ]);
      // The reading is the model's answer as it was: kept with the validated fields, and it never changes.
      const stored = (await w.client.query<{ reading: Record<string, unknown>; matched: string; order: string }>(
        `SELECT reading, matched_vendor_id AS matched, matched_order_id AS order FROM books_bill_captures WHERE id = $1`, [result.capture.id])).rows[0];
      expect(stored).toMatchObject({ matched: w.vendor, order: w.order });
      expect((stored.reading.raw as Record<string, unknown>).supplierNameAlt).toBe("ورشة النور للنجارة ذ.م.م");
      await w.client.query("SAVEPOINT immutable");
      await expect(w.client.query(`UPDATE books_bill_captures SET reading = '{"total": "1"}'::jsonb WHERE id = $1`, [result.capture.id])).rejects.toThrow(/snapshot and never changes/);
      await w.client.query("ROLLBACK TO SAVEPOINT immutable");
      expect(await journals(w)).toBe(0);

      // The person checks it beside the photo and confirms: the photo becomes the invoice's document. Still nothing posts.
      const confirmed = await w.captures.command(actor, w.workspaceId, result.capture.id, { action: "confirm", commandId: randomUUID(), version: result.capture.version, billId });
      expect(confirmed.capture).toMatchObject({ status: "drafted", billId, confirmedBy: w.finance });
      const document = await w.payables.file(actor, w.workspaceId, billId);
      expect(document.contentType).toBe("image/jpeg");
      expect((await w.payables.bill(actor, w.workspaceId, billId)).bill.fileName).toBe("bill-0.png");
      expect(await journals(w)).toBe(0);
      const audit = (await w.client.query<{ action: string }>(`SELECT action FROM audit_events WHERE workspace_id = $1 AND entity_type = 'books_bill_capture' ORDER BY occurred_at, action`,
        [w.workspaceId])).rows.map((row) => row.action);
      expect(audit).toEqual(expect.arrayContaining(["books_capture.uploaded", "books_capture.read", "books_capture.drafted", "books_capture.confirmed"]));
    });
  });

  it("refuses the same file twice: it returns the first capture, already captured, without reading again", async () => {
    await world(async (w) => {
      const file = await photo(1);
      const first = await w.captures.upload(actor, w.workspaceId, file);
      const again = await w.captures.upload(actor, w.workspaceId, file);
      expect(again).toMatchObject({ duplicate: true, capture: { id: first.capture.id, billId: first.capture.billId } });
      expect(w.ai.generate).toHaveBeenCalledTimes(1);
      // Discarded, it can be captured again.
      expect(first.capture.status).toBe("drafted");
      await expect(w.captures.command(actor, w.workspaceId, first.capture.id, { action: "discard", commandId: randomUUID(), version: first.capture.version }))
        .rejects.toThrow(/cancel the invoice instead/);
    });
  });

  it("stops at a reading the person completes: a bill already entered, a total that doesn't add up, an unknown supplier", async () => {
    await world(async (w) => {
      await w.captures.upload(actor, w.workspaceId, await photo(2));
      // The same supplier's invoice number again, from another photo: flagged, no second draft.
      const twice = await w.captures.upload(actor, w.workspaceId, await photo(3));
      expect(twice.capture).toMatchObject({ status: "read", billId: null });
      expect(twice.proposal!.warnings).toEqual([expect.objectContaining({ code: "duplicate_bill", number: "INV-2026-0418" })]);
      expect(twice.proposal!.ready).toBe(false);

      // Matched by its Arabic name; the lines don't add up to the printed total, which is kept to hold the invoice on submit.
      w.ai.generate.mockResolvedValueOnce({ text: JSON.stringify(reading({ supplierName: "Al Fajr Est.", supplierNameAlt: "مؤسسة الفجر للتجارة", supplierTaxNumber: null, poNumber: null,
        invoiceNumber: "F-77", total: "400.00", lines: [{ description: "Site cleaning", quantity: "1", unitPrice: "350", taxRate: "5" }] })), finishReason: "STOP", model: "m", provider: "gemini" });
      const fajr = await w.captures.upload(actor, w.workspaceId, await photo(4));
      expect(fajr.capture.status).toBe("drafted");
      expect(fajr.proposal).toMatchObject({ vendorMatch: "name", warnings: [{ code: "total_mismatch", stated: "400.00", computed: "367.50" }] });
      const held = await w.payables.command(actor, w.workspaceId, { action: "submit", commandId: randomUUID(), id: fajr.capture.billId, version: (await w.payables.bill(actor, w.workspaceId, fajr.capture.billId!)).bill.version });
      expect(held.bill).toMatchObject({ status: "held" });
      expect(held.bill.holdReasons).toContain("Invoice total 400.00, lines add up to 367.50");

      w.ai.generate.mockResolvedValueOnce({ text: JSON.stringify(reading({ supplierName: "Unknown Supplies FZE", supplierNameAlt: null, supplierTaxNumber: "100555555555003", invoiceNumber: "U-1" })),
        finishReason: "STOP", model: "m", provider: "gemini" });
      const unknown = await w.captures.upload(actor, w.workspaceId, await photo(5));
      expect(unknown.capture.status).toBe("read");
      expect(unknown.proposal!.warnings[0]).toEqual({ code: "supplier_not_found", name: "Unknown Supplies FZE", taxNumber: "100555555555003" });
      // The person enters it with a supplier they choose, then confirms: the capture names the invoice and its file.
      const id = randomUUID();
      await w.payables.command(actor, w.workspaceId, { action: "save", commandId: randomUUID(), id, vendorId: w.vendor, legalEntityId: w.company, currency: "AED", number: "U-1",
        invoiceDate: "2026-10-04", lines: [{ description: "Glass", quantity: "1", unitPrice: "100", taxRate: "5", taxCode: "SR" }] });
      const confirmed = await w.captures.command(actor, w.workspaceId, unknown.capture.id, { action: "confirm", commandId: randomUUID(), version: unknown.capture.version, billId: id });
      expect(confirmed.capture).toMatchObject({ status: "drafted", billId: id });
      await expect(w.captures.command(actor, w.workspaceId, unknown.capture.id, { action: "confirm", commandId: randomUUID(), version: confirmed.capture.version, billId: randomUUID() }))
        .rejects.toThrow(/already captured as another invoice/);
      expect(await journals(w)).toBe(0);
    });
  });

  it("finishes a slow reading in the background and tells only the uploader; a failed reading leaves the photo to enter by hand", async () => {
    await world(async (w) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      w.ai.generate.mockImplementationOnce(async () => { await gate; return { text: JSON.stringify(reading()), finishReason: "STOP", model: "m", provider: "gemini" }; });
      const pending = await w.captures.upload(actor, w.workspaceId, await photo(6), 5);
      expect(pending.capture.status).toBe("reading");
      release();
      let notices: Array<{ recipient: string; subject: string; body: string; link: string }> = [];
      for (let attempt = 0; attempt < 100 && !notices.length; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        notices = (await w.client.query<{ recipient: string; subject: string; body: string; link: string }>(
          `SELECT recipient_id AS recipient, subject, body, deep_link AS link FROM notifications WHERE workspace_id = $1 AND event_type = 'books.capture_read'`, [w.workspaceId])).rows;
      }
      expect(notices).toEqual([{ recipient: w.finance, subject: "Bill read: Al Noor Joinery Workshop INV-2026-0418", body: "Draft invoice ready to check: AED 26617.50.",
        link: `/workspace/finance/bills?capture=${pending.capture.id}` }]);

      // AI off: the capture fails with why; the same file can be captured again later; it's discarded when not needed.
      w.ai.generate.mockRejectedValueOnce(new ForbiddenException("AI assistance is off for this workspace"));
      const failed = await w.captures.upload(actor, w.workspaceId, await photo(7));
      expect(failed.capture).toMatchObject({ status: "failed", error: "AI assistance is off for this workspace" });
      expect(failed.proposal).toBeNull();
      const discarded = await w.captures.command(actor, w.workspaceId, failed.capture.id, { action: "discard", commandId: randomUUID(), version: failed.capture.version });
      expect(discarded.capture.status).toBe("discarded");
      await expect(w.captures.command(actor, w.workspaceId, failed.capture.id, { action: "discard", commandId: randomUUID(), version: failed.capture.version }))
        .rejects.toThrow(/Someone else changed this capture/);
    });
  });

  it("needs the right to enter bills, and refuses a file that isn't a bill photo or PDF", async () => {
    await world(async (w) => {
      await expect(w.captures.upload(actor, w.workspaceId, await photo(8))).rejects.toThrow(/Not allowed/);
    }, ["payables.view"]);
    await world(async (w) => {
      await expect(w.captures.upload(actor, w.workspaceId, { buffer: Buffer.from("hello"), originalname: "a.txt", mimetype: "text/plain", size: 5 })).rejects.toThrow(/JPEG, PNG or HEIC/);
      await expect(w.captures.upload(actor, w.workspaceId, { buffer: Buffer.alloc(7 * 1024 * 1024, 1), originalname: "big.jpg", mimetype: "image/jpeg", size: 7 * 1024 * 1024 }))
        .rejects.toThrow(/up to 6 MB/);
    });
  });

  it("keeps a bill line's tax code and account only when they're the company's and fit the line", async () => {
    await world(async (w) => {
      const accounts = new Map((await w.client.query<{ code: string; id: string }>(`SELECT code, id FROM books_accounts WHERE workspace_id = $1 AND legal_entity_id = $2`, [w.workspaceId, w.company]))
        .rows.map((row) => [row.code, row.id]));
      const save = (line: Record<string, unknown>, id = randomUUID()) => w.payables.command(actor, w.workspaceId, { action: "save", commandId: randomUUID(), id, vendorId: w.vendor,
        legalEntityId: w.company, currency: "AED", number: `T-${id.slice(0, 6)}`, invoiceDate: "2026-10-04", lines: [{ description: "Site cleaning", quantity: "1", unitPrice: "100", taxRate: "5", ...line }] });
      await expect(save({ taxCode: "XX" })).rejects.toThrow("Site cleaning: tax code XX isn't set up for this company's purchases on the invoice date.");
      await expect(save({ taxCode: "SR", taxRate: "10" })).rejects.toThrow("Site cleaning: tax 10% doesn't match SR (5%).");
      await expect(save({ taxCode: "RC" })).rejects.toThrow(/RC lines carry no supplier tax/);
      await expect(save({ taxCode: "SR", booksAccountId: accounts.get("2100") })).rejects.toThrow(/2100 is a control account/);
      await expect(save({ taxCode: "SR", booksAccountId: accounts.get("4100") })).rejects.toThrow(/4100 isn't an expense or asset account/);
      await expect(save({ taxCode: "SR", booksAccountId: randomUUID() })).rejects.toThrow(/open account of this company/);
      await expect(save({ taxCode: "S R" })).rejects.toThrow("Tax code is not valid.");
      const saved = await save({ taxCode: "sr", booksAccountId: accounts.get("5400") });
      expect((await readBillLines(w.client, w.workspaceId, saved.bill.id)).map((line) => [line.taxCode, line.booksAccountId])).toEqual([["SR", accounts.get("5400")]]);
      const reverse = await save({ taxCode: "RC", taxRate: "0" });
      expect(reverse.lines[0]).toMatchObject({ taxCode: "RC", tax: "0.0000" });

      const coding = await w.captures.coding(actor, w.workspaceId, w.company, "2026-10-04");
      expect(coding).toMatchObject({ enabled: true, ledgerOn: false });
      expect(coding.taxCodes.map((code) => code.code)).toEqual(["EX", "IG", "OS", "RC", "SR", "ZR"]);
      expect(coding.accounts.some((account) => account.code === "5400")).toBe(true);
      expect(coding.accounts.some((account) => ["2100", "4100"].includes(account.code))).toBe(false);
    });
  });
});
