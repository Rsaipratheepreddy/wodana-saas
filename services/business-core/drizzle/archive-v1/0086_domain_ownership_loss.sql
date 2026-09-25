-- A certificate can remain physically issued after DNS ownership disappears.
-- Keep that fact until the ingress worker confirms rollback; only active
-- routing requires current verified ownership.
ALTER TABLE workspace_domains DROP CONSTRAINT workspace_domains_certificate_check;
ALTER TABLE workspace_domains ADD CONSTRAINT workspace_domains_certificate_check
  CHECK (certificate_status NOT IN ('pending', 'issued') OR dns_verified_at IS NOT NULL);
