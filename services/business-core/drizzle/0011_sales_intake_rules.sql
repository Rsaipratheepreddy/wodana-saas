-- Sales intake rules (PLM-030, PLM-035): who may use a source, and who referred an enquiry.
-- A list option can be limited to role codes (NULL = everyone); forms and automations are not limited.
ALTER TABLE crm_taxonomy_options ADD COLUMN allowed_role_codes text[];
--> statement-breakpoint
-- The referrer of a referral enquiry, typed by kind: an outside person, a team member, a broker or a partner.
ALTER TABLE crm_enquiries
  ADD COLUMN referral_kind varchar(16) CHECK (referral_kind IN ('external', 'internal', 'broker', 'partner')),
  ADD COLUMN referral_name varchar(160),
  ADD COLUMN referral_contact varchar(160),
  ADD COLUMN referral_membership_id uuid,
  ADD COLUMN referral_option varchar(100),
  ADD CONSTRAINT crm_enquiries_referral_shape CHECK (
    referral_kind IS NULL
    OR (referral_kind = 'external' AND referral_name IS NOT NULL)
    OR (referral_kind = 'internal' AND referral_membership_id IS NOT NULL)
    OR (referral_kind IN ('broker', 'partner') AND referral_option IS NOT NULL));
