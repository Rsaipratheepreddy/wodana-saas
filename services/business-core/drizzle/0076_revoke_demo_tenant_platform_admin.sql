-- Tenant owners and Wodana platform administrators are separate trust domains.
-- Earlier local/demo seeding incorrectly promoted the Iglo customer owner.
DELETE FROM "platform_administrators"
WHERE "user_id" IN (
  SELECT "id" FROM "users" WHERE lower("primary_email") = 'admin@igloarchitects.com'
);
