-- No tenant's name in the data model (Q-37). A case's deal-first service path was stored under a key named after
-- the first firm to use it; it is now `servicePath`, like the code. The repository still reads the former key for
-- a case written by an older release during a deploy. commercial_cases keeps its forced RLS and policy. Idempotent.
UPDATE commercial_cases
   SET content = (content - 'palmFlow') || jsonb_build_object('servicePath', content->'palmFlow')
 WHERE content ? 'palmFlow' AND NOT content ? 'servicePath';
--> statement-breakpoint
UPDATE commercial_cases SET content = content - 'palmFlow' WHERE content ? 'palmFlow';
