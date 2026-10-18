-- §0.3 P8 (guide 12–16): who gives a quotation its manager approval is the firm's choice. approval_team_roles lists
-- the job-team roles (e.g. lead designer, creative director, account manager) whose holder on the job approves;
-- empty keeps today's rule (anyone who approves quotes). Configuration on an existing table; idempotent.
ALTER TABLE workspace_quotation_settings ADD COLUMN IF NOT EXISTS approval_team_roles varchar(64)[] NOT NULL DEFAULT '{}';
