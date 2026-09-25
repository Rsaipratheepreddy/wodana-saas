# Product implementation plan

Updated 21 September 2026 after sidebar naming and onboarding feedback. The product direction is accepted; the current onboarding UI is not an approved design baseline.

The product master plan remains the functional scope. The previous interactive mockup is rejected as a visual baseline: it is too sparse, muted and informational. Implement a more visible working interface with clear action hierarchy, purposeful surface tones, concise explanations and direct access to catalog, material and quotation work. Respect tenant branding, accessible contrast, mobile and keyboard behavior. Do not add decorative acronym labels or multiple headings that repeat the same meaning.

## Final interface contract

- Primary actions use a solid tenant accent and readable foreground. Related actions use a restrained tinted surface and a clear verb. Navigation and passive information remain visually distinct.
- Pair icons with visible words. Show one short explanation where an action's consequence is not obvious. Essential meaning must not depend on tooltips, color or abbreviations.
- Use structured, compact working regions, clear section headers and consistent row alignment. Empty space serves readability; it must not hide the available work.
- Catalogs, materials and quotations have named entry points and preserve context. Reuse existing editors and authoritative records. A shortcut must lead to the intended working view.
- Customization has sensible defaults, explicit save/reset behavior, permission filtering and recoverable errors. Personal layout choices do not grant data access.
- All actions must reflect real capabilities; do not show sample metrics, fabricated approvals or disconnected action buttons in production.

## Next module specification

[Module 01 — Account and workspace onboarding](module-01-account-workspace-implementation-plan.md) details the selected module: entry journeys, screen fields, existing and proposed database columns, transactional APIs, permissions, migration, visual acceptance and implementation sequence. Module 0 navigation naming is its foundation; Connections follows.

## Build order

Navigation foundation progress: the global sidebar now exposes Home, Inbox, Sales, Clients, Projects and Resources according to server-filtered destination access. Tasks, Calendar, Requirements & quotes and Team remain direct shortcuts; Connections and Settings are utilities. Existing URLs remain unchanged. Route ownership checks separate Inbox, Clients, personal activity and Resources from their legacy parent modules. Desktop rendering and the Resources destination were checked in the browser; sidebar interaction/permission/route tests and typecheck passed. Full mobile, RTL and cross-module terminology acceptance remains open; this is not completion of Module 0.

Current sequencing clarification: Home is paused at the user's request. The next business-module design pass is [Module 04 — Resources](module-04-resources-implementation-plan.md), using the existing catalog/import/editor implementation. Clients and client import remain in Module 05. Connections live-provider acceptance remains open; this scheduling choice does not mark earlier modules complete. The workspace-readiness document is a Module 03 slice despite its historical `module-02` filename.

| Module | Deliverable | Acceptance |
| --- | --- | --- |
| 0 Navigation and language contract | Agreed destination names, hierarchy, route mapping and terminology across all modules | Every destination has one clear purpose; no misleading labels, duplicate homes or broken existing links |
| 1 Account and workspace | First-impression redesign: sign-in/recovery/invitations, role-aware setup, useful defaults and first real action | New users understand where they are, what is required, what saves, and how to begin; current onboarding is not accepted as finished |
| 2 Connections | Task-led setup for messaging, accounting, calendar and files; account/entity ownership; verification and recovery | Unknown status stays unknown; authorization and a verified operation are distinct; no duplicate accounts on retry |
| 3 Shared workspace and Home | Six-destination navigation, search, contextual record drawer, configurable actionable widgets | Find and complete work in context; user/workspace preference isolation; no decorative borders |
| 4 Resources: catalog and materials | Searchable library, completeness review, import mapping, units and price records, contextual editing | Missing Palm source prices/units stay unresolved; generic catalogs use the same checks |
| 5 Sales, Clients and Inbox | Capture once, linked client timeline, ownership, forms and conversations | Intake-to-reply and follow-up without duplicate history; source retained |
| 6 Requirements and quotation | Structured brief, reviewed suggestions, shared calculations and versioned proposal | Palm nine-line proposal reconciles; generic service quote works; acceptance binds exact version |
| 7 Projects and delivery | Work plan, demand, purchasing, factory/site quantities, inspection and change impact | Partial delivery, rework, client-owned material and service-only scenarios reconcile |
| 8 External portals | Visual progress, explicit sharing, scoped reviews and replies | Published data only; decisions and communication return to source records |
| 9 Automation and SaaS completion | Simulated rules, integration recovery, reporting, administration and pilot | Role-separated journeys, provider evidence, accessibility and operational acceptance |

Each module uses the master plan's interaction references: Notion for connected records and composed views, Figma for contextual inspectors, Miro for optional visual discovery, Jira for owned work and dependencies, and FlowPilot for restrained visual hierarchy. These are interaction references, not a request to copy every feature into every screen. Use tenant tokens and tone/spacing instead of decorative lines. Retain visible keyboard focus.

Innovation acceptance is behavioral: remove repeated entry, explain missing information at the place it is resolved, preserve context, and offer reviewable assistance. New colors, headings or an AI badge do not satisfy this acceptance.

Implement and validate each slice before expanding. Preserve existing local changes. This is an incremental implementation, not authorization to deploy or send customer messages. Record each completed slice and its remaining limitations below; do not mark the entire product complete after one module.

## Strict UI and UX acceptance

The user explicitly requires the quality and familiarity of the supplied Notion, Figma, Miro and FlowPilot references. Treat them as concrete interaction and composition references, not loose inspiration or names in a plan. Before each module, compare its working layout against the relevant reference and record the specific pattern being adopted. Do not claim fidelity based only on a neutral palette or similar sidebar.

### Appearance

- **No decorative border system:** no accent rails, outlined passive cards, sharp rectangular containers, row-by-row rules or all-sides page frames. Do not solve this by rounding every bordered card. Use open composition, spacing, gentle surface changes and alignment. Preserve visible keyboard focus and essential error/selection states.
- **No empty-looking product:** expose useful work and primary actions immediately. Avoid giant greetings, oversized headings, large vacant blocks, isolated metrics or an almost-empty page of shortcuts. Empty workspaces show a specific way to begin plus an optional labeled example, never invented records.
- **No card dashboard as a universal layout:** use a working sheet for prices, a thread for conversations, a record page for a client, a contextual inspector for a selected item, and a visual gallery/canvas only when the task benefits. Home widgets are purposeful working regions, not outlined boxes filled with headings.
- **Minimal means less effort, not less visibility:** keep actions discoverable, use readable text and meaningful labels, and reveal advanced controls when needed. Do not hide essential actions behind icons, hover, a generic menu or faint text.
- **Calm but recognizable:** use coherent typography, compact toolbars, balanced density and restrained tenant-colored actions. Images and thumbnails should help identify actual items, materials, designs or progress, rather than decorate blank space. Keep passive surfaces neutral and actions/states distinguishable.
- **Consistency:** reuse the same action placement, selection behavior, inspector, search and save feedback across modules. The account/onboarding experience and the signed-in workspace must feel like one product. Validate both light and dark modes and multiple brand colors.

### Think like a normal user

For every screen and transition, review these questions without relying on technical or product knowledge:

1. Where am I, and what is this screen for?
2. What matters now, and what can I do next?
3. Do the labels match how I describe my work?
4. Can I complete the task here, or am I being sent through unrelated screens?
5. Why is information requested, and have I already entered it elsewhere?
6. What will happen when I press the primary action? Does it save, submit, share or send?
7. Did it work? If it failed or is blocked, can I recover without losing my work?
8. Can I go back, correct a mistake, or leave and resume?

### Two review passes before completion

**Visual pass:** inspect rendered desktop and mobile screens, not just source code. Check hierarchy, content density, typography, contrast, awkward blank space, long labels, modal/drawer sizing, overflow and unnecessary borders. Compare with the selected reference pattern. Screens that still look empty, card-heavy or visually confusing remain unfinished even when tests pass.

**Task pass:** walk through a realistic role-specific task with representative data, from entry to saved outcome and its next connected step. Repeat with an empty state, a recoverable failure and restricted access. Verify keyboard navigation and focus. Use Palm scenarios plus a generic service-business example. Record observed results separately from assumptions; a developer walkthrough does not substitute for actual user testing.

A module is accepted only when business correctness, visual quality and task clarity all pass. Passing compilation, removing borders, adding animations or attaching an AI label is insufficient. Rework a failed screen before carrying its pattern into the next module.

## Sidebar naming and information architecture

This is foundational work before further module UI implementation. Audit sidebar labels together with page titles, breadcrumbs, search results, buttons, mobile menus, permissions and empty states. Renaming only the sidebar leaves the product confusing.

Default main destinations remain **Home, Inbox, Sales, Clients, Projects, Resources**. Use a small utility area for **Connections** and **Settings**. Search and Create are consistent global actions. Tasks and Calendar are personal working views reachable from Home and pinning; do not remove their direct routes. A user can pin frequent views such as Quotations without creating a second implementation of that screen.

| Current label or pattern | Target name and placement | Meaning and migration rule |
| --- | --- | --- |
| CRM | Sales | Enquiries, pipeline, follow-ups and commercial preparation; the whole product is already a CRM |
| Home and CRM overview | Home / Sales overview | Personal cross-module actions versus sales performance; never the same composition under two titles |
| Design & Planning / Pre-projects | Requirements and Quotations within Sales; Design within the relevant project when applicable | Remove the technical lifecycle bucket; keep existing records, stage gates, URLs and drafts while remapping navigation |
| Cases | Use the actual object name: Enquiries, Deals or Projects | Resolve each route's data contract first; do not relabel all cases as projects or imply a deal is released work |
| Customers / Clients | Clients | One relationship directory and history; display an industry synonym only through controlled terminology configuration |
| Catalog hidden under Workspace settings | Resources → Catalog, Materials, Prices | Daily operational work belongs outside administration; service businesses see relevant resource views without inventory clutter |
| Integrations / Connected apps / Connections | Connections | One destination and consistent title for provider setup, health, accounts and recovery |
| Client portal link opening portal configuration | Settings → Client portal | Label configuration honestly; use “Preview client view” in a project for an actual client-view preview |
| HRMS | Team, in the optional app area | Keep member access settings separate from attendance, leave and other people operations; hide unavailable capabilities |
| Workspace + Workspace settings + Settings | Main destinations + one Settings utility | Remove repeated group headings; the workspace switcher establishes current workspace context |
| Opportunities, leads, BOQ and other specialist terms | Deals, Enquiries, and contextual industry terminology | Use plain defaults and short help where needed; preserve distinct business concepts rather than merging them for a cleaner label |

Use one navigation/terminology registry for labels, route resolution, permission visibility, breadcrumbs and search aliases. Backend identifiers need not change when display labels change. Preserve old deep links, browser back/forward, selected tabs and unsaved work; redirect only where record identity and context are preserved. Search should recognize old names during transition. Pin preferences are scoped to the user and workspace and rechecked against permissions.

No decorative sidebar dividers, accent rails or bordered section boxes. Selected destinations use a restrained background tone and readable text. Collapsed navigation retains accessible names; mobile navigation has clear open/close behavior and restores focus. Counts represent permitted actionable records, not every item in the database. No badge when the count is unknown.

## Onboarding: first impression and first useful outcome

**The current onboarding remains provisional and requires redesign.** Removing the welcome letter and adding a summary were intermediate changes, not acceptance of the layout. Avoid reproducing a long settings form with a step indicator. The first impression should be calm, recognizably branded and immediately understandable.

### Entry journeys

- **New owner:** create a workspace, choose useful defaults, and reach a first business action.
- **Invited member:** verify identity, accept the intended workspace/role, then see permitted work. Never ask them to configure the company again.
- **Returning user:** go to their active workspace or resume an unfinished required step. Optional setup must not repeatedly block work.
- **Multiple workspaces:** show names and identity clearly; keep account identity separate from company/workspace identity. An expired or inaccessible workspace does not look like an empty new account.
- **Client or supplier:** enter the scoped external experience, with no internal company-setup wizard.

### Owner setup sequence

1. **Your workspace.** Ask for the display name and country/region. Logo is optional. Explain that the name identifies the shared workspace. Request legal registration/tax details when issuing financial documents, unless a verified backend/legal requirement makes them necessary sooner. This deferral requires a compatible data contract and a later readiness check; never fill required legal fields with invented values.
2. **How you work.** Offer a small set of business templates with a plain preview of the enabled work: e.g. design and delivery, service projects, or sales-only. Palm uses the design/delivery configuration. Templates set defaults; they do not fork the product or prevent later adjustment. Technical module names, database terms and empty builders stay out of this step.
3. **Check your defaults.** Suggest currency, time zone and measurement system from the selected region, visibly editable. Do not infer identity or location silently. Show a concise example of dates and money instead of duplicating every field in a persistent summary. Defer advanced organization structure and optional preferences.
4. **Start your first task.** Offer one primary recommendation and a few relevant alternatives: capture an enquiry, import clients, or create a draft quotation from a template. Preserve the created record and continue in its real working view. Mark sample exploration clearly and keep it isolated from production data.

Team invitations and Connections become optional, resumable tasks after workspace creation or when a feature needs them. Connecting WhatsApp should return to Inbox; accounting setup should return to the originating billing task. Do not silently send invitations, messages or invoices while progressing setup. Skipping a connection must never imply it is connected. A setup task is complete only after the server confirms the relevant state.

### Visual and interaction contract

- One clear title, one short explanation and one primary action per step; labels describe the action, such as “Create workspace” or “Continue”.
- Compact, readable fields on a neutral canvas; soft input surfaces and whitespace, with no decorative borders, dense paragraphs, acronym labels, celebratory detours or oversized empty regions.
- Show progress only for the current required journey. Optional tasks are visibly optional, with “Do this later” and a predictable way to resume.
- Back preserves entered data. Errors appear beside the affected field with a concise summary when needed. Failed requests retain the draft; retries cannot create duplicate workspaces or invitations.
- Be precise about saving: “Saved” requires server acknowledgement; pending, failed and preview-only edits have distinct wording. Do not imply autosave if saving occurs only on Continue.
- Theme defaults work before a logo or accent is supplied. Branding is optional and previewable; tenant color never compromises legibility or changes status meaning.
- Keyboard order, focus after transitions, screen-reader step announcements, narrow mobile screens, long names, localization, RTL and reduced motion are acceptance requirements.

## Cross-module scenario checks

| Scenario | Required behavior |
| --- | --- |
| Owner, administrator, estimator/salesperson, factory/site staff, read-only member | Relevant destinations and permitted actions; no need to navigate administrative setup to perform assigned work |
| Palm design-and-delivery, design-only, supply-only, generic service business | Same shared records; only relevant terminology, requirements and operational views enabled |
| Empty workspace, imported workspace, existing active workspace | Useful first action, import review or continuation of real work; no fake activity or forced setup restart |
| Expired invitation, wrong signed-in account, missing membership, revoked access | Clear explanation and recovery; no account enumeration or accidental new-workspace creation |
| Slow request, offline state, expired session, failed save, repeated click/retry | Draft preservation, correct reauthentication/return context, idempotent writes and honest pending/error states |
| Workspace switching, multiple legal entities, changed permissions | Correct branding, currency context and allowed data; no leaking cached results or preferences between workspaces |
| Old link, bookmark, browser back, pinned view, narrow viewport | Correct destination/selection; no redirect loop, missing label or lost unsaved record |
| Optional connection skipped, authorization cancelled, expired credentials, provider outage | Core work remains usable; disconnected and unknown states remain distinct; direct recovery and return to originating task |
| Empty search, no matching results, inaccessible record | Clear next step without revealing forbidden titles/counts or disguising failure as zero results |

These checks are a maintained acceptance matrix, not a claim that all future cases are known. Add discovered edge cases to the owning module before marking it complete.

## Revised delivery gate

First deliver the navigation map and an interactive owner/invited-member onboarding journey with empty, loading, error and mobile states. Evaluate whether representative users can identify their next action and reach the correct work without explanation. Resolve naming or first-impression failures before propagating components to later modules. Then implement and verify the corresponding frontend/backend contracts, followed by Connections and the remaining build order.

For every module, record: user problem; Palm requirement; generic counterpart; reference interaction; old-to-new route/component mapping; business rules; backend/API/data changes; error and permission cases; validation evidence; obsolete code retired; remaining limitations. A visual refresh alone does not satisfy this gate.

## Implementation log

- Implemented a distinct Home with toned, labeled actions, configurable visibility/order/width, in-place follow-up editing, and direct catalog/material links. Removed the duplicated Home overview composition and its obsolete styles/imports. The Sales overview remains in use and is retained.
- Added authenticated member/workspace layout persistence, input validation, optimistic version conflicts, a same-origin web proxy, and migration `0112_member_home_layout`. Personal preferences never select another user from request data.
- Frontend and backend type checks pass. Focused tests cover editors, configuration, conflicts, permissions, catalog selection, DTO validation and actor scoping. Browser inspection used local fixture data; it confirmed the interface and truthful unavailable-preferences behavior.
- Migration SQL was validated with isolated temporary tables inside a rolled-back local PostgreSQL transaction, including stale-version rejection and member/workspace isolation. The real database migration has not been applied; authenticated end-to-end cross-device persistence remains a rollout check.
- Remaining modules in the build order are not claimed complete. Catalog entry selection is implemented; the full catalog/quotation redesign, provider acceptance and client portal journeys remain planned.

## Cleanup policy

Remove obsolete implementations as each replacement is verified. Preserve historical database migrations and code that still serves active routes. Existing uncommitted work spans both applications and services; it is not evidence that files are redundant. This slice removes superseded Home code rather than deleting still-used CRM, catalog or quotation modules.

### 21 September: revised module sequence and current changes

The user requested Account & workspace and Connections first. The table above supersedes the earlier order. The already-started Home and material-review slices are preserved, but they do not establish completion of modules 3–4.

- Removed Home's vertical accent stripe, decorative row dividers and outlined action styling.
- Material review identifies unresolved unit links, specification review and incomplete saved selling prices, and opens the relevant existing editor. Imported source values do not count as reviewed selling prices. This is a completeness aid, not quote approval or rate selection.
- Account onboarding now opens directly on the useful company form. Removed the welcome-letter interstitial and its animation/styles. A live workspace summary explains how company and regional defaults carry forward; persisted onboarding and invitation behavior remain authoritative.
- Connections is the next full module. Audit server-derived capability status, legal-entity ownership, setup steps, evidence of successful operations, and retry/reconnect before changing its presentation. Live external authorization is not claimed by a local preview.

- Connections now supports purpose filters (client communication, invoices/payments, calendar/files), neutral borderless provider regions, and an explicit unavailable state. Server failures no longer substitute fixture capabilities or zero connection counts; management is disabled until status reload succeeds. Existing authorization and operation verification remain separate. Provider authorization and live QuickBooks/WhatsApp operations are still acceptance work, not completed by this slice.

Validation for this slice: 39 focused tests passed across Home, catalog review, catalog navigation, onboarding, Connections UI and server failure handling. Web TypeScript validation passed. Browser inspection confirmed direct setup, progression to regional preferences, and purpose-filtered Connections. Local previews use fixture data; real provider authorization and end-to-end account persistence were not exercised.

### Latest feedback: navigation and onboarding

Sidebar naming/hierarchy and onboarding first impressions have been added as explicit redesign requirements. The current onboarding is not accepted as complete. This update changes the implementation plan only; it does not claim that the new setup sequence or navigation migration has been built. Earlier test results validate their stated slices, not the newly specified journeys.

The latest UI clarification is binding: no empty-looking pages, decorative borders or sharp bordered-card compositions. Reference-based visual inspection and a normal-user task walkthrough are now required per module.


### Seats, multilingual foundation and first-impression correction

Use Seats for allocated capacity and Invite people for the separate action. The seven initial interface languages are English, Urdu, Arabic, Hindi, Telugu, Malayalam and Tamil; Urdu/Arabic are RTL. UI language must not change financial defaults. All subsequent modules adopt the shared message/direction foundation and include translation coverage checks.

The user rejected the administrative onboarding sequence, not only its styling. Module 01 must open with business intent and a real CRM outcome; optional AI assistance needs a source-backed review/apply workflow. The current provisional four-step wizard is not the acceptance baseline. See the updated Module 01 specification for allocation rules, language scope and remaining work.

Latest clarification: the onboarding objection is about visual quality, not a request for AI or a different business workflow. No AI in onboarding. The large sidebar/summary and timeline-style stepper are removed in the current visual iteration. Seats and multilingual support remain required.


### Portal-wide design standard — latest user direction

UI and UX are the primary product improvement, across the complete staff and client portal. Use a recognizable Wodana identity with the existing configurable accent, geometric typography, quiet surfaces and consistent controls. Notion, Figma and Miro inform interaction quality; separate modules must not become unrelated visual experiments. No AI embellishments in onboarding.

Shared components govern typography, spacing, action hierarchy, fields, uploads, search, filters, tables, record drawers, dialogs and feedback. Use background tone and space for grouping; avoid decorative panel borders. Preserve visible keyboard focus and meaningful error states. Tenant branding must retain contrast and semantic status colors.

Each module must pass these task-based checks before completion:
- A first-time user can identify the page purpose and primary action without a walkthrough.
- Existing client, material, quotation and project data carries forward without re-entry; contextual actions preserve the originating record and view.
- Tables expose meaningful columns, readable values, filtering and selection; dense data stays usable on smaller screens.
- Forms ask only for information needed at that point, clearly separate optional fields and retain entered values after errors.
- Empty, loading, failed, permission-limited and saved states are truthful and actionable; previews never look like real completed work.
- Typography, component sizing, focus, RTL, translated labels and mobile layouts follow shared rules.

Delivery remains module by module: Account & workspace, Connections, Home/navigation, Clients & sales, Catalogs/materials, Quotations, Projects/procurement/factory, Client portal, then cross-module review. Before each module, document its flow, field/column definitions, business rules and backend contract. After each module, record functional and visual verification, with remaining gaps explicit.

Current implementation: the shared default web font is Plus Jakarta Sans (a reference-compatible choice, not an identified font from the screenshot), with script-specific fonts for the requested languages. Shared form sizing and surfaces are consistent. Onboarding uses a compact layout, live workspace identity preview and a working drag/drop or browse logo control. Current colors and tenant font override support are preserved. Main onboarding labels support seven languages; other modules and remaining error copy still require translation migration and native-language review.

Validation: 31 focused tests passed across shared components, data grid, onboarding and translation contracts; web TypeScript passed. Mobile English and Urdu were visually inspected at 390×844. This validates the current foundation and onboarding slice, not the full portal or live onboarding persistence.


### Compact component refinement

Latest feedback supersedes the illustrative onboarding preview: remove decorative CRM mockups and keep one 460px setup column with a minimal four-step indicator. Use matching 40px desktop inputs/selects/buttons, 44px mobile controls, 16px field gaps and 24px section gaps. Logo upload is a compact functional row. White input/select backgrounds replace grey fill in the shared form contract. Latest clarification removes resting outlines from these controls too; a subtle canvas tone separates fields, with visible keyboard focus and error feedback retained. Preserve primary and secondary brand colors. Imagery is optional and must serve a purpose; no illustration is needed in this setup flow.


### Final onboarding composition for this pass

Supersedes the badge-stepper and narrow stacked-form experiments above: a 560px document-style canvas, aligned label/value property rows on desktop and stacked labels on mobile. Progress is a small footer label; there is no decorative preview, timeline or step badge. White fields have no resting outline or grey fill. Focus remains visible. Lucide icons identify language, upload, navigation and provider categories. Standard desktop actions are 32px, with 44px mobile targets; primary and secondary brand colors remain unchanged.

Company, Preferences, Seats and Connections were visually reviewed. Onboarding and shared-component/translation checks: 19 tests passed. TypeScript passed. Urdu on a 390px mobile viewport was visually checked. Step changes focus the new heading. This is a local sample preview; live external authorization and real onboarding persistence are separate acceptance checks. Other modules still need their own flow and visual migration.

Reference reviewed: https://www.notion.com/help/intro-to-workspaces — separate navigation from the working canvas and keep controls subordinate to content. This is an interaction reference, not a claim of reproducing Notion's onboarding.


### Field-boundary correction after live reference inspection

The latest user request explicitly restores borders around editable controls. This supersedes earlier borderless-input instructions: use white fields, subtle 1px control boundaries, quieter 12px labels, darker 13px values, identical control edges and 6px corner radii. Passive page regions remain unboxed. The actual Notion login form was inspected in the browser at https://app.notion.com/login; its label/input hierarchy informed this correction. Do not confuse borderless page composition with removing form affordances.


### Notion form reference — final hierarchy correction

Following direct inspection of Notion's live login screen and the user's renewed direction: center the entire setup composition within the viewport, use a 400px form, labels above fields, subtle control borders on white, and compact consistent actions. This supersedes the side-by-side property-row experiment. The simpler hierarchy clearly separates labels and values. Keep branding in the topbar, no decorative cards or mockups, and truthful preview wording below the form. Primary/secondary colors stay unchanged.


### Cohesive form composition and field iconography

The setup logo and heading now belong to the centered form composition. The main action spans the form width with centered text; Back and progress sit below it, and Back is omitted on the first step. Stronger headings, medium-weight muted labels and darker 14px values distinguish text roles. Decorative Lucide prefix icons were added to company, regional and people fields through the existing text-input prefix API and new optional select/combobox prefixes. Icons do not change accessible field names. Primary/secondary brand colors remain unchanged.


### Current onboarding visual baseline (supersedes earlier experiments)

Soft brand-tinted canvas; centered 400px form and logo; no visible long title or subtitle. A compact navigation row has a toned Back action (omitted at step one) and a centered, emphasized step count. Accessible headings remain for screen readers and transition focus. White bordered fields use consistent 16px brand icons with no internal dividers. The full-width main action has centered content. This shared composition applies to all four steps. Preview-only notice remains truthful and is not shown in real onboarding. Earlier badge steppers, property-row layouts, tinted heading panels and field dividers are superseded.


### Seats and invitations — latest scope

Only available seats and pending invitations are shown in a compact summary. Invite by email, with a role selector populated from workspace roles (owner excluded). Default to member/viewer when available; do not default to an administrative role. Existing pending invitations and their roles are loaded from the members service. Invitations remain optional: show Skip for now when the list is empty, Continue after an invitation, using the same primary style as other steps. The web invitation proxy now permits omitted displayName, matching the existing backend DTO and service; supplied invalid names remain rejected. No authentication, role checks or capacity checks were bypassed. The language globe is inside its selector. Country/currency SVG flags use flag-icons.

Validation: 19 tests cover onboarding, email-only invitation forwarding, selected role payloads and translation key parity. Real invitations were not sent during visual checks.

### Onboarding connections and welcome refinement
- Keep provider setup within onboarding by reusing the existing connection dialogs and authorization handlers. Compact rows show provider logo, name, connection status and one action. OAuth returns initiated here route back to onboarding; finishing clears that return preference.
- Finish or skip leads to the Wodana welcome envelope, with a top-left Back action. Use canvas-confetti for a finite celebration falling from the top; respect reduced motion and clean up when leaving.
- Persist sample onboarding step, form, invitations and completion in session storage so refresh retains progress. Production remains backed by existing onboarding APIs.
- Verified local preview navigation, refresh retention, compact Connections rendering and welcome animation. Provider authorization still requires live credentials and consent; preview fixture status is not evidence of a live connection.
