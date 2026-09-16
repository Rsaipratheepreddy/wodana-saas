import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { LocalAuthService } from "./local-auth.service";
import { UnitSystem } from "../workspaces/dto/create-workspace.dto";

export const DEMO_TENANT = {
  externalTenantId: "demo-iglo-architects",
  name: "Iglo Architects",
  slug: "iglo-architects",
  ownerEmail: "admin@igloarchitects.com",
  ownerName: "Iglo Administrator",
  password: "IgloDemo#2026",
} as const;

@Injectable()
export class DemoTenantSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoTenantSeedService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly workspaces: WorkspacesService,
    private readonly auth: LocalAuthService,
    private readonly database: DatabaseService,
  ) {}

  async onApplicationBootstrap() {
    if (this.config.get<string>("DEMO_TENANT_ENABLED", "false") !== "true") return;
    const provisioned = await this.workspaces.provisionTenant({
      externalTenantId: DEMO_TENANT.externalTenantId,
      owner: { email: DEMO_TENANT.ownerEmail, displayName: DEMO_TENANT.ownerName },
      name: DEMO_TENANT.name,
      slug: DEMO_TENANT.slug,
      defaultCurrency: "AED",
      defaultLocale: "en-AE",
      defaultTimezone: "Asia/Dubai",
      unitSystem: UnitSystem.Metric,
      weekStartsOn: 1,
      firstLegalEntity: {
        code: "IGLO",
        displayName: DEMO_TENANT.name,
        registeredName: "Iglo Architects",
        countryCode: "AE",
        baseCurrency: "AED",
        locale: "en-AE",
        timezone: "Asia/Dubai",
      },
    }, "demo:iglo-architects:v1");
    const workspaceId = (provisioned as unknown as { workspace: { id: string } }).workspace.id;
    await this.auth.ensureDemoAccount(
      workspaceId,
      DEMO_TENANT.ownerEmail,
      DEMO_TENANT.password,
    );
    await this.seedOrganizationStructure(workspaceId);
    this.logger.log(`Demo login ready for ${DEMO_TENANT.ownerEmail} at ${DEMO_TENANT.slug}`);
  }

  private async seedOrganizationStructure(workspaceId: string) {
    const owner = await this.database.query<{ id: string }>(
      "SELECT id FROM users WHERE primary_email = $1",
      [DEMO_TENANT.ownerEmail],
    );
    if (!owner.rowCount) return;

    await this.database.tenantTransaction(workspaceId, owner.rows[0].id, async (client) => {
      const legalEntity = await client.query<{ id: string }>(
        "SELECT id FROM legal_entities WHERE workspace_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1",
        [workspaceId],
      );
      const membership = await client.query<{ id: string }>(
        "SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'",
        [workspaceId, owner.rows[0].id],
      );
      if (!legalEntity.rowCount || !membership.rowCount) return;

      const units = [
        { code: "ARCH", name: "Architecture Studio", type: "studio" },
        { code: "INTERIORS", name: "Interior Design", type: "department" },
        { code: "DELIVERY", name: "Project Delivery", type: "division" },
        { code: "PROCUREMENT", name: "Procurement", type: "department" },
      ];
      const unitIds = new Map<string, string>();
      for (const unit of units) {
        const saved = await client.query<{ id: string }>(
          `INSERT INTO business_units
            (workspace_id, legal_entity_id, code, name, type, timezone)
           VALUES ($1, $2, $3, $4, $5, 'Asia/Dubai')
           ON CONFLICT (workspace_id, code) DO UPDATE
             SET name = EXCLUDED.name, type = EXCLUDED.type
             WHERE business_units.status = 'active'
           RETURNING id`,
          [workspaceId, legalEntity.rows[0].id, unit.code, unit.name, unit.type],
        );
        if (saved.rowCount) unitIds.set(unit.code, saved.rows[0].id);
      }

      const teams = [
        { code: "CONCEPT", name: "Concept Design", unit: "ARCH", description: "Early concepts, layouts, and client presentations", hasLead: true },
        { code: "VISUAL", name: "Visualization", unit: "INTERIORS", description: "3D studies, materials, and presentation imagery", hasLead: false },
        { code: "SITE", name: "Site Delivery", unit: "DELIVERY", description: "Site coordination, inspections, and handover", hasLead: true },
        { code: "SOURCING", name: "Sourcing", unit: "PROCUREMENT", description: "Vendor coordination, samples, and purchase tracking", hasLead: false },
      ];
      for (const team of teams) {
        const unitId = unitIds.get(team.unit);
        if (!unitId) continue;
        const saved = await client.query<{ id: string }>(
          `INSERT INTO workspace_teams
            (workspace_id, business_unit_id, code, name, description)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (workspace_id, code) DO UPDATE
             SET business_unit_id = EXCLUDED.business_unit_id,
                 name = EXCLUDED.name,
                 description = EXCLUDED.description
             WHERE workspace_teams.status = 'active'
           RETURNING id`,
          [workspaceId, unitId, team.code, team.name, team.description],
        );
        if (!saved.rowCount) continue;
        await client.query(
          `INSERT INTO workspace_team_members
            (workspace_id, team_id, membership_id, is_lead)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (team_id, membership_id) DO UPDATE SET is_lead = EXCLUDED.is_lead`,
          [workspaceId, saved.rows[0].id, membership.rows[0].id, team.hasLead],
        );
      }
    });
  }
}
