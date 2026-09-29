/**
 * The email a portal contact is reached at: their own, else, when the contact is the case's client (the same
 * mobile number as the client record), the client's primary email from the CRM contact points. A decision-maker
 * added with just a name and number is still emailed at the address the client record already holds.
 *
 * `grant` is the SQL alias of a `client_portal_grants` row. Numbers are compared by their digits, so a record
 * kept without its country code (a leading 0 instead) still matches.
 */
export const contactEmailSql = (grant: string) => `coalesce(${grant}.email, (
  SELECT email.raw_value
    FROM pre_project_cases contact_case
    JOIN crm_opportunities contact_deal ON contact_deal.workspace_id = contact_case.workspace_id AND contact_deal.id = contact_case.opportunity_id
    JOIN crm_contact_points email ON email.workspace_id = contact_deal.workspace_id AND email.party_id = contact_deal.party_id
                                 AND email.type = 'email' AND email.status = 'active'
   WHERE contact_case.workspace_id = ${grant}.workspace_id AND contact_case.id = ${grant}.case_id
     AND EXISTS (SELECT 1 FROM crm_contact_points mobile
                  WHERE mobile.workspace_id = contact_deal.workspace_id AND mobile.party_id = contact_deal.party_id AND mobile.type = 'phone' AND mobile.status = 'active'
                    AND length(ltrim(regexp_replace(mobile.raw_value, '[^0-9]', '', 'g'), '0')) >= 7
                    AND regexp_replace(${grant}.phone, '[^0-9]', '', 'g') LIKE '%' || ltrim(regexp_replace(mobile.raw_value, '[^0-9]', '', 'g'), '0'))
   ORDER BY email.is_primary DESC, email.created_at DESC LIMIT 1))`;
