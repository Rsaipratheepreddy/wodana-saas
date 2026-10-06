import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { recordAudit } from "../audit/record-audit";
import { cleanCategories, normalName, readSupplier, readSuppliers, readTerms, type Supplier } from "../purchasing/suppliers";
import type { SuppliersService } from "../purchasing/suppliers.service";
import { checkTaxNumber, normaliseTaxNumber, readTaxNumberRule } from "../purchasing/tax-registration";
import { recordKey, type Step, type TargetAdapter } from "./linked-import-run";
import { SourceError } from "./linked-import-source";

type Db = Pick<PoolClient, "query">;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const lower = (text: string) => text.trim().toLocaleLowerCase();
const digitsOf = (text: string | null | undefined) => (text ?? "").replace(/\D/g, "");

/** How the workspace's country writes a phone number, from its region pack: the country, its calling code and the national number's length. */
export type PhoneRule = { country: CountryCode | null; callingCode: string | null; lengths: [number, number] | null };

export async function readPhoneRule(db: Db, workspaceId: string): Promise<PhoneRule> {
  const row = (await db.query<{ country: string | null; phone: { callingCode?: unknown; nationalNumberLength?: unknown } | null }>(
    `SELECT upper(split_part(workspace.default_locale, '-', 2)) AS country,
            (SELECT profile.configuration->'phone' FROM tenant_setup_profiles profile
              WHERE profile.kind = 'region' AND profile.code = upper(split_part(workspace.default_locale, '-', 2)) ORDER BY profile.version DESC LIMIT 1) AS phone
       FROM workspaces workspace WHERE workspace.id = $1`, [workspaceId])).rows[0];
  const country = row?.country && isSupportedCountry(row.country) ? row.country as CountryCode : null;
  const callingCode = typeof row?.phone?.callingCode === "string" && /^\d{1,4}$/.test(row.phone.callingCode) ? row.phone.callingCode : null;
  const range = row?.phone?.nationalNumberLength;
  const lengths = Array.isArray(range) && range.length === 2 && range.every((value) => Number.isInteger(value)) ? [range[0], range[1]] as [number, number] : null;
  return { country, callingCode, lengths };
}

/**
 * A phone number as a supplier list writes it ("050 123 4567", "+971 4 123 4567", "00971…", two numbers
 * in one cell): the first number, in international form by the region's rules. A number that isn't valid
 * for the region is left out, with the reason.
 */
export function sheetPhone(text: string, rule: PhoneRule): { phone: string | null; problem: string | null } {
  const first = text.split(/\s*(?:[/,;|&\n]|\bor\b)\s*/i).map((part) => part.trim()).find((part) => /\d/.test(part)) ?? "";
  if (!first) return { phone: null, problem: null };
  const international = /^(\+|00)/.test(first);
  const digits = first.startsWith("00") ? digitsOf(first).slice(2) : digitsOf(first);
  const parsed = parsePhoneNumberFromString(international ? `+${digits}` : digits, rule.country ?? undefined);
  if (parsed?.isValid()) return { phone: parsed.number, problem: null };
  if (!international && rule.callingCode && rule.lengths) {
    const [min, max] = rule.lengths;
    const national = digits.startsWith(rule.callingCode) && digits.length - rule.callingCode.length >= min && digits.length - rule.callingCode.length <= max
      ? digits.slice(rule.callingCode.length) : digits.replace(/^0+/, "");
    if (national.length >= min && national.length <= max) return { phone: `+${rule.callingCode}${national}`, problem: null };
  }
  return { phone: null, problem: `Phone ${first} isn't a valid number, so it wasn't imported.` };
}

/** A sheet's supplier code as a Wodana code (letters, digits, - and _), or null when it can't be one. */
export function supplierCodeOf(text: string) {
  const code = text.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return /^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(code) ? code : null;
}

type Attributes = Map<string, { name: string; value: string }>;

async function readAttributes(db: Db, workspaceId: string) {
  const rows = (await db.query<{ vendorId: string; name: string; value: string }>(
    `SELECT vendor_id AS "vendorId", name, value FROM supplier_attributes WHERE workspace_id = $1`, [workspaceId])).rows;
  const byVendor = new Map<string, Attributes>();
  for (const row of rows) {
    const attributes = byVendor.get(row.vendorId) ?? new Map();
    attributes.set(lower(row.name), { name: row.name, value: row.value });
    byVendor.set(row.vendorId, attributes);
  }
  return byVendor;
}

/**
 * A supplier list (PLM-111): each row is a supplier, by its code or, in a list without codes, its name. New
 * suppliers are added and known ones changed through the supplier register's own save command, so the
 * country's tax number format and the duplicate checks (name, tax number, phone) apply; a row that fails
 * them is listed and not applied. An empty cell leaves the field as it is; categories and companies are
 * added, never removed. Columns kept as attributes are stored with the supplier by their heading.
 */
export function suppliersAdapter(suppliers: SuppliersService): TargetAdapter {
  return {
    async plan(context, rows) {
      const { client, workspaceId, link, userId } = context;
      const all = await readSuppliers(client, workspaceId);
      const byId = new Map(all.map((supplier) => [supplier.id, supplier]));
      const byCode = new Map(all.map((supplier) => [lower(supplier.code), supplier]));
      const byName = new Map(all.filter((supplier) => supplier.status !== "archived").map((supplier) => [normalName(supplier.name), supplier]));
      const taxOwners = new Map(all.filter((supplier) => supplier.taxRegistrationNumber).map((supplier) => [normaliseTaxNumber(supplier.taxRegistrationNumber!), supplier.id]));
      const phoneOwners = new Map(all.filter((supplier) => supplier.status !== "archived" && digitsOf(supplier.phone).length >= 7).map((supplier) => [digitsOf(supplier.phone), supplier.id]));
      const attributes = await readAttributes(client, workspaceId);
      const taxRule = await readTaxNumberRule(client, workspaceId);
      const phoneRule = await readPhoneRule(client, workspaceId);
      const entity = link.legalEntityId ? (await client.query<{ id: string; name: string }>(
        `SELECT id, display_name AS name FROM legal_entities WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, link.legalEntityId])).rows[0] ?? null : null;
      // What earlier rows of this sheet claimed: a supplier, a new name, a tax number, a phone.
      const claimed = { keys: new Set<string>(), suppliers: new Set<string>(), names: new Set<string>(), tax: new Map<string, string>(), phones: new Map<string, string>() };
      const steps: Step[] = [];

      for (const row of rows) {
        const key = row.key.trim();
        const code = (row.values.code ?? "").trim();
        const name = (row.values.name ?? "").replace(/\s+/g, " ").trim();
        const base = { sheet: row.sheet, line: row.line, key, name: name || key, changes: [] as string[], message: "", recordKey: key ? recordKey(key, null) : null, locationId: null };
        const fail = (message: string): Step => ({ ...base, outcome: "error", message });
        try {
          if (!key) { steps.push(fail(row.values.code === undefined ? "No supplier name." : "No supplier code.")); continue; }
          if (claimed.keys.has(lower(key))) { steps.push(fail(`${key} is on another row.`)); continue; }
          claimed.keys.add(lower(key));
          const wodanaCode = code ? supplierCodeOf(code) : null;
          if (code && !wodanaCode) { steps.push(fail(`The code ${code} can only use letters, digits, - and _.`)); continue; }
          if (name.length > 240) { steps.push(fail("The name is longer than 240 characters.")); continue; }
          const known = context.records.get(recordKey(key, null));
          const match: Supplier | undefined = (known ? byId.get(known.recordId) : undefined)
            ?? (wodanaCode ? byCode.get(lower(wodanaCode)) : undefined) ?? (name ? byName.get(normalName(name)) : undefined);
          if (match?.status === "archived") { steps.push(fail(`${match.name} is archived. Restore it to import it.`)); continue; }
          if (!match && !name) { steps.push(fail("Name the supplier: it's new to Wodana.")); continue; }
          if (match && claimed.suppliers.has(match.id)) { steps.push(fail(`Another row is already ${match.name}.`)); continue; }
          if (!match && claimed.names.has(normalName(name))) { steps.push(fail(`Another row is already ${name}.`)); continue; }
          const finalName = name || match!.name;
          if (name && match && normalName(name) !== normalName(match.name) && byName.get(normalName(name))) { steps.push(fail("Another supplier has this name.")); continue; }

          const messages: string[] = [];
          const cell = (field: keyof typeof row.values) => (row.values[field] ?? "").replace(/\s+/g, " ").trim();
          // An empty cell keeps what Wodana has.
          const legalName = cell("legalName") || match?.legalName || null;
          if ((legalName ?? "").length > 240) { steps.push(fail("The legal name is longer than 240 characters.")); continue; }
          const contactName = cell("contactName") || match?.contactName || null;
          if ((contactName ?? "").length > 180) { steps.push(fail("The contact is longer than 180 characters.")); continue; }
          const address = cell("address") || match?.locality || null;
          if ((address ?? "").length > 160) { steps.push(fail("The address is longer than 160 characters.")); continue; }
          const notes = (row.values.notes ?? "").trim() || match?.notes || "";
          if (notes.length > 10000) { steps.push(fail("The notes are longer than 10,000 characters.")); continue; }

          let phone = match?.phone ?? null;
          if (cell("phone")) {
            const read = sheetPhone(cell("phone"), phoneRule);
            if (read.problem) messages.push(read.problem);
            else if (read.phone && digitsOf(read.phone) !== digitsOf(match?.phone)) phone = read.phone;
          }
          if (phone && phone !== match?.phone) {
            const owner = phoneOwners.get(digitsOf(phone)) ?? claimed.phones.get(digitsOf(phone));
            if (owner && owner !== (match?.id ?? "")) { steps.push(fail("Another supplier has this phone number.")); continue; }
          }

          let email = match?.email ?? null;
          const writtenEmail = cell("email").split(/[\s,;/]+/).find(Boolean) ?? "";
          if (writtenEmail) {
            if (writtenEmail.length <= 320 && EMAIL.test(writtenEmail)) email = writtenEmail;
            else messages.push(`Email ${writtenEmail} isn't valid, so it wasn't imported.`);
          }

          // The tax number: a new or changed one must have the country's format, and belong to no other supplier.
          let tax = match?.taxRegistrationNumber ?? null;
          if (cell("taxNumber") && normaliseTaxNumber(cell("taxNumber")) !== normaliseTaxNumber(tax ?? "")) tax = checkTaxNumber(cell("taxNumber"), taxRule) || null;
          if (tax && tax !== match?.taxRegistrationNumber) {
            const owner = taxOwners.get(normaliseTaxNumber(tax)) ?? claimed.tax.get(normaliseTaxNumber(tax));
            if (owner && owner !== (match?.id ?? "")) { steps.push(fail("Another supplier has this tax number.")); continue; }
          }

          const terms = cell("paymentTerms") ? readTerms(cell("paymentTerms")) : null;
          const written = (row.values.categories ?? "").split(/[,;\n]+/).map((part) => part.trim()).filter(Boolean);
          const categories = cleanCategories([...(match?.categories ?? []), ...written], match?.categories ?? []);
          const entityIds = [...new Set([...(match?.entityIds ?? []), ...(entity ? [entity.id] : [])])];

          const haveAttributes = match ? attributes.get(match.id) ?? new Map() : new Map() as Attributes;
          const nextAttributes = Object.entries(row.attributes).map(([heading, value]) => ({ name: heading.trim().slice(0, 120), value: value.slice(0, 1000) }))
            .filter((attribute) => attribute.name && haveAttributes.get(lower(attribute.name))?.value !== attribute.value);

          if (match) {
            if (finalName !== match.name) base.changes.push(`Name ${match.name} → ${finalName}`);
            if (legalName !== match.legalName) base.changes.push("Legal name");
            if (contactName !== match.contactName) base.changes.push(`Contact → ${contactName}`);
            if (phone !== match.phone) base.changes.push(`Phone → ${phone}`);
            if (email !== match.email) base.changes.push(`Email → ${email}`);
            if (address !== match.locality) base.changes.push("Address");
            if (tax !== match.taxRegistrationNumber) base.changes.push(`Tax number ${match.taxRegistrationNumber ?? "—"} → ${tax}`);
            if (terms && (terms.paymentTerms !== match.paymentTerms || (terms.advancePercent ?? null) !== (match.advancePercent === null ? null : String(Number(match.advancePercent)))
              || terms.creditDays !== match.creditDays || terms.termsNote !== match.termsNote)) base.changes.push("Payment terms");
            const added = categories.filter((category) => !match.categories.includes(category));
            if (added.length) base.changes.push(`Categories + ${added.join(", ")}`);
            if (notes !== match.notes) base.changes.push("Notes");
            if (entity && !match.entityIds.includes(entity.id)) base.changes.push(`Buys for ${entity.name}`);
          }
          const detailsChange = !match || base.changes.length > 0;
          base.changes.push(...nextAttributes.map((attribute) => attribute.name));
          base.message = messages.join(" ");
          if (match) claimed.suppliers.add(match.id); else claimed.names.add(normalName(finalName));
          const id = match?.id ?? randomUUID();
          if (tax) claimed.tax.set(normaliseTaxNumber(tax), id);
          if (phone) claimed.phones.set(digitsOf(phone), id);
          if (match && !base.changes.length) { steps.push({ ...base, outcome: "unchanged", keep: { recordId: match.id, locationId: null, quantity: null } }); continue; }

          steps.push({ ...base, name: finalName, outcome: match ? "changed" : "added", apply: async () => {
            if (detailsChange) {
              const current = match ? await readSupplier(client, workspaceId, match.id) : undefined;
              await suppliers.saveWith(client, workspaceId, userId, {
                id, version: current?.version, name: finalName, legalName, taxRegistrationNumber: tax ?? "", categories,
                paymentTerms: terms?.paymentTerms ?? current?.paymentTerms ?? "upfront", advancePercent: terms ? terms.advancePercent : current?.advancePercent,
                creditDays: terms ? terms.creditDays : current?.creditDays, termsNote: terms ? terms.termsNote : current?.termsNote ?? "", retentionPercent: current?.retentionPercent,
                deal: current?.deal ?? "none", dealPercent: current?.dealPercent, dealNote: current?.dealNote ?? "", currency: current?.currency ?? null, notes,
                contactName, phone, email, locality: address, entityIds,
              }, { code: wodanaCode });
            }
            if (nextAttributes.length) {
              for (const attribute of nextAttributes)
                await client.query(
                  `INSERT INTO supplier_attributes (workspace_id, vendor_id, name, value) VALUES ($1, $2, $3, $4)
                   ON CONFLICT (workspace_id, vendor_id, lower(name)) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [workspaceId, id, attribute.name, attribute.value]);
              await recordAudit(client, { workspaceId, actorUserId: userId, action: "supplier.attributes_changed", entityType: "supplier", entityId: id,
                before: Object.fromEntries(nextAttributes.map((attribute) => [attribute.name, haveAttributes.get(lower(attribute.name))?.value ?? null])),
                after: Object.fromEntries(nextAttributes.map((attribute) => [attribute.name, attribute.value])) });
            }
            return { recordId: id, locationId: null, quantity: null };
          } });
        } catch (error) {
          if (error instanceof SourceError || error instanceof HttpException) steps.push(fail(error.message));
          else throw error;
        }
      }
      return steps;
    },

    async names(context, recordIds) {
      if (!recordIds.length) return new Map();
      return new Map((await context.client.query<{ id: string; name: string }>(`SELECT id, display_name AS name FROM workspace_vendors WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
        [context.workspaceId, recordIds])).rows.map((row) => [row.id, row.name]));
    },
  };
}
