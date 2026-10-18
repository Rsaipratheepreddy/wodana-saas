-- Any design & build tenant can choose the deal-first flow: the CRM owns quote rounds (QS,
-- client, Finance, Owner) and the first paid, Owner-approved Deal File opens the project.
-- The kit reuses Design & build v3 sections; its default workflow code switches the flow on.
INSERT INTO tenant_setup_profiles (kind, code, version, configuration, selectable)
SELECT 'firm_kit', 'design_build_deal_first', 1,
  jsonb_set(
    jsonb_set(configuration, '{label}', to_jsonb('Design & build · deal first'::text)),
    '{projectWorkflow}',
    configuration->'projectWorkflow' || jsonb_build_object(
      'code', 'design_build_deal_first',
      'name', 'Design & build (deal first)',
      'description', 'Paid, Owner-approved quote rounds open one project; only applicable delivery stages follow.'
    )
  ),
  true
FROM tenant_setup_profiles
WHERE kind = 'firm_kit' AND code = 'design_build' AND version = 3
ON CONFLICT (kind, code, version) DO NOTHING;
