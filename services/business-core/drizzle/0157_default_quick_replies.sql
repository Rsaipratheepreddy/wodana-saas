-- Every workspace starts with a few team quick replies (typed after "/" in a chat); a firm edits or archives them.
-- A shortcut the workspace already has (active or archived) is left alone. New workspaces get the same set when
-- they are created (seedDefaultQuickReplies in crm/conversations/inbox/default-quick-replies.ts).
INSERT INTO crm_quick_replies (workspace_id, owner_membership_id, shortcut, body)
SELECT workspace.id, NULL, seed.shortcut, seed.body
  FROM workspaces workspace
 CROSS JOIN (VALUES
   ('thanks', 'Thanks for your message, {{contact.first_name}}. We have received it and will get back to you shortly.'),
   ('floorplan', 'Could you share your floor plan? A photo or a PDF is fine. It helps us plan the space and prepare an accurate quotation.'),
   ('sitevisit', 'We would like to visit the site. Which day and time suit you best? A visit usually takes about an hour.'),
   ('quotation', 'Your quotation has been sent. Take your time to review it, and let us know if you have any questions.'),
   ('payment', 'The payment details and the amount due are on your invoice. Please share the receipt here once it is done, and we will confirm it.'),
   ('handover', 'Your project is nearly ready for handover. Which day and time work for you to walk through it with us?')
 ) AS seed (shortcut, body)
 WHERE NOT EXISTS (
   SELECT 1 FROM crm_quick_replies existing
    WHERE existing.workspace_id = workspace.id AND existing.owner_membership_id IS NULL AND existing.shortcut = seed.shortcut);
