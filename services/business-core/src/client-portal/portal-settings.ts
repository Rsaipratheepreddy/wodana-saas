import { BadRequestException, ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * The portal's sections, in the order the client sees them after Home. Designs: every design file shared with the client,
 * by stage, to view and comment on; Meetings: the minutes of every client meeting (PLM-153); Bill of quantities: the
 * project's live BOQ at selling rates (PLM-170), off by default and only for the enquiry types the firm lists.
 */
export const SECTIONS = ["progress", "moodboard", "designs", "decisions", "payments", "boq", "documents", "warranty", "meetings", "messages"] as const;
export type Section = (typeof SECTIONS)[number];
export type Sections = Record<Section, boolean>;
/** The sections a workspace that never saved its settings shows: everything but the bill of quantities. */
const DEFAULT_OFF: ReadonlySet<Section> = new Set<Section>(["boq"]);

/** What the tenant lets clients see (Settings → Client portal). */
export type PortalSettings = {
  workspaceId: string;
  slug: string;
  enabled: boolean;
  version: number;
  sections: Sections;
  progress: { stageNames: boolean; dates: boolean; updates: boolean; photos: boolean };
  invoiceAmounts: boolean;
  /** PLM-170: the enquiry type codes and order paths whose projects show the bill of quantities (empty: every project). */
  boqEnquiryTypes: string[];
  welcomeTitle: string;
  welcomeText: string;
  support: { phone: string; email: string; whatsapp: string };
};

/** What a project is, for the sections that show only for some kinds of job: its enquiry type's code and its order path. */
export type PortalJob = { enquiryType: string | null; furniturePath: string | null };

/** A project's own portal choice: the sections this client sees (null follows the workspace) and a pause. */
export type ProjectAccess = { sections: Section[] | null; paused: boolean; pausedAt: string | null; version: number };

const COLUMNS = `workspace_id AS "workspaceId", slug, enabled, version, show_progress AS progress, show_decisions AS decisions, show_payments AS payments,
  show_documents AS documents, show_warranty AS warranty, show_messages AS messages, show_moodboard AS moodboard, show_meetings AS meetings, show_designs AS designs,
  show_boq AS boq, boq_enquiry_types AS "boqEnquiryTypes", progress_stage_names AS "stageNames", progress_dates AS dates,
  progress_updates AS updates, progress_photos AS photos, show_invoice_amounts AS "invoiceAmounts", welcome_title AS "welcomeTitle",
  welcome_text AS "welcomeText", support_phone AS "supportPhone", support_email AS "supportEmail", support_whatsapp AS "supportWhatsapp"`;

type Row = Record<Section, boolean> & {
  workspaceId: string; slug: string; enabled: boolean; version: number; stageNames: boolean; dates: boolean; updates: boolean; photos: boolean;
  invoiceAmounts: boolean; boqEnquiryTypes: string[] | null; welcomeTitle: string; welcomeText: string; supportPhone: string; supportEmail: string; supportWhatsapp: string;
};

function fromRow(row: Row): PortalSettings {
  return {
    workspaceId: row.workspaceId, slug: row.slug, enabled: row.enabled, version: row.version,
    sections: Object.fromEntries(SECTIONS.map((section) => [section, row[section]])) as Sections,
    progress: { stageNames: row.stageNames, dates: row.dates, updates: row.updates, photos: row.photos },
    invoiceAmounts: row.invoiceAmounts, boqEnquiryTypes: row.boqEnquiryTypes ?? [], welcomeTitle: row.welcomeTitle, welcomeText: row.welcomeText,
    support: { phone: row.supportPhone, email: row.supportEmail, whatsapp: row.supportWhatsapp },
  };
}

/** The tenant's settings; a workspace that never saved them gets the defaults (portal off, everything shown but the bill of quantities). */
export async function readPortalSettings(db: Db, workspaceId: string): Promise<PortalSettings> {
  const row = (await db.query<Row>(`SELECT ${COLUMNS} FROM client_portal_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  if (row) return fromRow(row);
  const workspace = (await db.query<{ slug: string }>(`SELECT slug FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  return {
    workspaceId, slug: workspace?.slug ?? "", enabled: false, version: 0,
    sections: Object.fromEntries(SECTIONS.map((section) => [section, !DEFAULT_OFF.has(section)])) as Sections,
    progress: { stageNames: true, dates: true, updates: true, photos: true }, invoiceAmounts: true, boqEnquiryTypes: [],
    welcomeTitle: "", welcomeText: "", support: { phone: "", email: "", whatsapp: "" },
  };
}

/** The codes of enquiry types and order paths the bill of quantities shows for: lower-case codes, each once, up to 100. */
export function jobCodes(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string" || item.trim().length > 80)) throw new BadRequestException(`${label} isn't valid.`);
  return [...new Set(value.map((item: string) => item.trim().toLowerCase()).filter(Boolean))];
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function line(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadRequestException(`${label} isn't valid.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequestException(`${label} is too long (up to ${max} characters).`);
  return trimmed;
}

/** A contact number for the portal: blank, or an international number (+ country code). */
export function optionalPhone(value: unknown, label: string) {
  const raw = line(value, 24, label).replace(/[\s()-]/g, "");
  if (!raw) return "";
  if (!E164.test(raw)) throw new BadRequestException(`${label}: use the international format, e.g. +12025550123.`);
  return raw;
}

export function optionalEmail(value: unknown, label: string) {
  const raw = line(value, 254, label).toLowerCase();
  if (raw && !EMAIL.test(raw)) throw new BadRequestException(`${label} isn't a valid email address.`);
  return raw;
}

/**
 * Saves what clients see. Version-checked; switching the portal off ends every client session. Returns the
 * settings as saved.
 */
export async function savePortalSettings(db: Db, workspaceId: string, userId: string, body: Record<string, unknown>) {
  const current = await readPortalSettings(db, workspaceId);
  if (body.version !== current.version) throw new ConflictException("Someone else changed these settings. Reload to see their change.");
  const sections = (body.sections ?? {}) as Record<string, unknown>;
  const progress = (body.progress ?? {}) as Record<string, unknown>;
  const support = (body.support ?? {}) as Record<string, unknown>;
  const next: PortalSettings = {
    ...current,
    enabled: bool(body.enabled, current.enabled),
    sections: Object.fromEntries(SECTIONS.map((section) => [section, bool(sections[section], current.sections[section])])) as Sections,
    progress: {
      stageNames: bool(progress.stageNames, current.progress.stageNames), dates: bool(progress.dates, current.progress.dates),
      updates: bool(progress.updates, current.progress.updates), photos: bool(progress.photos, current.progress.photos),
    },
    invoiceAmounts: bool(body.invoiceAmounts, current.invoiceAmounts),
    boqEnquiryTypes: body.boqEnquiryTypes === undefined ? current.boqEnquiryTypes : jobCodes(body.boqEnquiryTypes, "Bill of quantities enquiry types"),
    welcomeTitle: body.welcomeTitle === undefined ? current.welcomeTitle : line(body.welcomeTitle, 120, "Welcome title"),
    welcomeText: body.welcomeText === undefined ? current.welcomeText : line(body.welcomeText, 500, "Welcome text"),
    support: {
      phone: support.phone === undefined ? current.support.phone : optionalPhone(support.phone, "Support phone"),
      email: support.email === undefined ? current.support.email : optionalEmail(support.email, "Support email"),
      whatsapp: support.whatsapp === undefined ? current.support.whatsapp : optionalPhone(support.whatsapp, "Support WhatsApp"),
    },
  };
  await db.query(
    `INSERT INTO client_portal_settings (workspace_id, slug, enabled, version, show_progress, show_decisions, show_payments, show_documents, show_warranty, show_messages, show_moodboard,
       progress_stage_names, progress_dates, progress_updates, progress_photos, show_invoice_amounts, welcome_title, welcome_text, support_phone, support_email, support_whatsapp,
       updated_by, updated_at, show_meetings, show_designs, show_boq, boq_enquiry_types)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $22, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, now(), $23, $24, $25, $26::text[])
     ON CONFLICT (workspace_id) DO UPDATE SET enabled = EXCLUDED.enabled, version = EXCLUDED.version, show_progress = EXCLUDED.show_progress,
       show_decisions = EXCLUDED.show_decisions, show_payments = EXCLUDED.show_payments, show_documents = EXCLUDED.show_documents,
       show_warranty = EXCLUDED.show_warranty, show_messages = EXCLUDED.show_messages, show_moodboard = EXCLUDED.show_moodboard, show_meetings = EXCLUDED.show_meetings, show_designs = EXCLUDED.show_designs,
       show_boq = EXCLUDED.show_boq, boq_enquiry_types = EXCLUDED.boq_enquiry_types, progress_stage_names = EXCLUDED.progress_stage_names,
       progress_dates = EXCLUDED.progress_dates, progress_updates = EXCLUDED.progress_updates, progress_photos = EXCLUDED.progress_photos,
       show_invoice_amounts = EXCLUDED.show_invoice_amounts, welcome_title = EXCLUDED.welcome_title, welcome_text = EXCLUDED.welcome_text,
       support_phone = EXCLUDED.support_phone, support_email = EXCLUDED.support_email, support_whatsapp = EXCLUDED.support_whatsapp,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [workspaceId, current.slug, next.enabled, current.version + 1, next.sections.progress, next.sections.decisions, next.sections.payments, next.sections.documents,
      next.sections.warranty, next.sections.messages, next.progress.stageNames, next.progress.dates, next.progress.updates, next.progress.photos, next.invoiceAmounts,
      next.welcomeTitle, next.welcomeText, next.support.phone, next.support.email, next.support.whatsapp, userId, next.sections.moodboard, next.sections.meetings, next.sections.designs,
      next.sections.boq, next.boqEnquiryTypes]);
  if (current.enabled && !next.enabled)
    await db.query(`UPDATE client_portal_sessions SET revoked_at = now(), revoked_reason = 'portal_off' WHERE workspace_id = $1 AND revoked_at IS NULL`, [workspaceId]);
  return { before: current, after: { ...next, version: current.version + 1 } };
}

export async function readProjectAccess(db: Db, workspaceId: string, projectId: string): Promise<ProjectAccess> {
  const row = (await db.query<{ sections: Section[] | null; pausedAt: string | null; version: number }>(
    `SELECT sections, paused_at AS "pausedAt", version FROM client_portal_project_access WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0];
  return row ? { sections: row.sections, paused: Boolean(row.pausedAt), pausedAt: row.pausedAt, version: row.version } : { sections: null, paused: false, pausedAt: null, version: 0 };
}

/** Narrows the sections a project's client sees, or pauses the project in the portal (version-checked). */
export async function saveProjectAccess(db: Db, workspaceId: string, projectId: string, userId: string, body: Record<string, unknown>) {
  await db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, projectId]);
  const current = await readProjectAccess(db, workspaceId, projectId);
  if (body.version !== current.version) throw new ConflictException("Someone else changed this project's portal. Reload to see their change.");
  let sections = current.sections;
  if (body.sections !== undefined) {
    if (body.sections === null) sections = null;
    else if (Array.isArray(body.sections) && body.sections.every((item) => SECTIONS.includes(item as Section)))
      sections = SECTIONS.filter((section) => (body.sections as string[]).includes(section));
    else throw new BadRequestException("Choose the sections this client sees.");
  }
  const paused = typeof body.paused === "boolean" ? body.paused : current.paused;
  await db.query(
    `INSERT INTO client_portal_project_access (workspace_id, project_id, sections, paused_at, paused_by, version, updated_by, updated_at)
     VALUES ($1, $2, $3, CASE WHEN $4::boolean THEN now() END, CASE WHEN $4::boolean THEN $5::uuid END, 1, $5, now())
     ON CONFLICT (workspace_id, project_id) DO UPDATE SET sections = EXCLUDED.sections,
       paused_at = CASE WHEN $4::boolean THEN coalesce(client_portal_project_access.paused_at, now()) END,
       paused_by = CASE WHEN $4::boolean THEN coalesce(client_portal_project_access.paused_by, $5::uuid) END,
       version = client_portal_project_access.version + 1, updated_by = $5, updated_at = now()`,
    [workspaceId, projectId, sections, paused, userId]);
  return { before: current, after: await readProjectAccess(db, workspaceId, projectId) };
}

/**
 * PLM-170: whether the bill of quantities applies to a job: the firm's list names its enquiry type or its order path (an
 * empty list means every job). A caller that doesn't know the job (a file or a command, none of which the BOQ has) is not narrowed.
 */
export function boqApplies(settings: Pick<PortalSettings, "boqEnquiryTypes">, job: PortalJob | undefined): boolean {
  if (!settings.boqEnquiryTypes.length || job === undefined) return true;
  return [job.enquiryType, job.furniturePath].some((code) => code && settings.boqEnquiryTypes.includes(code.toLowerCase()));
}

/** The sections a project's client sees: the workspace's, narrowed by the project (and, for the BOQ, by the kind of job); nothing while paused. */
export function effectiveSections(settings: PortalSettings, access: ProjectAccess | null, job?: PortalJob): Sections {
  return Object.fromEntries(SECTIONS.map((section) => [section,
    !access?.paused && settings.sections[section] && (!access?.sections || access.sections.includes(section)) && (section !== "boq" || boqApplies(settings, job))])) as Sections;
}
