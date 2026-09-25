# Follow-ups timeline

Journey: Daily activity → Follow-ups → choose day → select a time or Create new → choose existing client/enquiry → title, date/time, owner and notes → save → timeline. Open a card to edit notes/reschedule or complete. Calendar and Sales use the same CRM activities; no duplicate records.

Views: day timeline by default; existing searchable list available for overdue, undated and completed records. Timeline fetches all pages for the selected local day using from/to ISO boundaries. A card marks a due time, not an invented appointment duration. Existing appointment duration is preserved by the API.

Editor: spacious document-style page, optional explicit title-time suggestion (AM/PM required for ambiguous hours), explicit date/time fields, client relationship, type, assignee, notes. Client-visible messaging is never sent by saving a reminder. Backend due activities appear in Today/Calendar; push notifications and automatic WhatsApp delivery are not introduced here.

API: GET activities?from&to&limit&cursor; GET activities/:id; POST activities; PATCH activities/:id with version; POST activities/:id/complete with version. Existing permission checks, conflict handling, draft preservation on failure and discard confirmation retained. Completion is a separate explicit action.

Motion: timeline card entrance, hover lift, editor entrance and save-to-timeline entrance. Reduced-motion disables transitions. Keyboard buttons provide all actions; responsive timeline scrolls horizontally and fields reflow; logical CSS supports RTL.

Final navigation: Daily work (Home, Inbox, Follow-ups, Tasks); Work (Sales, Planning, Projects, Resources); Company (People, Connections, Settings). Calendar is accessible in Follow-ups' view selector and has a return link. Tasks opens the shared activity list filtered to task records and defaults new records to task type. HRMS module label is People; backend routes remain unchanged.

Preview sample uses fictional local-only records. Opening, editing, completing and rescheduling samples never writes to CRM. Real creation exits preview and requires an existing customer/enquiry. Google Calendar remains the existing read-only overlay in Calendar; this timeline does not synchronize edits to Google.

Follow-up duration now persists through the existing appointment table. Create/update activity accepts optional durationMinutes (1–1440), and calls, meetings and tasks can have time ranges. Updates preserve duration when moving the start, or change both atomically when duration is supplied. The editor and cards show explicit AM/PM start/end times. Today opens at the current local time; Now returns to it after manual scrolling. Visible scrollbars are hidden while scrolling remains enabled.

Validation: 47 web tests and 12 service tests passed, web typecheck and business-core build passed. Browser checked desktop/mobile controls, custom React Aria date popup, saved 6 PM test call notes and changed its duration to 45 minutes through the real API. Six persisted test activities and four labelled test clients were added only to Wodana Sample Studio for 22 September 2026. No client messages were sent.

### Shared schedule grid
Hourly vertical dividers and half-hour dotted guides use the same local-time origin as cards and the live marker. Timed cards span their saved appointment duration; adjacent events share a lane and overlaps occupy additional lanes. Overnight appointments are clipped to the selected day. Reminders without an end time use a distinct start marker and do not imply a duration. Short cards retain full time/title/client information in their accessible label and hover title; opening a card shows its full details. Scrollbars remain hidden while horizontal scrolling and the Now action remain available.
