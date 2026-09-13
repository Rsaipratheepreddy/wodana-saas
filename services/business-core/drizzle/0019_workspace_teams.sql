CREATE TABLE "workspace_teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "business_unit_id" uuid NOT NULL,
  "code" varchar(32) NOT NULL,
  "name" varchar(160) NOT NULL,
  "description" varchar(500),
  "status" "entity_status" DEFAULT 'active' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_team_members" (
  "workspace_id" uuid NOT NULL,
  "team_id" uuid NOT NULL,
  "membership_id" uuid NOT NULL,
  "is_lead" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_team_members_pk" PRIMARY KEY("team_id", "membership_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_teams" ADD CONSTRAINT "workspace_teams_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;
ALTER TABLE "workspace_teams" ADD CONSTRAINT "workspace_teams_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE restrict;
ALTER TABLE "workspace_team_members" ADD CONSTRAINT "workspace_team_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;
ALTER TABLE "workspace_team_members" ADD CONSTRAINT "workspace_team_members_team_id_workspace_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."workspace_teams"("id") ON DELETE cascade;
ALTER TABLE "workspace_team_members" ADD CONSTRAINT "workspace_team_members_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_teams_workspace_code_uidx" ON "workspace_teams" ("workspace_id", "code");
CREATE INDEX "workspace_teams_business_unit_idx" ON "workspace_teams" ("business_unit_id");
CREATE INDEX "workspace_team_members_membership_idx" ON "workspace_team_members" ("membership_id");
CREATE UNIQUE INDEX "workspace_team_single_lead_uidx" ON "workspace_team_members" ("team_id") WHERE "is_lead" = true;
--> statement-breakpoint
ALTER TABLE "workspace_teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_teams" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "workspace_teams"
USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
ALTER TABLE "workspace_team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_team_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "workspace_team_members"
USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE TRIGGER "workspace_teams_business_unit_workspace_guard"
BEFORE INSERT OR UPDATE ON "workspace_teams"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('business_units', 'business_unit_id');
CREATE TRIGGER "workspace_team_members_team_workspace_guard"
BEFORE INSERT OR UPDATE ON "workspace_team_members"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('workspace_teams', 'team_id');
CREATE TRIGGER "workspace_team_members_membership_workspace_guard"
BEFORE INSERT OR UPDATE ON "workspace_team_members"
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('workspace_memberships', 'membership_id');
CREATE TRIGGER "workspace_teams_set_updated_at"
BEFORE UPDATE ON "workspace_teams"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
