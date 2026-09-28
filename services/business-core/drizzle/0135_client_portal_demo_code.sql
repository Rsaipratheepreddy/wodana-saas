-- A demonstration sign-in code on one client contact (grant). A workspace admin sets it so a demo client
-- signs in with a fixed six-digit code and a dummy number: no WhatsApp or email is sent for that number.
-- Only an HMAC of the code (bound to the grant) is stored, with who set it and when; clearing it removes all
-- three. Every other number keeps the delivered one-time code.
ALTER TABLE client_portal_grants
  ADD COLUMN demo_code_hash char(64),
  ADD COLUMN demo_code_set_by uuid REFERENCES users (id),
  ADD COLUMN demo_code_set_at timestamptz,
  ADD CONSTRAINT client_portal_grants_demo_code_check
    CHECK ((demo_code_hash IS NULL) = (demo_code_set_by IS NULL) AND (demo_code_hash IS NULL) = (demo_code_set_at IS NULL));
