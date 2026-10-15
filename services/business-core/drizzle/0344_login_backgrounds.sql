-- A workspace's own sign-in background, kept like the workspace logo.
--   * workspace_brand_assets.purpose gains login_background: a workspace image (no legal entity), uploaded through the
--     same short-lived brand-asset flow and storage as the logo.
--   * A sign-in background is a full-screen photograph: up to 10 MB. Every other brand asset stays at 5 MB.
--   * tenant_login_branding.login_background_asset_id: the active background (null: the product's default image),
--     cleared when its asset goes, as logo_asset_id is.
-- No data changes; RLS untouched. Idempotent.
DO $$
BEGIN
  ALTER TABLE workspace_brand_assets DROP CONSTRAINT IF EXISTS workspace_brand_assets_purpose_check;
  ALTER TABLE workspace_brand_assets ADD CONSTRAINT workspace_brand_assets_purpose_check
    CHECK (purpose IN ('workspace_logo', 'entity_logo', 'entity_letterhead', 'login_background'));
  ALTER TABLE workspace_brand_assets DROP CONSTRAINT IF EXISTS workspace_brand_assets_entity_check;
  ALTER TABLE workspace_brand_assets ADD CONSTRAINT workspace_brand_assets_entity_check
    CHECK ((purpose IN ('workspace_logo', 'login_background')) = (legal_entity_id IS NULL));
  ALTER TABLE workspace_brand_assets DROP CONSTRAINT IF EXISTS workspace_brand_assets_expected_size_check;
  ALTER TABLE workspace_brand_assets ADD CONSTRAINT workspace_brand_assets_expected_size_check
    CHECK (expected_byte_size > 0
      AND expected_byte_size <= CASE WHEN purpose = 'login_background' THEN 10485760 ELSE 5242880 END);
END $$;
--> statement-breakpoint
ALTER TABLE tenant_login_branding ADD COLUMN IF NOT EXISTS login_background_asset_id uuid
  REFERENCES workspace_brand_assets (id) ON DELETE SET NULL;
