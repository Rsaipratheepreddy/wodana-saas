import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { bandProblem, SAMPLE_ORIGINS } from "./finishes.domain";
import { priceBands, type PriceBand } from "./finishes.store";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-157: the sample library. The physical samples the firm holds (its own stock, then brands), each tagged with a
 * price band, searchable when a designer or the Material Coordinator chooses a material. Archived, never deleted.
 */
export type SampleRow = {
  id: string; name: string; code: string; categoryKey: string | null; origin: string; supplier: string; catalogItemId: string | null; catalogItemName: string | null;
  priceBandId: string | null; priceBandLabel: string | null; location: string; note: string; inStock: boolean; hasPhoto: boolean; photoName: string | null;
  archived: boolean; version: number; updatedAt: string;
};

const SELECT = `SELECT sample.id, sample.name, sample.code, sample.category_key AS "categoryKey", sample.origin, sample.supplier, sample.catalog_item_id AS "catalogItemId",
  item.name AS "catalogItemName", sample.price_band_id AS "priceBandId", band.label AS "priceBandLabel", sample.location, sample.note, sample.in_stock AS "inStock",
  sample.photo_key IS NOT NULL AS "hasPhoto", sample.photo_name AS "photoName", sample.archived_at IS NOT NULL AS archived, sample.version, sample.updated_at AS "updatedAt"
  FROM material_samples sample
  LEFT JOIN catalog_items item ON item.workspace_id = sample.workspace_id AND item.id = sample.catalog_item_id
  LEFT JOIN sample_price_bands band ON band.workspace_id = sample.workspace_id AND band.id = sample.price_band_id`;

const shape = (row: SampleRow & { updatedAt: unknown }) => ({ ...row, updatedAt: new Date(row.updatedAt as string).toISOString() });

/** The library, searched by name, code or supplier; in-stock samples first, the firm's own stock before brands. */
export async function listSamples(db: Db, workspaceId: string, input: { search?: string; bandId?: string | null; categoryKey?: string | null; archived?: boolean; limit?: number } = {}) {
  const search = (input.search ?? "").trim().slice(0, 120);
  return (await db.query<SampleRow>(
    `${SELECT}
      WHERE sample.workspace_id = $1 AND ($2 OR sample.archived_at IS NULL)
        AND ($3 = '' OR strpos(lower(sample.name || ' ' || sample.code || ' ' || sample.supplier || ' ' || coalesce(item.name, '')), lower($3)) > 0)
        AND ($4::uuid IS NULL OR sample.price_band_id = $4) AND ($5::varchar IS NULL OR sample.category_key = $5)
      ORDER BY sample.archived_at NULLS FIRST, sample.in_stock DESC, (sample.origin = 'own_stock') DESC, lower(sample.name), sample.id LIMIT $6`,
    [workspaceId, input.archived === true, search, input.bandId ?? null, input.categoryKey ?? null, Math.min(Math.max(input.limit ?? 200, 1), 500)])).rows.map(shape);
}

export async function readSample(db: Db, workspaceId: string, id: string) {
  const row = (await db.query<SampleRow>(`${SELECT} WHERE sample.workspace_id = $1 AND sample.id = $2`, [workspaceId, id])).rows[0];
  return row ? shape(row) : null;
}

export type SampleInput = {
  id: string; version?: number | null; name: string; code?: string | null; categoryKey?: string | null; origin?: string | null; supplier?: string | null;
  catalogItemId?: string | null; priceBandId?: string | null; location?: string | null; note?: string | null; inStock?: boolean | null;
};

/** Adds a sample (a new id) or changes one (version-checked). The same content again changes nothing. */
export async function saveSample(db: Db, workspaceId: string, input: SampleInput, userId: string) {
  const name = (input.name ?? "").trim();
  if (!name || name.length > 240) throw new UnprocessableEntityException("Name the sample (up to 240 characters)");
  const origin = input.origin ?? "own_stock";
  if (!(SAMPLE_ORIGINS as readonly string[]).includes(origin) && origin !== "local_supplier") throw new BadRequestException("Say where the sample comes from.");
  const fields = {
    name, code: (input.code ?? "").trim().slice(0, 80), categoryKey: input.categoryKey || null, origin, supplier: (input.supplier ?? "").trim().slice(0, 200),
    catalogItemId: input.catalogItemId || null, priceBandId: input.priceBandId || null, location: (input.location ?? "").trim().slice(0, 200),
    note: (input.note ?? "").trim().slice(0, 2000), inStock: input.inStock !== false,
  };
  if (fields.categoryKey && !/^[a-z][a-z0-9_]{0,39}$/.test(fields.categoryKey)) throw new BadRequestException("Choose a finish category.");
  if (fields.catalogItemId && !(await db.query(`SELECT 1 FROM catalog_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, fields.catalogItemId])).rowCount)
    throw new BadRequestException("Choose an item from the catalog.");
  if (fields.priceBandId && !(await db.query(`SELECT 1 FROM sample_price_bands WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL`, [workspaceId, fields.priceBandId])).rowCount)
    throw new BadRequestException("Choose one of the price bands.");
  const current = await readSample(db, workspaceId, input.id);
  if (!current) {
    await db.query(
      `INSERT INTO material_samples (id, workspace_id, name, code, category_key, origin, supplier, catalog_item_id, price_band_id, location, note, in_stock, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
      [input.id, workspaceId, fields.name, fields.code, fields.categoryKey, fields.origin, fields.supplier, fields.catalogItemId, fields.priceBandId, fields.location, fields.note, fields.inStock, userId]);
    return { created: true, changed: true, sample: (await readSample(db, workspaceId, input.id))! };
  }
  const same = current.name === fields.name && current.code === fields.code && current.categoryKey === fields.categoryKey && current.origin === fields.origin
    && current.supplier === fields.supplier && current.catalogItemId === fields.catalogItemId && current.priceBandId === fields.priceBandId && current.location === fields.location
    && current.note === fields.note && current.inStock === fields.inStock;
  if (same) return { created: false, changed: false, sample: current };
  if (input.version !== current.version) throw new ConflictException("Someone changed this sample. Reload to see their change.");
  if (current.archived) throw new ConflictException("This sample was archived.");
  await db.query(
    `UPDATE material_samples SET name = $3, code = $4, category_key = $5, origin = $6, supplier = $7, catalog_item_id = $8, price_band_id = $9, location = $10, note = $11, in_stock = $12,
            updated_by = $13, updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, input.id, fields.name, fields.code, fields.categoryKey, fields.origin, fields.supplier, fields.catalogItemId, fields.priceBandId, fields.location, fields.note, fields.inStock, userId]);
  return { created: false, changed: true, sample: (await readSample(db, workspaceId, input.id))! };
}

export async function archiveSample(db: Db, workspaceId: string, id: string, version: number, userId: string) {
  const current = await readSample(db, workspaceId, id);
  if (!current) throw new NotFoundException("Sample not found.");
  if (current.archived) return false;
  if (current.version !== version) throw new ConflictException("Someone changed this sample. Reload to see their change.");
  await db.query(`UPDATE material_samples SET archived_at = now(), updated_by = $3, updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, userId]);
  return true;
}

/**
 * The firm's price bands, saved as the whole list in its order: a band kept by id is renamed or re-priced, a new one is
 * added, one left out is archived (samples tagged with it keep the tag in their history but it is no longer offered).
 */
export async function saveBands(db: Db, workspaceId: string, input: unknown) {
  if (!Array.isArray(input) || input.length > 20) throw new BadRequestException("Send up to 20 price bands.");
  const current = await priceBands(db, workspaceId, true);
  const labels = new Set<string>();
  const kept: string[] = [];
  // Bands that stay may swap names: free their names first so no two live bands share one on the way.
  const staying = input.map((raw) => (raw as Partial<PriceBand> | null)?.id).filter((id): id is string => typeof id === "string" && current.some((row) => row.id === id));
  if (staying.length) await db.query(`UPDATE sample_price_bands SET label = '~' || id::text WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL`, [workspaceId, staying]);
  for (const [position, raw] of input.entries()) {
    const band = (raw ?? {}) as Partial<PriceBand>;
    const problem = bandProblem(band);
    if (problem) throw new UnprocessableEntityException(problem);
    const label = String(band.label).trim();
    if (labels.has(label.toLocaleLowerCase())) throw new UnprocessableEntityException(`${label} is in the list twice`);
    labels.add(label.toLocaleLowerCase());
    const min = band.minAmount || null, max = band.maxAmount || null;
    const existing = typeof band.id === "string" ? current.find((row) => row.id === band.id) : undefined;
    if (existing) {
      await db.query(`UPDATE sample_price_bands SET label = $3, min_amount = $4::numeric, max_amount = $5::numeric, position = $6, archived_at = NULL, updated_at = now()
                       WHERE workspace_id = $1 AND id = $2`, [workspaceId, existing.id, label, min, max, position]);
      kept.push(existing.id);
    } else {
      const id = typeof band.id === "string" && /^[0-9a-f-]{36}$/i.test(band.id) ? band.id : randomUUID();
      // Archive any live band with the same label first (the list is replaced).
      await db.query(`UPDATE sample_price_bands SET archived_at = now(), updated_at = now() WHERE workspace_id = $1 AND lower(label) = lower($2) AND archived_at IS NULL AND NOT (id = ANY($3::uuid[]))`,
        [workspaceId, label, kept]);
      await db.query(`INSERT INTO sample_price_bands (id, workspace_id, label, min_amount, max_amount, position) VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6)`,
        [id, workspaceId, label, min, max, position]);
      kept.push(id);
    }
  }
  await db.query(`UPDATE sample_price_bands SET archived_at = now(), updated_at = now() WHERE workspace_id = $1 AND archived_at IS NULL AND NOT (id = ANY($2::uuid[]))`, [workspaceId, kept]);
  return priceBands(db, workspaceId);
}

/** Library samples matching a search, for choosing a material: in stock first, own stock before brands (PLM-144). */
export async function sampleChoices(db: Db, workspaceId: string, search: string) {
  return (await listSamples(db, workspaceId, { search, limit: 10 })).map((sample) => ({
    id: sample.id, name: sample.name, code: sample.code, origin: sample.origin, supplier: sample.supplier, categoryKey: sample.categoryKey, catalogItemId: sample.catalogItemId,
    priceBandLabel: sample.priceBandLabel, inStock: sample.inStock, hasPhoto: sample.hasPhoto, location: sample.location,
  }));
}

/** The workspace's currency (from its region): price bands are amounts in it. */
export async function workspaceCurrency(db: Db, workspaceId: string) {
  return (await db.query<{ currency: string | null }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? null;
}
