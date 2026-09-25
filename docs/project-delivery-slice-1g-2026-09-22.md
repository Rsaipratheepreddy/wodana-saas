# Slice 1G — linked RFQ replacement

Journey: open an unselected supplier request → Replace request → confirm response/delivery dates and reason → create a new frozen request from the current requirement → retain the original as cancelled with bidirectional history links. Previous offers stay on the original; they never become offers for changed scope. Creating a replacement sends nothing and does not create or transfer a portal grant.

Boundary: this first replacement flow keeps supplier, requirement, task, requested quantity and unit. It refreshes specification and dates. Changed quantity/unit, reassigning scope, or a batch with an active supplier selection require a separate planning/amendment flow; reject rather than quietly releasing commitments or mixing incompatible batch allocations. Unlinked legacy requests and already replaced requests are blocked. A cancelled, unselected request can be replaced, but an awarded order cannot.

Fields: replacesRequestId, replacedByRequestId, replacementReason, replacementBy, replacementAt; existing frozen scope captures current specification/catalog version and dates. Original snapshots, offers and audit history remain intact. Existing batch identity and quantity limit are retained. Supplier identity is resolved again from the workspace directory. Validate and create on a clone, then publish the new and retired records atomically. Existing project revision/idempotency/locking applies.

UI: existing inspector gets Replace request and compact previous/next reference buttons, plus the reason; no main tab. Replacement dialog has quotes-due date, required delivery date and reason. Comparison retains retired requests and marks them Replaced. New request starts with no offers. Existing table grid and responsive inspector remain.

API: replace_enquiry execution command, existing active-supplier resolver, existing private vendor endpoint. Old grants can read retired request status but cannot submit; new access requires an explicit share action. Order amendment and full-batch quantity revisions remain next slices.

## Verification and remaining boundary

Implemented locally. 24 focused backend tests and 7 focused UI tests passed. Desktop/mobile browser checks passed (2), exercising keyboard navigation through previous/next request links, the replacement dialog, full table borders and RTL overflow; screenshots inspected. Web and backend TypeScript checks and targeted inspector/comparison lint passed. No live database integration, supplier messages, portal grants or deployment were performed.

Coverage includes preserved original offers/specification, a fresh replacement snapshot, repeated revision links, invalid-input rollback, active-selection/unit/task/supply guards, workspace-scoped active supplier resolution, and rejection of vendor submissions to retired requests. Existing revision and retry guards remain in the command service. Historical cancelled requests remain visible in supplier comparison.

Still intentionally separate: replacement with different quantity/unit/supplier, full-batch scope revision, and amendments to selected or approved orders. These must preserve allocation and spend authorization before changing existing commitments.
