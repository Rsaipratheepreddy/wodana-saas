# P00.4 — main-portal design contract and flow sketches

**17 September 2026. Specification, not a claim that every screen has been migrated.** The reusable component inventory was published before feature UI work in [WODANA_COMPONENT_INVENTORY.md](WODANA_COMPONENT_INVENTORY.md). This document applies it to the tenant web and native action flows. Backend source and release truth remain in [the blueprint](WODANA_PRODUCT_BLUEPRINT.md) and [P00.1 capability matrix](WODANA_MAIN_PORTAL_BASELINE.md).

## One visual system

- **Product character:** calm, text-first, precise. Keep the current cool-neutral/indigo family unless a centrally configured tenant accent is applied. The tenant can upload its approved logo where allowed but cannot freely edit product action colours; Wodana's configuration owns the brand ramp. Use one accent for primary action, focus, selection and links. Semantic red/amber/green/info show status only. The Wodana logo may retain its small gradient mark; application controls and large surfaces do not use decorative gradients.
- **Typography:** Inter for normal UI, JetBrains Mono only for scanned IDs/codes/numbers; Noto Sans Arabic is a locale-specific glyph fallback, not a second everyday UI voice. Current loading is via [next/font](../apps/web/app/fonts.ts) and [global feature settings](../apps/web/app/globals.css). Base 14px, 13px compact rows, 12px supporting labels, 20–24px page headings, regular 400/medium 500/semibold 600. Tabular numerals for table quantities, prices and timestamps. Prefer sentence case and a single short explanatory line. Never stack marketing subtitles or use all-caps section banners. Do not introduce arbitrary feature font sizes or a third family.
- **Spacing:** use the [shared four-pixel scale](../apps/web/styles/tokens.css) (`4, 8, 12, 16, 20, 24, 32, 40, 48` px) and content relationships instead of nested cards. Page header to first action/list: 24px; related control gaps 8–12px; field label to control 6px; fields 16–24px; unrelated sections 32–48px. On a narrow screen, reduce horizontal padding to 16px, not label size or tap target. Align page title, toolbar, table header and content to one start edge.
- **Shape and depth:** quiet 6–12px radii from tokens. A surface groups only when whitespace is insufficient. No nested bordered card stack or passive shadows. Transient menus/dialogs/sheets may have elevation. Keep one visibly primary button in the current view, 32–40px on desktop and at least 44px hit area on touch. Primary uses a **solid** `--wd-color-action-primary`; despite its legacy name, `--wd-brand-gradient` currently aliases that solid token. Secondary is transparent with a hairline border, quiet actions are text/tint.
- **Tables:** the user explicitly requested a complete subtle **outer/end border**. Preserve the one-pixel frame in [record-tables.css](../apps/web/design-system/styles/record-tables.css) for `DataGrid`/`GroupedTable`, with no second bottom rule under the final row. Keep 40px header, 40–44px rows, hairline horizontal separators, no vertical grid, no stripes or card around the framed grid. The frame is an explicit exception to the more general no-passive-box guideline in `apps/web/AGENTS.md`. Numeric columns align to the end and use tabular numerals. Names ellipsize with an accessible full-name affordance. A row click and the explicit row action must not compete.
- **Modes and access:** derive light/dark/high-contrast from [semantic tokens](../apps/web/styles/tokens.css), never from hard-coded feature colours. Maintain 4.5:1 normal text and 3:1 control boundaries/icons against the actual surface, and visible focus/keyboard/RTL/reduced-motion states. Native colours, type sizes and spacing are generated from the web token source through [mobile token sync](../apps/mobile/scripts/sync-design.mjs); native screen layout is intentionally different, not a scaled web page.

## Component and interaction mapping

The canonical import is `@/design-system`. [The inventory](WODANA_COMPONENT_INVENTORY.md#components-needed-for-the-internal-portal) lists Button, Input, Select, Checkbox, Switch, Badge, card/surface, modal, sheet/drawer, menu, tabs, tooltip, toast, avatar, skeleton, empty/error state, shell and table with source props/variants and usage sites. Its table section documents TanStack `DataGridColumn<T>`, sorting/filter/search, pagination, selection/bulk action, row inspection, loading/error/empty, virtualization and export. Its form section records an important limitation: the shared `Form` is a React form/chrome wrapper, **not** a schema-driven react-hook-form adapter. Feature validation must be a typed domain/schema concern and feed shared field errors/`ValidationSummary`; do not invent a parallel stateful form component in a feature folder.

| User need | Compose existing pieces | Content/behavior rule |
| --- | --- | --- |
| Page shell | `AppShell` or existing workspace shell, `Container`, `Heading`, `Text`, `Breadcrumbs` | Title, at most one helper line, one primary action, then content. No page-sized bordered card or duplicate title. A shared `PageHeader` does **not** exist yet; add it in the library only if P01.3 reveals repeated markup. |
| Record list | `DataGrid` + `DataGridColumn<T>`, shared `Badge`, `IconMenuButton`, `EmptyState`/`Skeleton` | Search and filters describe the records; no fake counts. URL-persist view state where useful; `manualPagination` for server-backed large lists. Keep the complete outer frame. |
| Edit/create | `Form`, `FieldStack`, `TextInput`, `SelectField`, `Checkbox`, `ValidationSummary`, `Button` | One clear save path; inline validation; no separate modal for each field. Use sheet for short contextual editing, full page for multi-step Job/quote work. |
| Review/decision | `Surface` only when grouping is needed, `Badge`, `Callout`, `Button`, `ConfirmationDialog` only for irreversible decisions | Show exact revision, changed fields, evidence and effect. Reviewer's decision is an explicit command; never infer approval from navigation. |
| Feedback | `ToastProvider`/`useToast`, `ErrorState`, shared focus/disabled states | Success says what changed; error names the affected record and next step. No generic “Internal server error” as the sole user-facing outcome. |

The current feature-code raw-element scan is **not clean**: excluding the older `components/ui` kit, there are 19 raw `<table>`, 226 `<button>`, 135 `<input>` and 23 `<select>` occurrences under `apps/web/components` and `apps/web/app/workspace` (`rg -o '<(table|button|input|select|dialog)([[:space:]>])' ...`). This is migration debt, not a P00.4 completion claim. P01–P08 must remove raw elements in each touched feature and use the shared kit; the global empty-grep requirement cannot honestly be checked today. The same scan found no raw `<dialog>` outside the older kit. No forked `Button2`/`NewTable`/`CustomCard` should be added.

## Flow sketches before feature construction

### Today → accountable work

```text
Today                        [Add enquiry]
Needs action (count from API)
┌──────────────────────────────────────────────────────────────────────┐
│ Action / customer       Job       Owner       Due       State       │
│ Call new enquiry        PL-104    Sales       10:20     At risk     │
│ Review quote revision   PL-098    Owner       Today     Waiting     │
└──────────────────────────────────────────────────────────────────────┘
Open row → exact Job, source record, reason, primary next action.
```

Use a shared DataGrid because this is a list with ownership, sorting and filters. Avoid KPI tiles that do not change a decision. Empty state: “No work needs your attention” and one route to Jobs, not a celebratory illustration. A stale/denied source link explains access or version state; it never quietly disappears.

### Jobs → one contextual workspace

```text
Jobs [search/filter] [New job]
DataGrid: reference | customer | phase | owner | promise | risk | next action

PL-104 · Kitchen renovation       Customer: Acme       [Edit details]
Phase: Discovery · Owner: Cece · Due: Fri · At risk
Next action: Confirm site measurements               [Open action]
Overview | Discovery | Design | Scope | Quote | Agreement | Delivery | Handover | Money | Files | Timeline
Current step shows source-owned facts and exact revision; unavailable steps explain why.
```

The [Job contract](WODANA_JOB_ONE_TREE_MODEL.md) is a projection over existing Customer→Enquiry/Opportunity→Case→Quote→Project records, not a copied mutable status store. Module switches and legacy deep links must still resolve to the same Job context. Navigation is textual by default; use Lucide icons only where they improve scanning, never on every tab. Do not expose an empty section as a functional destination.

### Enquiry → qualification → Job

```text
Shared link/QR → captured answers and consent → queue/eligible owner
  → immediate in-app alert (provider delivery separately labeled)
  → call, note or follow-up → 60-minute no-action takeover if applicable
  → qualify / duplicate / lost → Opportunity → Job/Discovery
```

The enquiry view places provenance, response clock, accountable owner and one primary “Log response” action above secondary fields. A logged note stops takeover only under the agreed rule; it does not pretend the customer received a reply. Weekend notification and office-hour SLA are separate facts. Mobile Today opens directly to the permitted response action, with no admin setup screens.

### Room-first quote and exact review

```text
Job / Quote
Room → included scope items → catalogue/assembly or justified manual line
  → price/cost provenance and coverage warnings → options/exclusions/tax
  → totals → submit revision → independent review → client issue/accept
```

The builder keeps rooms/items in one editor rather than a modal per line. A compact summary shows unpriced/uncovered scope and exact current revision. Review shows a structural diff and explicit “Approve” or “Return” with reason; only the accepted immutable version feeds Agreement/Deal File/project. The [gate reconciliation](WODANA_GATE_RECONCILIATION.md) controls which warnings may be overridden; the UI must not offer an exception before sign-off.

### Released project → handover

```text
Accepted quote/contract + H1/H2 release → packages/tasks/supplier/factory/site
  → H3 receipt before manufacturing-ready/start when applicable
  → progress/evidence/quality → revision-bound handover packet
  → verified client acceptance → H4 Complete → aftercare
```

The project overview leads with owner, promised date, risk, next action and blocked evidence. The plan is a connected list/timeline, not separate unexplained tabs. The field app offers the assigned receipt/task/photo/daily-report action and offline draft status; it never approves a payment or silently merges a reviewed decision. Handover presents exact included scope, outstanding commitments and client-verification state before Complete.

## Acceptance checks for each screen and design debt

Review desktop and 390px mobile in light, dark and high-contrast; keyboard/RTL/reduced motion; long customer names, zero/large rows, permission denial and stale version; primary/secondary button contrast and consistent alignment; real loading/empty/error/validation states. For a server-backed screen, run the same synthetic actor end-to-end and compare list count/details with the API. Contrast calculations and screenshots are **not yet attached to P00.4**; they belong to implementation slice acceptance rather than this spec. The shared table frame exists, but feature-local tables/raw controls and some hard-coded styles remain design debt.

**P00.4 boundary:** inventory and UX composition contract only. No feature UI was changed in this task, and no claim is made that every current page obeys it. P01.3/P02–P08 must implement and visually verify these patterns one slice at a time.
