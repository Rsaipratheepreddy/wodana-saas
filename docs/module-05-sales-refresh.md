# Sales refresh — implementation sequence

User-directed focus after Inbox. Reuse the current CRM and pre-project APIs and records.

Journey: capture an enquiry with a shared client identity → assign and qualify → create/open the linked deal → requirements, design, quote and agreement in pre-execution → release an approved project. Existing conversion and release checks remain authoritative; a visual stage change must not create a project or duplicate customer records.

First slice: actionable Sales overview and navigation. Main views are Overview, Enquiries, Deals, Follow-ups and Pre-execution; Clients and Inbox retain their global destinations. Operational configuration remains under Sales Settings. Pre-execution uses existing routes and permission-filtered availability.

Overview fields: server-provided active enquiries, open deals, pending follow-ups and wins; attention title, reason, due date and deep link; source/month counts when available. No invented forecasts or sums across currencies. Add an urgency filter on loaded attention records, preserve data when refresh fails, distinguish missing totals from zero, and make unknown state visible.

Subsequent acceptance work: enquiry capture/validation/duplicates and qualification handoff; deal board/list editing and preserved drafts; pre-execution source context and revision/approval gates; idempotent project release. Each needs populated, empty, failed, restricted, keyboard and mobile checks before claiming end-to-end completion.

Visual contract: compact readable type, consistent buttons, colored icons, white sections on a quiet canvas, no enclosing borders, brief labels and direct actions. Show reports when data exists rather than filling an empty workspace with empty charts.
