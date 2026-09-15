ALTER TABLE tenant_login_branding
  ADD COLUMN primary_color varchar(7),
  ADD CONSTRAINT tenant_login_branding_primary_color_check
    CHECK(primary_color IS NULL OR primary_color ~ '^#[0-9A-F]{6}$');

