/** Read-only inventory; never deletes, seeds, sends messages or reads provider secrets. */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const workspaceId = option('--workspace-id');
const slug = option('--slug');
const output = option('--output');
if (!/^[a-f0-9-]{36}$/i.test(workspaceId ?? '') || !['iglo', 'iglo-architects'].includes(slug)) {
  throw new Error('Supply the exact Iglo --workspace-id and --slug (iglo or iglo-architects).');
}
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const preserved = new Set([
  'users', 'user_identities', 'local_auth_credentials', 'auth_refresh_sessions', 'password_reset_tokens',
  'platform_administrators', 'workspaces', 'workspace_memberships', 'workspace_invitations', 'roles',
  'role_permissions', 'member_roles', 'invitation_roles', 'tenant_login_branding', 'workspace_brand_assets',
  'workspace_onboarding', 'workspace_subscriptions', 'workspace_teams', 'workspace_team_members',
  'tenant_provisioning_requests', 'legal_entities', 'business_units', 'work_locations', 'tax_profiles',
  'exchange_rates', 'document_sequences', 'workspace_catalog_links', 'workspace_catalog_records',
  'integration_connections', 'integration_resources', 'sync_cursors', 'webhook_inbox', 'audit_events',
  'client_portal_settings', 'commercial_payment_templates', 'device_endpoints', 'notification_preferences',
  'notification_templates', 'notification_policies', 'automation_definitions', 'automation_versions',
  'crm_assignment_policies', 'crm_assignment_rules', 'crm_custom_field_definitions', 'crm_pipelines',
  'crm_pipeline_stages', 'crm_qualification_forms', 'crm_qualification_questions', 'crm_queue_members',
  'crm_queues', 'crm_saved_views', 'crm_sequence_steps', 'crm_sequences', 'crm_sla_policies',
  'crm_taxonomies', 'crm_taxonomy_options', 'project_resources',
  'currencies', 'permissions',
]);
const client = new pg.Client(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : { host: '127.0.0.1', user: process.env.USER, database: 'wodana' });
await client.connect();
try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '30s'");
  const workspace = (await client.query('SELECT id, slug, name, default_currency, default_locale, default_timezone FROM workspaces WHERE id=$1 AND slug=$2', [workspaceId, slug])).rows[0];
  if (!workspace) throw new Error('Workspace ID and slug do not match. No changes made.');
  const dbRole = (await client.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  if (!dbRole?.rolsuper && !dbRole?.rolbypassrls) throw new Error('Inventory requires a read-only session as the migration owner with BYPASSRLS; app-role counts could hide records.');
  const columns = (await client.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
  const tables = [...new Set(columns.map(c => c.table_name))];
  const report = {
    generatedAt: new Date().toISOString(), mode: 'read-only', applied: false, workspace,
    desiredRegion: { country: 'AE', currency: 'AED', locale: 'en-AE', timezone: 'Asia/Dubai', city: 'Dubai' },
    schemaSha256: digest(columns), preserved: [], operationalCandidates: [], manualReview: [],
    gates: ['Verify host backup by restoration', 'Preserve users, credentials, memberships and roles',
      'Map legacy identities and password algorithms without resetting passwords',
      'Preserve provider encryption keys and secret references', 'Disable outbound delivery during demo import',
      'Resolve every manual-review table and foreign-key dependency',
      'Remap existing client phone grants to the selected new cases',
      'Verify all other tenants and preserved records are unchanged before committing'],
  };
  for (const name of tables) {
    const scoped = columns.some(c => c.table_name === name && c.column_name === 'workspace_id');
    if (!scoped && !preserved.has(name)) { report.manualReview.push({ table: name, reason: 'Global or indirectly scoped table: never truncate.' }); continue; }
    const filter = scoped ? ' WHERE workspace_id=$1' : name === 'workspaces' ? ' WHERE id=$1' : '';
    const params = filter ? [workspaceId] : [];
    const count = Number((await client.query(`SELECT count(*) AS count FROM ${quote(name)}${filter}`, params)).rows[0].count);
    const entry = { table: name, count, scope: scoped || name === 'workspaces' ? 'target-workspace' : 'global-preserved' };
    if (preserved.has(name) || name.startsWith('hrms_')) {
      // Fingerprint inside PostgreSQL: credential values never leave the database.
      if (['users', 'user_identities', 'local_auth_credentials', 'workspace_memberships', 'roles', 'role_permissions', 'member_roles', 'integration_connections', 'tenant_login_branding'].includes(name)) {
        entry.fingerprint = (await client.query(`SELECT md5(COALESCE(string_agg(md5(row_to_json(t)::text), '' ORDER BY md5(row_to_json(t)::text)), '')) AS hash FROM (SELECT * FROM ${quote(name)}${filter}) t`, params)).rows[0].hash;
      }
      report.preserved.push(entry);
    } else if (/^(crm_|pre_project_|project_|commercial_|client_portal_|notification|automation_|delivery_projects$|outbox_events$|idempotency_keys$)/.test(name)) {
      report.operationalCandidates.push({ ...entry, requiresReview: true });
    } else report.manualReview.push({ ...entry, reason: 'Unclassified workspace records are preserved until reviewed.' });
  }
  report.foreignKeys = (await client.query(`SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace ORDER BY 1,2,3`)).rows;
  await client.query('COMMIT');
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ mode: report.mode, applied: false, workspace: workspace.slug, preservedTables: report.preserved.length, operationalTablesForReview: report.operationalCandidates.length, manualReviewTables: report.manualReview.length, output: output ?? null }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally { await client.end(); }
