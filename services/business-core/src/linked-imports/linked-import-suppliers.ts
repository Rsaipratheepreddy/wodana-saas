import { randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";
import { recordAudit } from "../audit/record-audit";
import { cleanCategories, normalName, readSupplier, readSuppliers, readTerms, type Supplier } from "../purchasing/suppliers";
import type { SuppliersService } from "../purchasing/suppliers.service";
import { checkTaxNumber, normaliseTaxNumber, readTaxNumberRule } from "../purchasing/tax-registration";
import { recordKey, type Step, type TargetAdapter } from "./linked-import-run";
import { SourceError, type SourceRow } from "./linked-import-source";

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
  const parts = text.split(/\s*(?:[/,;|&\n]|\bor\b)\s*/i).map((part) => part.trim()).filter((part) => /\d/.test(part));
  if (!parts.length) return { phone: null, problem: null };
  // Each part as written; then (two numbers or a name in one part) its words, a run at a time.
  const candidates = [...parts];
  for (const part of parts) {
    const words = part.split(/\s+|(?<=\d)-(?=[^\d\s])/).filter(Boolean);
    for (let from = 0; from < words.length; from++)
      for (let to = from + 1; to <= Math.min(words.length, from + 6); to++) candidates.push(words.slice(from, to).join(" ").replace(/[^\d)]+$/, ""));
  }
  for (const candidate of candidates) {
    const phone = readPhone(candidate, rule);
    if (phone) return { phone, problem: null };
  }
  return { phone: null, problem: `Phone ${parts[0]} isn't a valid number, so it wasn't imported.` };
}

function readPhone(written: string, rule: PhoneRule): string | null {
  if (!/\d/.test(written)) return null;
  const international = /^(\+|00)/.test(written);
  const digits = written.startsWith("00") ? digitsOf(written).slice(2) : digitsOf(written);
  const parsed = parsePhoneNumberFromString(international ? `+${digits}` : digits, rule.country ?? undefined);
  if (parsed?.isValid()) return parsed.number;
  if (!international && rule.callingCode && rule.lengths) {
    const [min, max] = rule.lengths;
    const national = digits.startsWith(rule.callingCode) && digits.length - rule.callingCode.length >= min && digits.length - rule.callingCode.length <= max
      ? digits.slice(rule.callingCode.length) : digits.replace(/^0+/, "");
    if (national.length >= min && national.length <= max) return `+${rule.callingCode}${national}`;
  }
  return null;
}

/** A sheet's supplier code as a Wodana code (letters, digits, - and _), or null when it can't be one. */
export function supplierCodeOf(text: string) {
  const code = text.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return /^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(code) ? code : null;
}

/** A cell holding the contact and their number ("Ramiz - +971 52 846 6806"): the name before the first digit, the number from it. */
export function splitContact(text: string): { name: string; phone: string } {
  const clean = text.replace(/\s+/g, " ").trim();
  const at = clean.search(/[+\d]/);
  if (at < 0) return { name: clean, phone: "" };
  return { name: clean.slice(0, at).replace(/[\s\-–—:,/|(]+$/, "").trim(), phone: clean.slice(at).trim() };
}

/**
 * A supplier list's approval cell ("APPROVED MARBLE SUPPLIER", "NOMINATED PAINT SUPPLIER", "NOT APPROVED", "N/A"):
 * approved (nominated or preferred: also the preferred supplier for what the row supplies), not approved, or null
 * when the cell doesn't decide (blank, N/A, or words that say neither), so the supplier's approval stays as it is.
 */
export function sheetApproval(text: string): { approval: "approved" | "not_approved"; preferred: boolean } | null {
  const lower = text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  if (!lower) return null;
  if (/\bnot[\s-]+approved\b|\bunapproved\b|\brejected\b|\bblack[\s-]?listed\b/.test(lower)) return { approval: "not_approved", preferred: false };
  if (/\bnominated\b|\bpreferred\b/.test(lower)) return { approval: "approved", preferred: true };
  if (/\bapproved\b|^yes$/.test(lower)) return { approval: "approved", preferred: false };
  return null;
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
      // An approval column is applied only for someone who may approve suppliers, as on the supplier page.
      const canApprove = await suppliers.canApprove(client as PoolClient, workspaceId, userId);
      // The company each tab's suppliers sell to: the tab's own, else the link's.
      const tabEntities = link.mapping?.entities ?? {};
      const entityIds = [...new Set([link.legalEntityId, ...Object.values(tabEntities)].filter((id): id is string => Boolean(id)))];
      const entities = new Map(entityIds.length ? (await client.query<{ id: string; name: string }>(
        `SELECT id, display_name AS name FROM legal_entities WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`, [workspaceId, entityIds])).rows.map((row) => [row.id, row]) : []);
      const fillOnly = link.mapping?.fillOnly === true;
      // One supplier on several rows (each company's tab lists it, or a list repeats it) is one supplier: the first row,
      // with what later rows add, buys for every tab's company; the later rows say where they went.
      const firstOf = new Map<string, SourceRow>();
      const sameAs = new Map<SourceRow, SourceRow>();
      const companiesOf = new Map<string, Set<string>>();
      for (const row of rows) {
        const key = lower(row.key);
        if (!key) continue;
        const entityId = tabEntities[row.sheet] ?? link.legalEntityId;
        if (entityId && entities.has(entityId)) companiesOf.set(key, (companiesOf.get(key) ?? new Set()).add(entityId));
        const earlier = firstOf.get(key);
        if (!earlier) { firstOf.set(key, row); continue; }
        sameAs.set(row, earlier);
        for (const [field, value] of Object.entries(row.values) as Array<[keyof SourceRow["values"], string]>) {
          if (!value?.trim()) continue;
          // What they supply adds up; any other field is the first row's, or the first that has it.
          if (field === "categories" && earlier.values.categories?.trim()) earlier.values.categories = `${earlier.values.categories}, ${value}`;
          else if (!earlier.values[field]?.trim()) earlier.values[field] = value;
        }
        for (const [heading, value] of Object.entries(row.attributes)) if (value && earlier.attributes[heading] === undefined) earlier.attributes[heading] = value;
      }
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
          const earlier = sameAs.get(row);
          if (earlier) { steps.push({ ...base, outcome: "unchanged", message: `Same supplier as ${earlier.sheet} row ${earlier.line}.` }); continue; }
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
          const companies = [...(companiesOf.get(lower(key)) ?? [])].map((id) => entities.get(id)!);
          // Only filling in: a known supplier keeps what Wodana has and takes only what it's missing.
          const keep = fillOnly && Boolean(match);
          const finalName = keep ? match!.name : name || match!.name;
          if (name && match && normalName(name) !== normalName(match.name) && byName.get(normalName(name))) { steps.push(fail("Another supplier has this name.")); continue; }

          const messages: string[] = [];
          const cell = (field: keyof typeof row.values) => (row.values[field] ?? "").replace(/\s+/g, " ").trim();
          const contact = splitContact(cell("contact"));
          // An empty cell keeps what Wodana has (and, only filling in, so does a filled field).
          const pick = (written: string, have: string | null | undefined) => (keep ? have || written || null : written || have || null);
          const legalName = pick(cell("legalName"), match?.legalName);
          if ((legalName ?? "").length > 240) { steps.push(fail("The legal name is longer than 240 characters.")); continue; }
          const contactName = pick(cell("contactName") || contact.name, match?.contactName);
          if ((contactName ?? "").length > 180) { steps.push(fail("The contact is longer than 180 characters.")); continue; }
          const address = pick(cell("address"), match?.locality);
          if ((address ?? "").length > 160) { steps.push(fail("The address is longer than 160 characters.")); continue; }
          const notes = pick((row.values.notes ?? "").trim(), match?.notes) ?? "";
          if (notes.length > 10000) { steps.push(fail("The notes are longer than 10,000 characters.")); continue; }

          let phone = match?.phone ?? null;
          const phoneText = cell("phone") || contact.phone;
          if (phoneText && !(keep && phone)) {
            const read = sheetPhone(phoneText, phoneRule);
            if (read.problem) messages.push(read.problem);
            else if (read.phone && digitsOf(read.phone) !== digitsOf(match?.phone)) phone = read.phone;
          }
          if (phone && phone !== match?.phone) {
            const owner = phoneOwners.get(digitsOf(phone)) ?? claimed.phones.get(digitsOf(phone));
            // A number another supplier has (a shared office line) is left out, not the supplier.
            if (owner && owner !== (match?.id ?? "")) { messages.push(`Another supplier has the phone ${phone}, so it wasn't imported.`); phone = match?.phone ?? null; }
          }

          let email = match?.email ?? null;
          // The first address in the cell ("Email: a@b.example / c@d.example").
          const words = cell("email").split(/[\s,;/]+/).filter(Boolean);
          const writtenEmail = words.find((word) => word.length <= 320 && EMAIL.test(word)) ?? words[0] ?? "";
          if (writtenEmail && !(keep && email)) {
            if (writtenEmail.length <= 320 && EMAIL.test(writtenEmail)) email = writtenEmail;
            else messages.push(`Email ${writtenEmail} isn't valid, so it wasn't imported.`);
          }

          // The tax number: a new or changed one must have the country's format, and belong to no other supplier.
          let tax = match?.taxRegistrationNumber ?? null;
          if (cell("taxNumber") && !(keep && tax) && normaliseTaxNumber(cell("taxNumber")) !== normaliseTaxNumber(tax ?? "")) tax = checkTaxNumber(cell("taxNumber"), taxRule) || null;
          if (tax && tax !== match?.taxRegistrationNumber) {
            const owner = taxOwners.get(normaliseTaxNumber(tax)) ?? claimed.tax.get(normaliseTaxNumber(tax));
            if (owner && owner !== (match?.id ?? "")) { steps.push(fail("Another supplier has this tax number.")); continue; }
          }

          const terms = cell("paymentTerms") && !keep ? readTerms(cell("paymentTerms")) : null;
          const written = (row.values.categories ?? "").split(/[,;\n]+/).map((part) => part.trim()).filter(Boolean);
          const categories = cleanCategories([...(match?.categories ?? []), ...written], match?.categories ?? []);
          const entityIds = [...new Set([...(match?.entityIds ?? []), ...companies.map((company) => company.id)])];

          // The approval column (PLM L6): approved, nominated (approved and preferred for what the row supplies) or not
          // approved. Blank or N/A leaves the approval as it is; the cell's own words stay as an attribute too.
          const approvalText = cell("approval");
          if (approvalText && row.attributes[row.headings?.approval ?? "Approval"] === undefined) row.attributes[row.headings?.approval ?? "Approval"] = approvalText;
          const decided = approvalText ? sheetApproval(approvalText) : null;
          const inCategories = (items: string[]) => [...new Set(items.map((item) => categories.find((category) => category.toLocaleLowerCase() === item.toLocaleLowerCase()))
            .filter((item): item is string => Boolean(item)))];
          let approval: { approval: "approved" | "not_approved"; preferredFor: string[]; note: string } | null = decided && !(keep && match && match.approval !== "pending") ? {
            approval: decided.approval, note: approvalText.slice(0, 500),
            preferredFor: decided.approval !== "approved" ? [] : inCategories(decided.preferred ? [...(match?.preferredFor ?? []), ...written] : match?.preferredFor ?? []),
          } : null;
          if (approval && match && approval.approval === match.approval && [...approval.preferredFor].sort().join("\n") === [...match.preferredFor].sort().join("\n")) approval = null;
          if (approval && !canApprove) { messages.push("The approval wasn't imported: approving suppliers needs the approve permission."); approval = null; }

          const haveAttributes = match ? attributes.get(match.id) ?? new Map() : new Map() as Attributes;
          const nextAttributes = Object.entries(row.attributes).map(([heading, value]) => ({ name: heading.trim().slice(0, 120), value: value.slice(0, 1000) }))
            .filter((attribute) => attribute.name && haveAttributes.get(lower(attribute.name))?.value !== attribute.value && !(keep && haveAttributes.get(lower(attribute.name))?.value));

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
            for (const company of companies) if (!match.entityIds.includes(company.id)) base.changes.push(`Buys for ${company.name}`);
          }
          const detailsChange = !match || base.changes.length > 0;
          if (approval) base.changes.push(`Approval → ${approval.approval === "approved" ? approval.preferredFor.length ? `Preferred for ${approval.preferredFor.join(", ")}` : "Approved" : "Not approved"}`);
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
            if (approval) {
              const saved = await readSupplier(client, workspaceId, id);
              await suppliers.approveWith(client as PoolClient, workspaceId, userId, id, { version: saved?.version, ...approval });
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
