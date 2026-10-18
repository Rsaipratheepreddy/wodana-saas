# Inbox UI refresh

User-directed detour before Sales: use the supplied messaging reference for an edge-to-edge conversation surface in the existing light theme. Preserve the existing Inbox implementation and routes.

Journey: search/filter conversations → select a client → read messages and delivery state → compose a reply → review delivery/failure. Contact details and linked enquiry remain available through the contextual inspector. No messages or new customer records are created by this visual refresh.

Existing data and APIs remain unchanged: conversation identity, party name, channel, unread count, preview, timestamps, status and permissions; message body/media, direction, delivery/failure status; conversation listing/detail, message pagination, resolution and idempotent send. Draft retention, send restrictions and recoverable failure behavior are preserved.

Changes: remove the outer shell border/radius/margins, use a quiet conversation-list surface and white message area, separate conversation rows with space instead of rules, retain selected-state tone without accent rails, use a single composer surface with visible focus, and show contact details on demand instead of a permanent third column.

Verification: desktop empty state inspected in browser; nine existing Inbox tests and web typecheck passed. Live delivery and populated-thread visual acceptance are not claimed from an empty sample workspace.
