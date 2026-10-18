-- §0.3 P0: the seats a design firm's sales and design teams fill, as role templates for new workspaces from the
-- interior studio kit: 'account_manager', 'sales_admin', 'designer', 'creative_director', 'visualiser',
-- 'material_coordinator', 'technical_lead' and 'marketing' (src/workspaces/role-templates.ts holds their permissions).
-- Existing workspaces are untouched: a firm adds a seat itself (Settings → Teams). Idempotent.
UPDATE tenant_setup_profiles
   SET configuration = jsonb_set(configuration, '{roleTemplates}', (
         SELECT to_jsonb(array_agg(DISTINCT code ORDER BY code)) FROM (
           SELECT jsonb_array_elements_text(configuration->'roleTemplates') AS code
           UNION SELECT unnest(ARRAY['account_manager', 'sales_admin', 'designer', 'creative_director', 'visualiser', 'material_coordinator', 'technical_lead', 'marketing'])
         ) codes))
 WHERE kind = 'firm_kit' AND code = 'interior_studio' AND jsonb_typeof(configuration->'roleTemplates') = 'array';
