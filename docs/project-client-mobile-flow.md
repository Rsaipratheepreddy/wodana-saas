# Connected project, client and mobile flow

The released BOQ remains the project scope. Materials, supplier orders, factory tasks, site tasks and handover stay linked to that scope through the existing project records. Do not seed operational records to populate empty views.

## Daily progress

1. The assigned person records a dated factory or site update on web or mobile: quantity, shift, workforce, hours, materials, safety, blockers, recovery commitment and next shift plan. A blocked day can report zero quantity with an explanation.
2. Mobile saves the draft and evidence through the existing revision-checked, idempotent offline queue, then submits it for review. Retries keep the same request identity.
3. A different reviewer approves or returns the report. Approved corrections replace the earlier contribution; they do not add it twice.
4. The reviewer explicitly shares selected report attachments and an optional client summary. Approved daily progress can be shared before final QC. Sharing never accepts the task, dispatch or handover.
5. The client portal shows shared work quantities and the current task status. Full output awaiting inspection remains labelled as awaiting inspection until QC passes.

## Client portal

The existing authenticated `/portal/[slug]` is separate from the staff workspace. Designs has its own tab. Progress has Overview, Work progress, Daily updates, Documents and Handover views. Work progress, daily updates, documents and milestones use the staff portal DataGrid with white surfaces. Work and report details open in the shared modal, including only published evidence. Existing project-bound design and handover decisions retain their verification checks.

Only explicitly published approved reports, selected evidence, approved published documents and published handover packs enter the project projection. Work tables derive from shared reports. Internal report notes, manpower, material costs, supplier negotiations and staff comments are excluded. Unpublishing a report removes it and its unsupported work rows from the client view.

## Mobile

The Projects field workspace uses the same backend commands and permissions. Its Tasks, Receiving, Daily updates and QC & handover tabs separate assigned work without duplicating records. Each project stays visible with an explicit empty state when the selected tab has no records. A report's review status and client-sharing status are separate. Receiving starts with a blank accepted quantity, shows the outstanding quantity, and validates finite, nonnegative accepted/rejected quantities against it. A fully rejected receipt records zero accepted quantity and a positive rejected quantity. Retrying an unchanged receipt after a lost response preserves its request ID; changed receipt details get a new ID.

Physical-device camera, offline/reconnect and client-login acceptance testing is still required before a production rollout. No client messages or invitations are sent by these UI changes.

## Client schedule alerts

The portal evaluates delivery dates against the workspace's local day. Open approved supplier orders linked to released scope show an alert when overdue or when the latest shipment ETA exceeds the original promise. Partial and rejected receipts keep outstanding work visible; full accepted receiving clears the alert. Dispatched factory deliveries overdue at site, overdue shared tasks, published schedule-risk reports and client-visible overdue milestones appear in the same Alerts view.

Alerts refresh every minute while the portal is visible and when the client returns to it. Stable record-based IDs prevent duplicate cards. The client can open a prefilled Inbox request to ask the team; no message is submitted automatically. Supplier identities, prices, private shipment notes and unpublished work stay excluded. These are in-portal alerts, not external SMS, WhatsApp, email or device push delivery.
