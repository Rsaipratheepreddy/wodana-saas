-- Guide B: enquiry titles read "Client · Area, Region" (lists put the reference in front); the earlier "Client (Area, Region)" titles follow.
UPDATE crm_enquiries SET title = regexp_replace(title, '^(.+) \(([^()]+)\)$', '\1 · \2'), updated_at = now()
 WHERE title ~ '^.+ \([^()]+\)$' AND title <> 'Erased enquiry';
