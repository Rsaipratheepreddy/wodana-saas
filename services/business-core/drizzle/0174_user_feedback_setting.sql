-- Profile → Sound & haptics: soft sounds on the web and haptics on the phone for replies, approvals, sends and new
-- notices. A person's own choice, kept on their user record like their language so it follows them to every device
-- and workspace; on by default. `users` is not a tenant table (no workspace_id); wodana_app already has access.
ALTER TABLE users ADD COLUMN feedback_enabled boolean NOT NULL DEFAULT true;
