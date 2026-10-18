-- Guide step 19 (16 Oct 2026): when the client signs an item's drawing, the item's own materials follow the signed
-- quantity, and the project manager is told which shared materials to check. The signed-drawings message carries that
-- note. Only the standard wording is updated; a firm's own wording stays.
UPDATE notification_templates SET body_template = '{{actor}} signed the shop drawings for {{item}}. They are locked. {{note}}'
 WHERE code = 'project.item_drawings_signed' AND channel = 'in_app' AND body_template = '{{actor}} signed the shop drawings for {{item}}. They are locked.';
--> statement-breakpoint
UPDATE notification_templates SET body_template = E'{{actor}} signed the shop drawings for {{item}}.\n\nThe signed items are locked to the sizes and quantities on their drawings, and their materials follow them. {{note}}'
 WHERE code = 'project.item_drawings_signed' AND channel = 'email' AND body_template = E'{{actor}} signed the shop drawings for {{item}}.\n\nThe signed items are locked to the sizes and quantities on their drawings.';
