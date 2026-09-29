-- The team attaches files to its client-visible replies on a client's request, as the client can. A file on a
-- conversation is now either the client's (grant_id) or the team member's who attached it (attached_by), never
-- both. The table already has forced RLS and a tenant_isolation policy; wodana_app keeps SELECT and INSERT.
ALTER TABLE client_portal_attachments ALTER COLUMN grant_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE client_portal_attachments
  ADD COLUMN attached_by uuid REFERENCES users (id),
  ADD CONSTRAINT client_portal_attachments_author_check CHECK ((grant_id IS NULL) <> (attached_by IS NULL)),
  ADD CONSTRAINT client_portal_attachments_team_target_check CHECK (attached_by IS NULL OR target_kind = 'message');
