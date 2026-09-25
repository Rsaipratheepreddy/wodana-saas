ALTER TABLE pre_project_design_threads ADD COLUMN anchor jsonb;
ALTER TABLE pre_project_design_threads ADD COLUMN mentions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE pre_project_design_threads ADD CONSTRAINT design_comment_anchor_valid CHECK (anchor IS NULL OR (jsonb_typeof(anchor) = 'object' AND anchor ? 'x' AND anchor ? 'y' AND (anchor->>'x')::numeric BETWEEN 0 AND 1 AND (anchor->>'y')::numeric BETWEEN 0 AND 1));
