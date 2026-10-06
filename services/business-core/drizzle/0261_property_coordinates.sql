-- The property's position on the map, captured with its address on the opportunity's property details:
-- typed, taken from the phone's GPS or read from a pasted map link. Coordinates are universal (WGS 84
-- degrees), so nothing here depends on the workspace's region. Both or neither; the existing forced RLS
-- and tenant_isolation policy of crm_opportunity_discovery cover the new columns. Idempotent.
ALTER TABLE crm_opportunity_discovery ADD COLUMN IF NOT EXISTS latitude numeric(10, 7);
--> statement-breakpoint
ALTER TABLE crm_opportunity_discovery ADD COLUMN IF NOT EXISTS longitude numeric(10, 7);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_opportunity_discovery_coordinates_check') THEN
    ALTER TABLE crm_opportunity_discovery ADD CONSTRAINT crm_opportunity_discovery_coordinates_check CHECK (
      (latitude IS NULL) = (longitude IS NULL)
      AND (latitude IS NULL OR latitude BETWEEN -90 AND 90)
      AND (longitude IS NULL OR longitude BETWEEN -180 AND 180));
  END IF;
END $$;
