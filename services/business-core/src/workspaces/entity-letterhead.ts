import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * What a client- or supplier-facing document prints for the business that issues it (PLM-112): its legal
 * name, licence and tax numbers, registered address, phone and email, its logo, and its letterhead (a
 * header image and footer text). Images are served at `/api/auth/entity-image/{workspace}/{asset}`.
 * A document without an issuing business, or whose business has none of this, uses the workspace brand.
 */
export type DocumentLetterhead = {
  entityId: string;
  legalName: string;
  /** The country's name for its tax registration number ("TRN", "GSTIN"), from its region pack. */
  taxLabel: string | null;
  /** The country's name for the tax itself ("VAT", "GST"), from its region pack; null where there is none. */
  taxName: string | null;
  taxNumber: string | null;
  licenceNumber: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  footer: string | null;
  logoUrl: string | null;
  headerUrl: string | null;
  logoAssetId: string | null;
  headerAssetId: string | null;
};

const LETTERHEAD_SELECT = `SELECT entity.id AS "entityId", coalesce(nullif(btrim(entity.registered_name), ''), entity.display_name) AS "legalName",
    (SELECT profile.configuration->'tax'->>'registrationLabel' FROM tenant_setup_profiles profile
      WHERE profile.kind = 'region' AND profile.code = entity.country_code ORDER BY profile.version DESC LIMIT 1) AS "taxLabel",
    (SELECT profile.configuration->'tax'->>'label' FROM tenant_setup_profiles profile
      WHERE profile.kind = 'region' AND profile.code = entity.country_code ORDER BY profile.version DESC LIMIT 1) AS "taxName",
    nullif(btrim(entity.tax_registration_number), '') AS "taxNumber", nullif(btrim(entity.registration_number), '') AS "licenceNumber",
    nullif(concat_ws(', ', nullif(btrim(entity.address->>'line1'), ''), nullif(btrim(entity.address->>'line2'), ''), nullif(btrim(entity.address->>'city'), ''),
      nullif(btrim(entity.address->>'region'), ''), nullif(btrim(entity.address->>'postalCode'), '')), '') AS address,
    entity.phone, entity.email, nullif(btrim(entity.letterhead_footer), '') AS footer,
    logo.id AS "logoAssetId", header.id AS "headerAssetId"
  FROM legal_entities entity
  LEFT JOIN workspace_brand_assets logo ON logo.workspace_id = entity.workspace_id AND logo.id = entity.logo_asset_id AND logo.status = 'active'
  LEFT JOIN workspace_brand_assets header ON header.workspace_id = entity.workspace_id AND header.id = entity.letterhead_asset_id AND header.status = 'active'`;

export const entityImageUrl = (workspaceId: string, assetId: string | null) => (assetId ? `/api/auth/entity-image/${workspaceId}/${assetId}` : null);

/** One business's letterhead, or null when it isn't an active business of the workspace. */
export async function readLetterhead(db: Db, workspaceId: string, entityId: string | null | undefined): Promise<DocumentLetterhead | null> {
  if (!entityId || !/^[0-9a-f-]{36}$/i.test(entityId)) return null;
  const row = (await db.query<Omit<DocumentLetterhead, "logoUrl" | "headerUrl">>(`${LETTERHEAD_SELECT} WHERE entity.workspace_id = $1 AND entity.id = $2`, [workspaceId, entityId])).rows[0];
  if (!row) return null;
  return { ...row, logoUrl: entityImageUrl(workspaceId, row.logoAssetId), headerUrl: entityImageUrl(workspaceId, row.headerAssetId) };
}

/** The document variant (a flattened PNG) of a business's logo or letterhead header, for server-made PDFs. */
export async function letterheadImageKey(db: Db, workspaceId: string, assetId: string | null): Promise<string | null> {
  if (!assetId) return null;
  const row = (await db.query<{ key: string | null }>(
    `SELECT variants->>'document' AS key FROM workspace_brand_assets WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, assetId])).rows[0];
  return row?.key ?? null;
}

/** The lines a document prints under the business's name: licence, tax number, address and contact. */
export function letterheadLines(letterhead: DocumentLetterhead, labels: { licence: string; tax: string }) {
  return [
    [letterhead.licenceNumber ? `${labels.licence} ${letterhead.licenceNumber}` : "", letterhead.taxNumber ? `${letterhead.taxLabel ?? labels.tax} ${letterhead.taxNumber}` : ""].filter(Boolean).join(" · "),
    letterhead.address ?? "",
    [letterhead.phone, letterhead.email].filter(Boolean).join(" · "),
  ].filter(Boolean);
}
