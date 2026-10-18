# Module 01 — Account and workspace onboarding

Status: implementation specification, 21 September 2026. Not a claim of implemented behavior. This document implements the priorities in `product-implementation-plan-2026-09-21.md`. The current onboarding UI is provisional and will be replaced against this specification.

## 1. Outcome and scope

A new owner understands the workspace, confirms useful defaults and reaches a real first task. An invited member reaches assigned work without repeating company setup. A returning user resumes the right workspace. None of these journeys requires understanding the application's architecture.

Include sign-in, existing invitation activation/acceptance, recovery and MFA states, workspace choice, required owner setup, role-aware first-task selection, resume behavior and navigation naming. Reuse the authentication system; do not rebuild credential storage or weaken security policies.

The reviewed backend uses tenant-scoped sign-in and first-owner invitation activation. Start with provisioned workspaces and existing authorized organization-creation flows. Do not introduce a public “Create account” button that has no supported provisioning contract. Self-service purchasing/provisioning is a separate product decision.

Connections are the next module. This module supplies a resumable entry and return context; it does not automatically connect providers, send invitations or create business records.

## 2. Experience and visual composition

Use Notion's direct entry into useful work and restrained navigation, Figma's contextual controls, and the supplied FlowPilot reference's compact hierarchy. Miro's spatial canvas does not belong in account setup; reserve it for visual discovery later. Reference quality must be checked on rendered screens, not inferred from these names.

Desktop: a quiet workspace identity and short progress rail beside one focused form. No boxed step cards, decorative lines, oversized greetings or permanent duplicate summary. Show a small contextual example only where useful, such as the selected currency/date formatting. Mobile: one column, concise progress text, reachable primary action, no clipped fields or hidden errors. Use soft surfaces, tenant tokens, readable labels and visible keyboard focus. No required logo, welcome animation or technical terminology.

Each step has one title, one short explanation, one primary action and a predictable Back action. “Saved” appears only after server acknowledgement. Optional actions say “Do this later.” Form values survive failed requests and backward navigation; no silent changes after a user has edited a suggested default.

## 3. End-to-end journey

| Entry | Decision and destination |
| --- | --- |
| First owner activation | Validate the existing invitation, finish credential activation/MFA policy, load membership, enter owner setup |
| Invited member | Show intended workspace and role, verify eligible identity, accept once, enter permitted work; no company wizard |
| Ordinary sign-in | Existing tenant credential and MFA flow; resolve authorized memberships before showing workspace data |
| One accessible workspace | Resume required setup for an authorized owner/admin, otherwise open permitted work |
| Multiple accessible workspaces | Choose by name/logo; retain last valid selection; never assume the first array entry is the intended workspace |
| No accessible membership | Explain access state and offer sign-in/account recovery or the existing authorized provisioning path; no fake empty workspace |
| Client/supplier | Preserve external audience and destination; never send them into internal owner setup |
| Expired invite, session or revoked membership | Explain recovery without leaking tenant data; preserve only safe return context |

Owner setup has three required steps followed by an optional first-task chooser:

1. **Your workspace:** display name and region; optional logo. Show existing provisioned values for confirmation. Save only fields the actor may change. The CTA is “Continue”, not “Create workspace”, when the workspace already exists.
2. **How you work:** select a supported starter workflow with a short plain-language preview. Initial supported proposals are Design & delivery, Service projects, and Sales only. Show only packs backed by implemented templates and enabled entitlements; never present planned capabilities as available. Palm uses Design & delivery, with later project choices supporting design-only and supply-only engagements.
3. **Your defaults:** confirm currency, time zone and measurement system; language/number format and week start under “More preferences”. Region suggests defaults only before the user edits them. Show a formatted money/date example. Existing legal-entity currency is not overwritten because a workspace default changed.
4. **Start work:** a role/pack-appropriate primary action, with alternatives such as Capture an enquiry, Import clients, or Start a quotation. Open the actual editor/import flow with workspace context. Merely selecting this action does not create a record or count as a completed business outcome. “Go to Home” remains available.

Optional team invitations, branding refinement and Connections live in a dismissible setup list after required setup. Invitation sent, invitation accepted and membership active are separate facts. QuickBooks authorization is distinct from a verified accounting operation. No checkbox can establish either.

## 4. Visible fields and validation

| Field | Required here | Control/default | Validation and destination |
| --- | --- | --- | --- |
| Workspace name | Yes | Text; provisioned name | Trim; 2–160 characters as proposed UX rule; align existing DTO before release; save `workspaces.name` |
| Country/region | Yes | Searchable country selector; provisioned region if unambiguous | Supported ISO country code; onboarding region preference; does not silently move a legal entity |
| Logo | No | Upload with preview and remove | Reuse current validated upload/activation API; preserve file constraints; failure does not block basic setup |
| Starter workflow | Yes | Accessible single-choice list with short outcome preview | Allowlisted pack ID/version, current entitlement and compatible template manifest |
| Currency | Yes | Searchable supported currencies; editable suggestion | Valid supported currency; persist workspace default; posted documents retain their currency |
| Time zone | Yes | Searchable IANA zone; editable suggestion | Server allowlist/validation; region with multiple zones requires an explicit choice |
| Measurement system | Yes | Metric / Imperial | Existing enum; pack-specific units remain typed catalog records |
| Language/number format | Default confirmed; expandable | Supported locale | Supported locale; no arbitrary formatting string |
| Week starts on | Default confirmed; expandable | Named weekday | Existing 0–6 representation; localized label |
| First task | Optional | Labeled action choices | Role and pack capability check; internal allowlisted destination |
| Registered name, registration/tax IDs and address | Not new onboarding inputs by default | Preserve provisioned legal records | Do not replace with workspace name, fabricated IDs or blanks; request missing business data at the relevant document/accounting gate |

Current `legal_entities.registered_name` is NOT NULL, and current setup assumes an active legal entity. This release preserves valid provisioned entities rather than making this column nullable across the product. If provisioning cannot supply a valid entity, show a specific recovery state; legal-entity deferral requires its own dependency audit before supporting entity-less creation. Drafting and issuing documents must have distinct readiness rules.

## 5. Data model and ownership

Existing database columns below were checked in `services/business-core/src/database/schema.ts`. New columns/tables are proposals, not current schema.

### Existing authoritative records to reuse

| Table | Relevant columns | Ownership/rule |
| --- | --- | --- |
| `workspaces` | `id`, `name`, `slug`, `status`, `default_currency`, `default_locale`, `default_timezone`, `unit_system`, `week_starts_on`, `version`, audit timestamps | Workspace defaults; immutable identity and controlled slug; optimistic version checks |
| `workspace_onboarding` | `workspace_id` PK/FK, `status`, `current_step`, `completed_steps` JSONB, `version`, `started_at`, `completed_at`, audit timestamps | Workspace-wide required setup, not per-user activity; derive completed markers on server |
| `legal_entities` | `id`, `workspace_id`, `code`, `display_name`, `registered_name`, `country_code`, `base_currency`, `locale`, `timezone`, registration/tax fields, `address`, `status`, `version` | Independent financial identity; do not overwrite every entity from workspace defaults |
| `workspace_memberships` and role assignments | Existing membership identity, workspace/user association, status and authorization relationships | Source of permission decisions; request body cannot choose actor/role |
| Existing branding and asset records | Existing logo identity, activation and tenant branding fields | Reuse upload lifecycle; no duplicate image storage in onboarding JSON |
| Existing invitations and audit records | Existing identity, expiry/status/version and event records | Reuse acceptance, resend and audit contracts; tokens never logged or stored in setup drafts |

### Proposed additions to `workspace_onboarding`

| Column | Type/default | Purpose |
| --- | --- | --- |
| `flow_version` | smallint NOT NULL, existing rows 1; new upgraded flow 2 | Version the journey and migrate safely |
| `region_code` | char(2), nullable until profile step confirmed | Region used for suggestions; not a new legal jurisdiction field |
| `workflow_pack_id` | varchar(64), nullable until selected | Stable allowlisted starter choice |
| `workflow_pack_version` | integer, nullable until selected | Exact manifest applied; positive when present |
| `first_action_key` | varchar(64), nullable | Optional resumable entry choice; never proof the task was completed |

Use existing `version` for setup concurrency rather than adding competing counters. Add checks for field pairs, positive pack version and known steps. The server validates pack IDs against a versioned registry; JSON does not grant capabilities. Add `workflow` to the step constraint while keeping old `workspace_profile`, `organization`, `team`, `integrations`, `complete` values during transition.

A starter manifest references existing template/configuration mechanisms, supplies a stable version and explains the changes it will make. Apply only compatible defaults to a new workspace. Existing customized workspaces require an explicit change preview; never reseed or overwrite operational records when resuming setup.

### Proposed retry receipts

Use an existing equivalent idempotency facility if one supports this exact actor/workspace operation. Otherwise add `workspace_setup_requests`:

| Column | Type/constraint | Purpose |
| --- | --- | --- |
| `workspace_id` | UUID FK, composite PK | Tenant scope |
| `request_id` | UUID, composite PK | Client-generated key reused on retry |
| `actor_user_id` | UUID FK | Bind replay to authorized actor |
| `operation` | varchar(64) | Step/save/complete operation |
| `request_hash` | text | Reject the same key with different content |
| `result` | JSONB | Minimal receipt: resulting versions, state and next action; no credentials or invitation tokens |
| `created_at` | timestamptz | Retention/audit linkage |

Enforce workspace access/RLS consistently with neighboring tables. Save receipt in the same transaction as the mutation. A timeout can be retried with the same key; concurrent calls serialize. Replay returns the original receipt; the client refetches current setup state if later changes occurred. Define receipt retention before cleanup; optimistic versions prevent a pruned old request from blindly reapplying defaults.

Do not add a generic arbitrary onboarding-data JSON store. Business fields stay in their authoritative records. Optional task completion is derived from actual records; if personal dismissal is needed, keep that preference separate from workspace readiness.

## 6. API and save contracts

Existing backend contracts: GET/PATCH `/workspaces/:workspaceId/onboarding`, POST `/workspaces/:workspaceId/onboarding/complete`; web proxy `/api/onboarding`. Keep compatibility for old clients during migration.

Proposed V2 contracts:

| Endpoint | Input/output | Responsibility |
| --- | --- | --- |
| GET `/workspaces/:id/setup` | Actor-scoped values, versions, flow version, allowed packs, required/missing steps and optional next actions | One consistent snapshot; no fixture fallback on failure |
| PUT `/workspaces/:id/setup/steps/:step` | `requestId`, expected setup/workspace versions, typed step fields | Validate and atomically persist business fields, applied pack defaults and step state |
| POST `/workspaces/:id/setup/complete` | `requestId`, expected versions | Recheck persisted required values and pack application; mark complete and return allowed first actions |
| Web proxy `/api/workspace/setup/...` | Same allowlisted contract with workspace routing | Same-origin checks, authenticated upstream, safe error/status propagation; no body-supplied identity |

Example defaults save:

```json
{
  "requestId": "<uuid>",
  "expectedSetupVersion": 3,
  "expectedWorkspaceVersion": 7,
  "fields": {
    "defaultCurrency": "AED",
    "defaultTimezone": "Asia/Dubai",
    "unitSystem": "metric",
    "defaultLocale": "en-AE",
    "weekStartsOn": 1
  }
}
```

Transaction order: authenticate and authorize → check/replay idempotency receipt → lock setup and affected workspace/configuration rows in consistent order → compare versions → validate fields and permitted manifest → write authoritative data → derive progress → append audit event and receipt → commit → return saved values and next step. Any failure rolls back the whole step. No separate “data saved but progress failed” writes.

Completion currently checks required step markers. V2 must also validate persisted values and successful pack application; client-supplied `completedSteps` is not sufficient. Keep completion idempotent. Return field errors for 422, reload/compare guidance for 409, appropriate sign-in/access handling for 401/403, and a retryable unavailable state for service errors.

## 7. Frontend composition and navigation

Build a small setup shell, step progress, typed field groups, contextual example, save/error feedback and first-task chooser using existing accessible primitives. Keep business logic in typed validators/services; do not duplicate it across cards and forms. Preserve dirty values on conflict and present the changed saved values before retrying. Browser refresh restores the last acknowledged step; unsaved edits receive a leave warning, not a false persistence promise.

Centralize navigation names and destinations before changing labels throughout the UI:

- Main destinations: Home, Inbox, Sales, Clients, Projects, Resources.
- Utilities: Connections, Settings; optional Team app separately from membership administration.
- Sales contains Enquiries, Deals, Requirements and Quotations; no generic “Cases” label without checking the underlying record type.
- Resources contains Catalog, Materials and Prices. Portal configuration stays under Settings; a real client-view preview stays contextual to a project.
- Reuse old routes as compatibility entry points; do not rename backend identifiers simply to change visible text.

This module delivers the naming registry and coherent setup exit/deep-link behavior. Full navigation migration is a separate tested slice before propagating the pattern through business modules. New labels must not expose modules that membership permissions do not allow.

## 8. Permission and failure matrix

| Case | Expected result |
| --- | --- |
| Owner/admin with setup-edit permission | Can confirm required setup; versioned mutations audited |
| Invited/ordinary/read-only member | Can accept eligible invitation and see allowed work; cannot change company defaults |
| Member arrives while owner setup is unfinished | Clear workspace readiness state; permitted work if safe, otherwise owner-needed state, never owner form |
| Two admins save concurrently | One consistent commit; the other sees a conflict and retains edits |
| Duplicate submit or timeout after commit | Same receipt; no duplicate templates/workspaces/tasks |
| Pack unavailable or entitlement changes | Explain unavailable choice and offer compatible choices; no silent escalation |
| Wrong account, expired invitation or revoked membership | Safe recovery; no acceptance for another identity |
| Multiple legal entities | Explicit financial entity selection later; no first-array-item financial writes |
| Network/session failure | Preserve unsaved fields; return safely after reauthentication |
| User switches workspace mid-request | Responses remain bound to originating workspace; no state leakage |
| No logo, long names, RTL, keyboard or mobile | Usable identity and form; no overflow or inaccessible primary action |
| Existing completed setup | No forced onboarding reset, template duplication or changed financial settings |

## 9. Implementation sequence and retirement

1. Lock terminology/route map and inventory current auth/setup entry conditions. Produce reference-based desktop/mobile layouts plus invited-member and error states.
2. Add typed setup schema, migration, server pack registry and transactional V2 service. Validate with isolated database tests.
3. Add authenticated web proxy and setup-state loading. Keep server redirects and authorization errors intact.
4. Replace the provisional onboarding surface with the required three-step flow and optional first-task chooser. Retain account activation/recovery/MFA behavior.
5. Route invited members, returning users and multiple-workspace users correctly. Connect the first action to existing real editors.
6. Migrate old in-progress markers: preserve valid profile/defaults, request only missing confirmations, do not convert skipped Connections into connected status. Grandfather completed workspaces; allow optional pack selection without re-onboarding.
7. Validate and release behind a server-controlled flow version/rollout setting. Monitor failures; disable V2 routing on rollback without deleting saved data. V1 clients cannot mutate V2 progress; handle them with upgrade/reload guidance.
8. Remove obsolete onboarding branches, duplicate labels, unused styles and old completion inputs only after compatibility and rollout checks pass. Preserve migration history and unrelated work.

## 10. Evidence required before completion

- Unit/API tests: field validation, region suggestion rules, permission checks, step readiness, same-origin proxy, consistent response/error shape and safe return destinations.
- Database integration tests: atomic rollback, stale versions, retry replay, pack application once, actor/workspace isolation and old-state migration.
- Browser tasks: owner activation through first real task; invited-member acceptance; returning user; multiple workspaces; interrupted/retried step; restricted user; keyboard/mobile/RTL where supported.
- Visual review: compare the actual desktop/mobile screens with selected references; no decorative lines, excessive empty space, unexplained terms or confusing card collections.
- Palm fixture: AED, Asia/Dubai, metric and Design & delivery, leading to enquiry capture. Generic fixture: service work without inventory/factory prompts. Neither fixture invents prices or legal identities.
- User acceptance target: representative users can explain the current step and complete setup/first-task entry unaided. Measure drop-off, failed saves and first-task completion separately; do not mark success because the chooser was clicked.

Done means a persisted, permission-correct journey with understandable screens and a valid next action. Tests alone do not approve visual quality. Provider connections and the later business modules are not included in this module's completion claim.


## Latest steering — seats, languages and purpose-led onboarding

The user rejected the administrative four-section wizard as the product's first impression. The first experience must establish the customer's work and show a useful CRM outcome. Company details, financial defaults, seats and connection administration should support that journey rather than define its opening. Do not claim that an AI-looking panel is an AI integration: extraction requires an implemented service, source evidence, review and explicit apply. The exact opening interaction is being clarified with the user before another broad visual rewrite.

### Seats

Use **Seats** for licensed capacity supplied by the platform and **Invite people** for the action. Customers choose who to invite; they do not set their own allocation. Show Allocated, Available and Pending invitations as distinct quantities. Reuse authoritative allocation and usage records. Current policy reserves capacity for active/invited memberships and unexpired pending invitations; changing that policy requires coordinated backend/database work, not a label change. A full allocation must explain why invitation is unavailable and must not block skipping optional team setup. Expired/cancelled invitations and suspended members follow existing capacity rules. Pending does not mean accepted or delivered.

### Languages and direction

Initial interface languages: English (`en`), Urdu (`ur`), Arabic (`ar`), Hindi (`hi`), Telugu (`te`), Malayalam (`ml`), Tamil (`ta`). Urdu and Arabic use RTL; the other five use LTR. Keep interface language separate from number/date locale, currency, measurement system and timezone. Do not translate customer records, product identifiers or legal names.

A shared typed message dictionary and language registry are now present. Onboarding remembers its language through a validated browser preference cookie, and the server restores it on entry. This is a browser preference, not yet a cross-device account preference. Existing `default_locale` remains the company's formatting default. Future server-synchronized personal preference should use a validated language code, not an independent direction field; derive direction from the language to avoid inconsistent combinations.

All new modules must use stable message keys, placeholder checks and localized plural/date/number formatting. Use logical CSS properties, mirrored directional arrows, isolated LTR emails/identifiers, and script-capable fonts. Include long translated strings, mobile, keyboard, focus, error messages and popover direction in review. Do not mirror logos, media or numerical data arbitrarily.

Current implementation coverage is onboarding's primary controls, explanations and step labels plus shared provider direction handling. Remaining hardcoded status/error/help strings and other modules must be migrated before claiming full multilingual product support. Translations require native-speaker review and font coverage checks before release. The provisional layout and old four-step business sequence are not accepted as the final purpose-led onboarding.


### Final clarification in this iteration

The user clarified that the objection concerns the UI's visual feel, especially the timeline/stepper and formal settings composition. Do not treat the preceding interpretation as approval to invent a new business-intent or AI workflow. **No AI is needed in onboarding.** Remove AI copy, sparkle treatments and simulated assistance. Keep a polished CRM presentation, compact setup fields, clear seat allocation, the language selector and an explicitly labeled workspace preview. The large administrative sidebar, repeated summary and timeline-style stepper have been retired in the current visual iteration. This remains subject to visual acceptance; it does not claim implementation of the V2 transactional service described above.
