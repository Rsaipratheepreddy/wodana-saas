import { BadRequestException, ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { normalizeItemDimension } from "../pre-projects/item-specification.service";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-149: the technical site measure. Once the project manager is named, the project manager or the factory team (the
 * technical designer may join) measure the site again before shop drawings: the final site dimensions, photos and
 * notes. It is a new measure, not the design site visit. Shop drawings can't start and production can't be released
 * before it (when the project's route asks for it). Measured again, the latest one counts; the earlier ones stay.
 * The dimension lines use the pre-project measurement model's length units, with the value in metres as well.
 */
export const MEASURE_UNITS = ["mm", "cm", "m", "in", "ft"] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];
export const MAX_MEASURE_LINES = 120;
export const MAX_MEASURE_FILES = 30;

export type MeasureLine = { area: string; label: string; value: string; unit: MeasureUnit };
export type MeasureFile = { id: string; name: string; mimeType: string; byteSize: number; hasPreview: boolean; byName: string; at: string };
export type TechnicalMeasure = { id: string; measuredOn: string; note: string; byName: string; at: string; lines: MeasureLine[]; files: MeasureFile[] };
export type MeasureInput = { measureId: string; measuredOn: string; note: string; lines: Array<{ area: string; label: string; value: number; unit: MeasureUnit }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a measure as recorded: the day (not in the future), at least one dimension, a note of up to 4000 characters. */
export function parseMeasure(body: Record<string, unknown>, today: string): MeasureInput {
  const measureId = typeof body.measureId === "string" && UUID.test(body.measureId) ? body.measureId : "";
  if (!measureId) throw new BadRequestException("The measure isn't valid.");
  const measuredOn = typeof body.measuredOn === "string" && DATE.test(body.measuredOn) && !Number.isNaN(Date.parse(`${body.measuredOn}T00:00:00Z`)) ? body.measuredOn : "";
  if (!measuredOn) throw new BadRequestException("Say on which day the site was measured.");
  if (measuredOn > today) throw new BadRequestException("The measure can't be in the future.");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 4000) throw new BadRequestException("Keep the notes under 4000 characters.");
  if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException("Add at least one dimension.");
  if (body.lines.length > MAX_MEASURE_LINES) throw new BadRequestException(`Add up to ${MAX_MEASURE_LINES} dimensions.`);
  const lines = body.lines.map((raw, index) => {
    const line = (raw ?? {}) as Record<string, unknown>;
    const area = typeof line.area === "string" ? line.area.trim() : "";
    const label = typeof line.label === "string" ? line.label.trim() : "";
    if (!label) throw new BadRequestException(`Dimension ${index + 1}: say what was measured.`);
    if (area.length > 120 || label.length > 120) throw new BadRequestException(`Dimension ${index + 1}: keep it under 120 characters.`);
    const value = typeof line.value === "number" ? line.value : typeof line.value === "string" && line.value.trim() ? Number(line.value) : Number.NaN;
    if (!Number.isFinite(value) || value <= 0 || value >= 1e8 || Math.round(value * 10_000) !== value * 10_000)
      throw new BadRequestException(`Dimension ${index + 1}: enter a size above zero, with up to four decimals.`);
    if (!MEASURE_UNITS.includes(line.unit as MeasureUnit)) throw new BadRequestException(`Dimension ${index + 1}: choose a unit.`);
    return { area, label, value, unit: line.unit as MeasureUnit };
  });
  return { measureId, measuredOn, note, lines };
}

/**
 * Whether the project's technical site measure is done: one is recorded, or its drawings started before the measure was
 * asked for (an older project isn't blocked afterwards; a new one can't upload drawings before the measure).
 */
export async function technicalMeasureDone(db: Db, workspaceId: string, projectId: string) {
  return Boolean((await db.query(
    `SELECT 1 FROM project_technical_measures WHERE workspace_id = $1 AND project_id = $2
     UNION ALL SELECT 1 FROM project_drawing_revisions WHERE workspace_id = $1 AND project_id = $2 LIMIT 1`, [workspaceId, projectId])).rowCount);
}

/** Every technical measure of the project, the latest first, with its dimensions and files. */
export async function readMeasures(db: Db, workspaceId: string, projectId: string): Promise<TechnicalMeasure[]> {
  return (await db.query<TechnicalMeasure>(
    `SELECT measure.id, measure.measured_on::text AS "measuredOn", measure.note, coalesce(creator.display_name, creator.primary_email) AS "byName", measure.created_at AS at,
            coalesce((SELECT jsonb_agg(jsonb_build_object('area', line.area, 'label', line.label, 'value', trim_scale(line.value)::text, 'unit', line.unit) ORDER BY line.position)
                        FROM project_technical_measure_lines line WHERE line.workspace_id = measure.workspace_id AND line.measure_id = measure.id), '[]'::jsonb) AS lines,
            coalesce((SELECT jsonb_agg(jsonb_build_object('id', file.id, 'name', file.original_name, 'mimeType', file.mime_type, 'byteSize', file.byte_size,
                        'hasPreview', file.preview_key IS NOT NULL, 'byName', uploader.display_name, 'at', file.created_at) ORDER BY file.created_at, file.id)
                        FROM project_technical_measure_files file JOIN users uploader ON uploader.id = file.created_by
                       WHERE file.workspace_id = measure.workspace_id AND file.measure_id = measure.id), '[]'::jsonb) AS files
       FROM project_technical_measures measure JOIN users creator ON creator.id = measure.created_by
      WHERE measure.workspace_id = $1 AND measure.project_id = $2 ORDER BY measure.measured_on DESC, measure.created_at DESC`, [workspaceId, projectId])).rows;
}

/**
 * Records a technical measure. Replayed with the same id and the same content it changes nothing (false); the same id
 * with something else is refused.
 */
export async function recordMeasure(db: Db, input: MeasureInput & { workspaceId: string; projectId: string; userId: string }) {
  const existing = (await db.query<{ projectId: string; measuredOn: string; note: string; lines: Array<{ area: string; label: string; value: string; unit: string }> }>(
    `SELECT measure.project_id AS "projectId", measure.measured_on::text AS "measuredOn", measure.note,
            coalesce((SELECT jsonb_agg(jsonb_build_object('area', line.area, 'label', line.label, 'value', trim_scale(line.value)::text, 'unit', line.unit) ORDER BY line.position)
                        FROM project_technical_measure_lines line WHERE line.workspace_id = measure.workspace_id AND line.measure_id = measure.id), '[]'::jsonb) AS lines
       FROM project_technical_measures measure WHERE measure.workspace_id = $1 AND measure.id = $2`, [input.workspaceId, input.measureId])).rows[0];
  if (existing) {
    const same = existing.projectId === input.projectId && existing.measuredOn === input.measuredOn && existing.note === input.note && existing.lines.length === input.lines.length
      && existing.lines.every((line, index) => line.area === input.lines[index].area && line.label === input.lines[index].label && line.unit === input.lines[index].unit
        && Number(line.value) === input.lines[index].value);
    if (!same) throw new ConflictException("This measure was already recorded with other values. Reload to see it.");
    return false;
  }
  await db.query(`INSERT INTO project_technical_measures (id, workspace_id, project_id, measured_on, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.measureId, input.workspaceId, input.projectId, input.measuredOn, input.note, input.userId]);
  for (const [position, line] of input.lines.entries())
    await db.query(
      `INSERT INTO project_technical_measure_lines (workspace_id, measure_id, position, area, label, value, unit, value_metres) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.workspaceId, input.measureId, position, line.area, line.label, line.value, line.unit, normalizeItemDimension(line.value, line.unit)]);
  return true;
}

/** The unit a new dimension starts in: inches where the workspace measures in imperial units, millimetres otherwise. */
export async function defaultMeasureUnit(db: Db, workspaceId: string): Promise<MeasureUnit> {
  return (await db.query<{ unitSystem: string }>(`SELECT unit_system::text AS "unitSystem" FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.unitSystem === "imperial" ? "in" : "mm";
}
