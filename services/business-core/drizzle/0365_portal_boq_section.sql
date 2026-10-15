-- PLM-170: the client portal's Bill of quantities: the project's live BOQ as the client may read it (room, item,
-- description, quantity, unit, selling rate and amount; never cost, margin, packages or suppliers). It reads the
-- project's scope lines as they are: nothing is copied and nothing new is stored but the section's switches.
--   * client_portal_settings.show_boq: the section's switch (Settings › Client portal), OFF by default.
--   * client_portal_settings.boq_enquiry_types: the enquiry type codes and order paths the section shows for
--     (empty: every project the section is on for).
--   * client_portal_project_access sections: boq is allowed (the list is extended, never rewritten).
-- Idempotent; never disables RLS.
ALTER TABLE client_portal_settings ADD COLUMN IF NOT EXISTS show_boq boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE client_portal_settings ADD COLUMN IF NOT EXISTS boq_enquiry_types text[] NOT NULL DEFAULT '{}'::text[];
--> statement-breakpoint
DO $$
DECLARE
  definition text;
  allowed text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
   WHERE conname = 'client_portal_project_access_sections_check' AND conrelid = 'client_portal_project_access'::regclass;
  SELECT coalesce(array_agg(DISTINCT match[1]), '{}') INTO allowed FROM regexp_matches(coalesce(definition, ''), '''([a-z_]+)''', 'g') AS match;
  IF NOT 'boq' = ANY (allowed) THEN
    allowed := allowed || ARRAY['boq'];
    IF definition IS NOT NULL THEN ALTER TABLE client_portal_project_access DROP CONSTRAINT client_portal_project_access_sections_check; END IF;
    EXECUTE format('ALTER TABLE client_portal_project_access ADD CONSTRAINT client_portal_project_access_sections_check CHECK (sections IS NULL OR sections <@ ARRAY[%s]::text[])',
      (SELECT string_agg(quote_literal(section), ', ') FROM unnest(allowed) AS section));
  END IF;
END $$;
