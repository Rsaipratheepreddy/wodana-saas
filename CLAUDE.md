# Wodana SaaS — working rules

The parent directory's `CLAUDE.md` describes the legacy FastAPI "IntDesignERP" app. It does **not** apply here.

**Plan:** `docs/WODANA_MASTER_PLAN.md` is the only working plan; tenant facts come from `docs/projects/PALM_LIVING_CONTEXT_2026-09-25.md`. Don't add dated plan or release notes.

## Stack
- `services/business-core`: NestJS + PostgreSQL (drizzle migrations, forced RLS). This is the only writer of business data.
- `apps/web`: Next.js with the `@/design-system` components.
- `apps/mobile`: Expo. Tokens are generated from web (`npm run sync:design`).
- `services/intelligence-automation`: Python workers, integrations and AI.
- `packages/contracts`: shared types.

## Rules
1. **Tables hold business truth.** JSON is only for immutable snapshots, provider payloads and configuration.
   - Split documents are written only through `project_execution_save()` and `commercial_case_save()`, and read through `project_execution_view` and `commercial_cases_view`.
   - Use `projectRepository` and `commercialRepository` in code.
2. **Money** is `numeric` in the database and never floats in new code.
3. **Every tenant table** gets `workspace_id`, forced RLS and a `tenant_isolation` policy.
   - The app role is `wodana_app` (NOBYPASSRLS).
   - Cross-tenant jobs enumerate workspaces through a SECURITY DEFINER function, then run each workspace in its own tenant transaction.
   - Never disable RLS in a migration.
4. **Generic product.** Tenant differences are configuration (firm kits, workflow templates, terminology, branding). Never branch on a tenant's name or slug.
5. **Commands** are validated, idempotent and version-checked. Every command is audited.
6. **UI** follows the minimal content rules in the plan (§2):
   - one title per view, no repeated information, no explanatory paragraphs;
   - shared components and tokens only.
7. **Migrations** live in `services/business-core/drizzle` (`0000_v2_baseline` onward). v1 history is in `drizzle/archive-v1`; don't edit it.

## Verify before claiming done
- Backend: `npm test --workspace @wodana/business-core` and typecheck.
- Web: `npm test --workspace @wodana/web` and typecheck.
- Mobile: `npm --prefix apps/mobile test`.
- Real database: `PROJECT_REPOSITORY_TEST_DATABASE_URL=postgresql://<superuser>@localhost:5432/wodana npx vitest run src/**/*.integration.spec.ts` in `services/business-core`.
- End to end: `npm run test:smoke:palm-flow` and `node scripts/smoke-delivery-isolated.mjs` (set `LC_ALL=en_US.UTF-8` on macOS).
