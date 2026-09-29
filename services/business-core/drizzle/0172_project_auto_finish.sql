-- D-7: Settings → Projects → "Finish by itself". With it on, a project whose last stage checks the client's
-- handover acceptance finishes on its own once that stage's checks pass (and close-out has nothing open). The
-- stage records that it finished automatically, on behalf of whoever's action made it pass (else the project
-- manager); the audit carries the same. Both tables already have forced RLS and a tenant_isolation policy.
ALTER TABLE workspace_project_settings ADD COLUMN auto_finish boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE project_stages ADD COLUMN finished_automatically boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE project_stages ADD CONSTRAINT project_stages_finished_automatically_check CHECK (NOT finished_automatically OR status = 'done');
