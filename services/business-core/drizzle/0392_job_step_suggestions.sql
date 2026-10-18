-- §0.3 P11: suggestions inside a job's step. A suggestion can now be about a job (its step now); everything else about
-- suggestions (evidence, proposed change, provenance, a person's decision) is unchanged. RLS stays on the table.
ALTER TABLE ai_suggestions DROP CONSTRAINT ai_suggestions_entity_type_check;
ALTER TABLE ai_suggestions ADD CONSTRAINT ai_suggestions_entity_type_check
  CHECK (entity_type::text = ANY (ARRAY['lead', 'opportunity', 'commercial_case', 'project', 'job']::text[]));
