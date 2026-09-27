-- A person's chosen avatar now names a picture from the brand set (`sales-f`, `owner-m`, …,
-- see packages/brand/avatars) instead of the retired drawn portraits (a01–b10). Old choices are
-- cleared so those people get their role's avatar by default; photos are untouched. RLS stays forced.
ALTER TABLE workspace_member_profiles DROP CONSTRAINT IF EXISTS workspace_member_profiles_avatar_preset_check;
ALTER TABLE workspace_member_profiles ALTER COLUMN avatar_preset TYPE varchar(32);
UPDATE workspace_member_profiles SET avatar_preset = NULL WHERE avatar_preset IS NOT NULL AND avatar_preset !~ '^[a-z_]+-[fm]$';
ALTER TABLE workspace_member_profiles ADD CONSTRAINT workspace_member_profiles_avatar_preset_check
  CHECK (avatar_preset IS NULL OR avatar_preset ~ '^(owner|sales|designer|estimator|project_manager|site_supervisor|purchasing|finance|people|factory|carpenter|electrician|painter|installer|client|default)-[fm]$');
