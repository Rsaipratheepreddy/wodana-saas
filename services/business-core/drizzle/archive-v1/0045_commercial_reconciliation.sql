CREATE TABLE commercial_reconciliation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 case_id uuid NOT NULL, payment_id varchar(80) NOT NULL, connection_id uuid NOT NULL,
 invoice_id varchar(100) NOT NULL, provider varchar(30) NOT NULL,
 next_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_until timestamptz,
 last_error varchar(300), attempts integer NOT NULL DEFAULT 0,
 UNIQUE(workspace_id,case_id,payment_id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX commercial_reconciliation_due ON commercial_reconciliation_jobs(next_at);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN GRANT SELECT,INSERT,UPDATE,DELETE ON commercial_reconciliation_jobs TO wodana_app; END IF; END $$;
