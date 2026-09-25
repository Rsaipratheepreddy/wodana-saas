ALTER TABLE project_workflow_templates
  DROP CONSTRAINT project_workflow_templates_stages_check;
--> statement-breakpoint
ALTER TABLE project_workflow_templates
  ADD CONSTRAINT project_workflow_templates_stages_check CHECK (
    jsonb_typeof(stages) = 'array'
    AND jsonb_array_length(stages) BETWEEN 2 AND 18
  );
