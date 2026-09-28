-- Sharing a site photo with the client (site "share_photo") sets shared_at and shared_by on the photo, but the
-- app role was only granted SELECT, INSERT and DELETE on site_report_photos (0060), so the command failed with
-- "permission denied". The photo rows stay under forced RLS and the tenant isolation policy.
GRANT UPDATE ON site_report_photos TO wodana_app;
