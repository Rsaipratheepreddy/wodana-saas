# Wodana delivery memory

Last audited: 16 September 2026. This is the working source of truth for the current delivery. It records verified code state, not aspirational roadmap claims.

## Product direction

- Wodana is the generic multi-tenant SaaS product. Palm Living is a tenant configuration, never a tenant-specific fork.
- Tenants retain their own terminology, brand colour/logo, catalogue, teams, departments, workflow labels and organisation data. Default terminology appears when no tenant override exists.
- A customer account may contain one organisation by default. Additional organisations are separate data boundaries under the same account and require a tenant request plus Wodana approval; they are not mixed workspaces.
- The immediate release objective is a local/UAT-ready journey through quotation. Do not claim production deployment, backup/DR, live accounting/WhatsApp, migration or AI import completion unless separately verified and approved.

## Working order

1. Remove legacy/demo/broken paths and make each client-facing flow use the live, tenant-scoped source of truth.
2. Finish backend behaviour and tests for one module before polishing that module's UI.
3. Then connect and polish UI end-to-end from authentication through quotation. Do not add features merely because an old demo screen suggests them.
4. Production infrastructure, backups, operational migration and AI-assisted import follow UAT, unless the user explicitly reprioritises them.

## Clean-reset record

- On 16 September 2026, the local `wodana` PostgreSQL database was confirmed to be on a local socket and reset with explicit user approval. It held 29 non-client workspaces (28 automated smoke workspaces and one disposable Iglo workspace).
- The local database now has zero workspaces and zero user accounts. The cleaned migration history was reapplied successfully (72 migrations). No hosting or production system was accessed or changed.
- Removed from source: automatic demo tenant seeding, demo-only Iglo/project seed and cutover scripts, legacy project-import endpoint/table/UI, obsolete Palm-specific legacy CRM taxonomy migrations, and the separate browser-only project demo route.
- The application now has one project route family only: tenant-scoped live projects. A fresh UAT tenant must be provisioned deliberately before browser testing resumes.

## Verified foundations

- Auth/onboarding: tenant-scoped login, MFA support, device limit handling, branded tenant onboarding and user-facing configuration fields exist. The internal Wodana portal is platform-admin-only.
- CRM: intake, identity resolution evidence, SLA/assignment, qualification and controlled conversion are implemented.
- Pre-execution: case/brief, rooms, requirements, site evidence, designs, specifications, readiness and immutable client-confirmed definition baselines are implemented.
- Catalogue/commercial: catalogue adoption, vendors/offers, selling-price links, quotation templates, definition-bound proposal composition and release lineage are implemented.
- Tenant/project backend: planning projects, released scope lineage, workflow templates/history/gates, resources, cross-project capacity checks, bookings, portfolio calendar and execution command foundations exist. Released quote lines now materialise authoritative work packages; accepted additions create new packages and deductions block affected packages rather than erase history.

## Project module: actual status

### Real/live path that exists

- `/workspace/projects` now uses the live `ProjectPortfolio` data source.
- A planning project can be created from an active Pre-execution; it is linked to that case.
- A live project detail route reads `GET /workspaces/:workspaceId/projects/:projectId/execution` and sends state-changing commands to the same tenant-scoped backend.
- The detail workspace has live sections for Overview, Schedules, Material planning, Procurement, Production, Execution, Daily progress, Snagging, Handover, Scope & Design, Budget and BOQ.
- The project backend tests passed on 16 September 2026: 60 focused tests across workflow, release, work packages, execution pulse, schedule capacity, portfolio calendar and execution domain. Root typechecking, the project component tests and a production web build also passed after this work.

### Not release-complete / must be treated as work remaining

- The live project workspace must be audited tab-by-tab against the project baseline. Existing APIs and widgets do not equal a coherent Palm Living delivery workflow.
- Current project detail needs an end-to-end tenant UAT pass from released quotation to work package/task, materials, procurement, factory/site execution, progress, quality, handover and warranty. Empty states, permissions, errors and mobile usage must be checked.
- The full departmental/resource overview needs a client-ready UI using the live portfolio calendar/capacity API. It must show cross-project overlaps by department; Design red, Production purple and Procurement grey are tenant-configurable defaults, not hard-coded Palm Living logic.
- Product workflow now starts with released-scope work packages → tasks → subtasks. A task with released scope derives its package link from that scope; it cannot claim another package's source line, and a subtask cannot move across its parent's package.
- Project state now includes a deterministic execution pulse for future UI: it ranks blocked packages/tasks, overdue work, inspection queues, supplier acknowledgements and genuinely start-ready work. It does not mutate data or pretend to be AI.
- Live daily progress must remain review-derived and auditable. Browser-local storage is permitted only for an unsent local draft; it must never be represented as server-saved progress.

## Project module implementation order

### Slice 1 — Project initiation (backend completed 16 September 2026)

- Release now creates an immutable commercial initiation snapshot: accepted quote/version, Deal File, agreement reference, currency/value and payment milestones.
- A project manager confirms the operational charter only after commercial release: accountable owner, role holders, initial team access, project-owned sites, client contact/access notes, objective, promise and dates.
- The confirmed baseline seeds the live project forecast but remains separate from it. It cannot be silently replaced: a justified revision is retained in history and is blocked once detailed delivery planning starts.
- Site IDs are verified against active sites belonging to the project; role holders and the initial team receive real project assignments in the same command transaction.
- Focused initiation/release/work-package tests, full business-core tests (597 passed, 10 skipped) and root typechecking passed. No project UI claim has been made.

### Slice 2 — Controlled commercial changes (backend completed 16 September 2026)

- A formal Change Case now controls additions, removals, replacements, clarification/schedule amendments and price corrections. It retains the existing client-request history rather than creating a disconnected change record.
- Before client documents can be prepared, the case captures the affected work packages, tasks, purchase orders, materials, confirmed bookings and reported/completed-work warning. Each visible impact requires an explicit, auditable disposition.
- A replacement produces paired removal and addition variations. Neither money records nor project work are released until every linked document is accepted; a partial client acceptance stays pending safely.
- Accepted deductions remain conservative: affected tasks and work packages are blocked for replanning rather than silently deleting or auto-segmenting live work. Supplier commitments and reported work still block release for reconciliation.
- Project execution records the released Change Case reference alongside its variations. If the client rejects a complete, unaccepted package, it can be withdrawn and restarted from a fresh impact assessment; after any acceptance, a corrective Change Case is required.
- Focused change-control, variation and work-package tests passed, as did business-core typechecking. Full-suite and UAT validation remain required before any delivery claim.

### Slice 3 — Design-to-delivery control (backend completed 16 September 2026)

- Delivery now captures the exact approved Pre-execution design revision(s) for every released, scoped quotation item. It rejects archived, changed, unapproved or blocking-thread design evidence before project release.
- Those revisions become approved, traceable project documents linked to their released scope. The original project files remain available from the pre-execution file location; delivery does not copy or mutate them.
- A site or factory task with design-controlled scope must point to the captured approved design document. A generic, stale or superseded drawing cannot start that task; office-only design work remains intentionally unblocked.
- Accepted variation scope uses the same design capture and cannot enter delivery planning without its corresponding approved design evidence. The baseline keeps earlier accepted evidence while adding new variation evidence.
- The execution pulse now surfaces missing design evidence as an actionable item before it offers a task as start-ready. Focused tests, the full business-core suite (605 passed, 10 skipped) and root typechecking passed. No project UI or UAT-complete claim has been made.

### Slice 4 — Executable work-package readiness (backend completed 16 September 2026)

- `Ready` is now an operational decision, not a label. Before a package can become ready it needs planned work, an accountable package owner and task owners, consistent delivery route, no recorded task blocker, and each task's scope/access/material-readiness checks.
- A site/factory package additionally needs the approved captured design evidence for its scoped tasks. Company-supplied requirements need enough recorded available stock; vendor-supplied requirements need an acknowledged vendor commitment. Client-supplied materials remain governed by the explicit task material-readiness confirmation.
- The project execution pulse uses the same evaluator, so it tells the project manager the first concrete missing condition rather than a generic “prepare package” instruction.
- Focused readiness, design, package and full-suite tests passed (607 passed, 10 skipped), with root typechecking clean. Resource booking and customer-promise escalation remain separate command-centre work; they are not being claimed as complete.

### Slice 5 — Resource booking truth (backend completed 16 September 2026)

- The project pulse and the task-start command now use the same operational rule. A site or factory task can show as start-ready only when its assigned active resource has a confirmed booking for that same task that covers the full planned task period.
- A missing resource, an inactive resource, a draft/tentative booking, an old booking, a partial booking or a confirmed booking for another resource all produce one clear **Book work** action instead of a misleading start action.
- The backend enforces the same resource, task and date-span check at command time, so a stale browser state or a direct API request cannot bypass the calendar commitment.
- Focused pulse tests cover absent, old, partial and wrong-resource bookings. The full business-core suite passed (608 passed, 10 skipped) and root typechecking passed. This is backend control only; booking/calendar UI UAT is still required.

### Slice 6 — Project command-centre decision truth (backend completed 16 September 2026)

- Project controls now produce one deterministic decision queue: owned project holds, material risk, due/overdue client promise, due/overdue handover, dated client action and next client meeting. Each item carries the accountable member ID for the live workspace to render.
- A project hold is now reflected honestly in that queue. The command centre will not offer package preparation, design resolution, booking or task-start actions while the backend refuses new task starts; the project hold is elevated ahead of all lower-level execution work.
- A client action must be saved with its action, owner and date as one complete commitment. A client meeting must have its own owner, and a handover cannot precede target completion. The existing Project controls form now collects and validates those fields before it calls the backend.
- The queue remains an internal operating view. It does not disclose margin, vendor negotiation or private notes to the client portal.
- Focused tests, the full business-core suite (610 passed, 10 skipped), 14 project web-component tests and root typechecking passed. This verifies contracts and the existing form path; it is not a claim that the command-centre UX itself has completed UAT.

### Slice 7 — Factory-to-site delivery hand-off (backend completed 16 September 2026)

- A linked production chain now enforces: scoped factory task → approved measured factory output → independently released dispatch → carrier record → independently received site delivery → site installation. A site task that directly depends on a factory task cannot start until it has a received dispatch with accepted quantity for that exact site task.
- A linked recipient must be a live, measurable site task in the same project, with the factory task as a direct predecessor. The backend rejects the wrong task type, closed/parent task, absent dependency, unit mismatch, different work package or incompatible released scope. Warehouse/client deliveries remain supported without a receiving task.
- Dispatch release and receipt are independently verified. A rejected quantity creates a linked major snag; the correction requires evidence and a different reviewer to close it. Replacement output cannot be released while that rejection remains unresolved.
- Task cancellation now protects live receiving tasks with ready, dispatched or received deliveries. Production shows the linked site task for each dispatch and opens the correct receiver automatically when a factory job has exactly one valid site successor.
- The deterministic project pulse now exposes the real next factory/site action: plan or review a delivery, record dispatch, receive overdue delivery, or resolve rejection. It does not mutate project data or claim AI decisions.
- Full business-core tests passed (613 passed, 10 skipped), the 14 focused project web tests passed and root typechecking was clean. This is backend/light-UI verification, not a claim of tenant UAT completion.

### Slice 8a — Site installation readiness and truthful partial progress (backend completed 16 September 2026)

- A received factory delivery is now an explicit physical limit, not merely a start signal. A site task may start after at least one accepted unit from every directly linked factory predecessor, allowing phased installation.
- Site progress is independently approved as before, but it can never exceed the least accepted quantity from the task's direct factory inputs. A receipt for a different room/task is excluded. This prevents a site team from reporting installation ahead of what has physically arrived.
- The rule remains generic: site tasks without a direct factory predecessor continue to use their existing package material/readiness controls, while direct factory-to-site paths use the exact linked dispatch receipts.
- The project action contract marks a partial site start honestly, including the accepted quantity and instruction to keep approved installation output within that limit.
- Full business-core tests passed (614 passed, 10 skipped), the focused project web tests passed and root typechecking was clean. This is backend verification, not tenant UAT completion.

### Slice 8b — Daily evidence, quality decisions and safe automation hooks (backend completed 16 September 2026)

- A daily report still requires evidence (uploaded file or signed/reference record) and measured work or a no-work explanation. It now records an explicit safety state and a forecast state: **none**, **watch** or **blocked**. A safety observation/incident needs a description; an incident must state whether it affects the schedule.
- A delayed or blocked report must include the impact, a recovery plan, one accountable member and a next-update date that is not before the shift. This is a structured internal commitment; it never auto-blocks work, rewrites dates or changes approved quantities without a reviewer.
- Returned reports become a named, owned correction action. Submitted schedule-risk and safety-incident reports become critical review/recovery actions ahead of ordinary work. Correction reports still supersede approved output rather than mutating approved history.
- Commissioning remains linked to completed/awaiting-inspection site work and independently reviewed. The execution pulse now makes overdue draft checks, returned checks and submitted reviews explicit; scheduled reminders cover due/overdue commissioning as well as tasks, snags, technical queries, milestones, released dispatches and dispatched deliveries.
- Project actions now emit concise durable events for daily-report submission/return/approval, schedule risk, safety incidents, task schedule changes, dispatch transitions and commissioning transitions. The existing automation worker can use these event names for tenant-configured follow-up, webhook or email flows; events do not include full report text, readings or private task descriptions.
- In-app project updates continue immediately. Email is deliberately opt-in: the tenant must approve a `project.update` email template using only the documented safe variables, and the individual recipient must enable the matching email preference. The existing notification queue then handles quiet hours, frequency policy, retries and delivery records. Missing/broken mail configuration cannot roll back a project command.
- Focused report, pulse and event tests passed; full regression and UAT confirmation remain required before a delivery claim.

### Slice 9a — Generated area acceptance packs (backend completed 16 September 2026)

- An area handover is now generated from one authoritative source: either a complete area or a delivery work package for partial delivery. Staff do not select arbitrary tasks or documents. The system derives the exact leaf-task scope, applicable approved/published project documents, passed commissioning and received dispatches, then freezes those facts into a versioned packet.
- A pack cannot become ready while its derived work is incomplete, source has drifted, a required document is stale or unpublished, a related snag/technical-query/dispatch/commissioning issue remains open, material receipt is incomplete, or a named blocking commitment is still open. Unrelated project snags do not block an area handover.
- A returned pack retains its history and is corrected as a new frozen packet version. Every outstanding closeout item has a type, accountable owner, date, blocking status and resolution/evidence record. Final project completion continues to block on unresolved closeout work unless it has been deliberately transferred to warranty.
- Client acceptance is identity-safe. A sole configured portal approver can be selected automatically; where several exist, a manager selects the approver deliberately. The selected person can accept or request changes through the authenticated client portal with the existing purpose-bound OTP challenge. A signed on-site record is an explicit, evidenced fallback, not a staff member typing a client name.
- Handover packets are client-safe in the portal: no internal margin, private notes, evidence or staff ownership is exposed. Due client decisions and dated closeout commitments feed the existing decision pulse, reminders, assignments, notifications and safe project events without silently sending email.
- Focused handover/domain/event/pulse tests passed. Full business-core regression passed (627 passed, 10 skipped); full web regression passed (538 passed); root typechecking passed. The welcome-envelope and device-refresh test fixtures were also updated to reflect the current approved product flow. No tenant UAT or deployment claim has been made.

### Slice 9b — Warranty, retention and final project closure (backend completed 16 September 2026)

- Warranty coverage now derives from the exact accepted area handover and ends on its recorded warranty date using the tenant's local calendar day. A claim must reference that accepted area and, where a task is named, work included in that immutable acceptance packet. Expired coverage becomes a new client request rather than a false warranty claim.
- An authenticated portal contact can report a covered warranty issue with a purpose-bound OTP. The system assigns the project manager automatically, records the client claim once per verified challenge, preserves an audit/event trail, and exposes only safe status/title/area/urgency to the client. Client text, evidence and internal ownership remain private.
- The existing independent remedy/verification workflow is reused: a team member submits correction evidence, then a different reviewer closes it. Warranty claims do not reopen the completed project or change closed finance records. The project decision pulse and daily reminders elevate overdue remedies and ready-for-verification claims.
- Final account closure is a deliberate, separate action. It now requires every physical handover to be accepted, retention to be verified, supplier credits and client payment reconciliation to be complete, and evidence for the finance decision. Project completion still has its own full work/closeout/financial gate.
- Handover OTP challenges now parse their project-and-handover-bound five-part purpose correctly. Warranty email uses the same safe `project.update` template, individual opt-in and tenant policy checks as other project mail; a missing/broken mail configuration cannot discard a claim. In-app owner notification and a safe durable warranty event are created in the same transaction.
- Focused warranty/portal-purpose/domain/event/pulse tests passed. Full business-core regression passed (636 passed, 10 skipped); full web regression passed (539 passed); root typechecking passed. No real client OTP, email, push notification, UAT tenant or deployment was exercised.

### Next locked slice — End-to-end UAT journey and real delivery channels

1. Provision one disposable UAT tenant and run the full sample journey: lead → qualification → pre-execution → design/definition approval → catalogue/quote → agreement/release → project → procurement/factory/site → handover → warranty → closure. Verify revisions, rejections, returns, permissions, tenant separation, empty/error states and mobile paths; do not use a real customer record.
2. Verify the operational channels with deliberate test credentials: portal login/decision/warranty OTP delivery, project email template/policy/preference/worker delivery and idempotent retries. The code currently has a generic push queue and device-endpoint schema, but **FCM delivery and mobile token registration are not implemented or configured**; they require the Firebase/Expo credential decision and a real test device. Do not claim FCM is live before that.
3. Once the sample journey and real channel smoke tests are signed off, freeze backend scope and start the planned project/portfolio/frontend UX pass. Production backup/DR, live accounting/WhatsApp, migration tooling and AI-assisted imports remain separate post-UAT release work.

## Do not lose these client requirements

- Reintroduce usable quotation templates and a visible project file/document location.
- Provide project-level views and a full cross-project department calendar. Event titles need deal reference, client name, department/team, assigned person and booked time.
- Keep project overview/progress visible to the client, while protecting internal margin, vendor negotiation, private notes and unapproved forecasts.
- Keep catalogue creation/import simple. Spreadsheet import is planned; AI-assisted raw-data migration is a later onboarding feature, not silently active now.
- Platform primary colour must be configurable per tenant, with accessible derived states and a Wodana-powered attribution where appropriate.

## Guardrails

- Do not state that a module is done merely because backend code or tests exist. A module is ready only when its live tenant route, permissions, error/empty states, mobile behaviour and handoffs have passed UAT validation.
- Do not connect to hosting/production or deploy without explicit user approval.
- Do not expose passwords, MFA secrets, internal tokens or client personal data in logs or responses.
- Treat repository planning documents as background. Check current source and tests before reporting implementation status.
