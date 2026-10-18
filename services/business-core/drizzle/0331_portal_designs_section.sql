-- PLM-153: the client portal's Designs: one folder per project of every design file the team shared with the client
-- (mood boards, concepts and layouts, materials, renders, drawings; approved ones and earlier rounds), grouped by stage,
-- to view and comment on. It reads the design files and their comment threads as they are: no file is copied and
-- nothing new is stored but the section's switch.
--   * client_portal_settings.show_designs: the section's switch (Settings › Client portal), shown by default.
--   * client_portal_project_access sections: designs is allowed (the list is extended, never rewritten), and a project
--     that narrowed its sections keeps Designs wherever it shows Decisions or the Moodboard (where its designs were).
-- Idempotent; never disables RLS.
ALTER TABLE client_portal_settings ADD COLUMN IF NOT EXISTS show_designs boolean NOT NULL DEFAULT true;
--> statement-breakpoint
DO $$
DECLARE
  definition text;
  allowed text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
   WHERE conname = 'client_portal_project_access_sections_check' AND conrelid = 'client_portal_project_access'::regclass;
  SELECT coalesce(array_agg(DISTINCT match[1]), '{}') INTO allowed FROM regexp_matches(coalesce(definition, ''), '''([a-z_]+)''', 'g') AS match;
  IF NOT 'designs' = ANY (allowed) THEN
    allowed := allowed || ARRAY['designs'];
    IF definition IS NOT NULL THEN ALTER TABLE client_portal_project_access DROP CONSTRAINT client_portal_project_access_sections_check; END IF;
    EXECUTE format('ALTER TABLE client_portal_project_access ADD CONSTRAINT client_portal_project_access_sections_check CHECK (sections IS NULL OR sections <@ ARRAY[%s]::text[])',
      (SELECT string_agg(quote_literal(section), ', ') FROM unnest(allowed) AS section));
  END IF;
END $$;
--> statement-breakpoint
UPDATE client_portal_project_access SET sections = array_append(sections, 'designs'::text)
 WHERE sections IS NOT NULL AND ('decisions' = ANY (sections) OR 'moodboard' = ANY (sections)) AND NOT ('designs' = ANY (sections));
