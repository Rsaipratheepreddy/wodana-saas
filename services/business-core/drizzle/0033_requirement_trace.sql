-- Requirement trace: every client requirement ends in a decision before a quotation goes out —
-- included (and covered by the lines that point at it), not included, a later phase, or not
-- possible — with a reason the client can read. The decisions are sealed with the accepted scope.
ALTER TABLE pre_project_brief_entries DROP CONSTRAINT pre_project_brief_entries_scope_status_check;
--> statement-breakpoint
ALTER TABLE pre_project_brief_entries
  ADD CONSTRAINT pre_project_brief_entries_scope_status_check CHECK (scope_status IN ('included', 'excluded', 'later', 'not_possible', 'undecided')),
  ADD COLUMN scope_note varchar(500) NOT NULL DEFAULT '';
