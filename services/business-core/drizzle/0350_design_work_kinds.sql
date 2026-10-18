-- PLM-177: who draws what. Booked design time has three kinds of work instead of two:
--   * design_2d  2D design drawings (layouts and elevations for the client), by the job's Interior Designers;
--   * render     3D renders, by the Visualiser (tagged by the lead designer, as before);
--   * drawing    technical drawings, by the technical team (the job's Draftsman or the Technical Lead).
-- Every existing booking keeps its kind: an old 'drawing' was always booked for the technical team ("2D drawings ·
-- Technical team"), so it reads as technical drawings. workspace_design_settings.design_drawing_days: the days 2D design
-- drawings need by default (configuration, like render_days and drawing_days).
-- No data changes; RLS untouched. Idempotent.
ALTER TABLE workspace_design_settings
  ADD COLUMN IF NOT EXISTS design_drawing_days smallint NOT NULL DEFAULT 3;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_design_settings_design_drawing_days_check') THEN
    ALTER TABLE workspace_design_settings ADD CONSTRAINT workspace_design_settings_design_drawing_days_check CHECK (design_drawing_days BETWEEN 1 AND 60);
  END IF;
  ALTER TABLE design_work_bookings DROP CONSTRAINT IF EXISTS design_work_bookings_kind_check;
  ALTER TABLE design_work_bookings ADD CONSTRAINT design_work_bookings_kind_check CHECK (kind IN ('design_2d', 'render', 'drawing'));
END $$;
