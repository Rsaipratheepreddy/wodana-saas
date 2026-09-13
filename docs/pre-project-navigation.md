# Pre-project navigation — agreed foundation

The module now has two levels: a module sidebar with **Pre-projects** and
**Catalogs**, and a case-specific workspace. This replaces the earlier sidebar-free
case selector. Cases are persisted by Business Core, linked one-to-one
to a CRM opportunity, and resolved within the authenticated workspace. The local
Iglo demo contains two saved cases, not frontend-only cards.

Commercial records, approvals, payments and execution releases are **not**
implemented by this foundation; those sections remain explicitly planned.

## Entry and case routes

- `/workspace/pre-projects`: table-only list, search, status filter tabs, pagination
  and Start pre-project. A plain surface, neutral column headers, thin column
  dividers and compact rows follow the CRM Leads table treatment. Client initials
  and small status pills retain record identification without a gradient frame.
  Content is centered in the main area beside the sidebar with a 70rem (1120px)
  maximum width. The Projects entry retains its existing table presentation,
  with one explicitly labeled demo row that opens the scoped project sidebar.
  Pre-projects uses the module switcher
  for CRM and Projects; the former buttons above its table have been removed.
  Projects has Back to Pre-projects above its table. Projects search
  and status filters currently operate on its local demo preview only; they are
  not connected to an execution-project API.
- `/workspace/pre-projects/catalogs`: workspace-shared catalog and master data.
  The same two module destinations stay visible; categories are sections within
  Catalogs. Workspace settings links to this new location. The catalog API,
  permissions, data ownership and records are unchanged by the relocation.
  Catalogs have tenant-chosen names, tenant-managed groups and editable master
  records. They are shared across cases. Master prices and execution configuration
  belong here; quotation automation is a separate module.
- `/workspace/pre-projects/cases/:id/overview`: selected case and live CRM context.
- `/workspace/pre-projects/cases/:id/:section`: case-specific sections below.
- Back to all pre-projects preserves the allowlisted search, status and page.
  Legacy Cards/Table view parameters are ignored; the selector always uses a table.
- Old case-less section bookmarks return to the selector with the intended section;
  users must choose a case. Unknown cases/sections are not silently substituted.

## Case foundation

`GET/POST /workspaces/:workspaceId/pre-projects`, `GET /candidates`, and `GET /:id`
are backed by `pre_project_cases` (migration 0022), tenant RLS, permissions and a
same-workspace source guard. Reads require `pre_projects.view`; starting a case
also requires `pre_projects.create` and `crm.opportunities.view`. Existing owner
and administrator roles receive the two new permissions; other roles need an
explicit grant. Starting locks the opportunity, checks open/won eligibility and
returns an existing case on repeated/concurrent requests. Audit and outbox are
recorded transactionally, once. CRM status and party identity are not copied or
modified; creating a case never wins a deal or releases execution.

The local-only seed is `node services/business-core/scripts/seed-iglo-pre-projects.mjs`
from the app root. It creates/reuses cases for the first two existing Iglo demo
opportunities, checks repeat-start idempotency, and does not alter CRM statuses.

## Module sidebar

- Pre-projects
- Catalogs

Case-specific sections appear only after a case is selected. On narrow screens,
the same navigation is available through the header's Open navigation button.

## Selected-case sidebar

- Overview
- Preparation
  - Brief & scope
  - Site
  - Design
- Commercial & approvals
  - BOQ & costing
  - Quotations
  - Contracts & terms
  - Payment plan
  - Variations
  - Approval center
  - Execution release
- Records
  - Files & activity

Groups are collapsible. Navigation search also matches each section's scope, so
measurements resolve to Site and inspirations resolve to Brief & scope. Previous
site-visit, measurement, inspiration, and client-approval URLs redirect to the
case selector while preserving safe list context. The old `/pre-projects/all`
bookmark also returns to the list with query context. There are 12 case-specific
destinations plus the shared Catalogs link in the selected-case sidebar. Catalogs
never receives a case ID or case filters. The All pre-projects header link returns
to the list with its prior search, status and page.

## Case-level tabs to design next

Plan the forms and secondary tabs inside each sidebar section next. The seven
commercial destinations all belong to the selected case, not separate global
record lists. There is one Approval center per case using the future shared
approval engine, not independent duplicate approval systems.

## Module boundaries

- CRM: customer relationship, qualification, opportunity, and follow-up.
- Pre-project: define, design, cost, agree, and approve the intended work.
- Projects: operational planning, procurement, production, installation,
  quality, snagging, and handover of released work.

Commercial records remain linked and accessible after handoff. Execution
approval requests use the shared approval system while their source records
remain in Projects. Client views must exclude internal costs and private notes.
Accepted quotations, completed contracts, verified payments, and execution
release are distinct decisions. Creating a planning record cannot authorize
purchasing or production.

## Next design step

Plan each section before implementing its workflows. The commercial sequence is
BOQ & costing → Quotations → Contracts & terms → Payment plan → Variations →
Approval center → Execution release. The case/CRM foundation is now in place;
begin with Brief & scope. Do not seed fictional accepted quotes, signed contracts,
payments or released projects while their workflows are still planned.

## Navigation verification

The sidebar/catalog relocation passed the web TypeScript check, 31 focused
component and route tests, and 10 browser tests across desktop and narrow-screen
web. Browser checks cover both module destinations, case links and restored list
filters, catalog categories, old bookmarks, light/dark themes and page overflow.
This verifies the operations portal; it does not implement the deferred mobile app.
