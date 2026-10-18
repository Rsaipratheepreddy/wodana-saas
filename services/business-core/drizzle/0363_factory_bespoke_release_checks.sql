-- Path E checks before production (PLM-174): three more release checks on bespoke jobs, each a setting, off by default.
--
-- workspace_factory_settings: on a bespoke (made-to-order) job a work order is released only when the technical handover
-- pack is accepted, every custom line's factory requirements are confirmed (or its catalogue recipe verified), and the
-- quotation passed its QS step. Configuration; nothing is backfilled. Idempotent; never disables RLS.
ALTER TABLE workspace_factory_settings
  ADD COLUMN IF NOT EXISTS require_technical_handover boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_factory_requirements boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_qs boolean NOT NULL DEFAULT false;
