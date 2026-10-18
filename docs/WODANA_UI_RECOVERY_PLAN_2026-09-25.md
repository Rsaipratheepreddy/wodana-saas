# Wodana UI recovery plan — 25 September 2026

## Decision and boundary

Stop broad module development. Keep Daniel/client comments as requirements to classify and verify, not as permission to add more screens or gates. This plan changes no production behavior and does not declare any existing page complete. Work in this order: **one component language → explicit business contracts → one verified screen at a time**. Do not deploy a visual-only rewrite over unresolved source-of-truth or permission behavior.

## Visual direction confirmed by the product owner

Keep the current tenant theme, varied icon colours and status palette. Do not turn the SaaS uniformly green. Standardize button dimensions and spacing in shared tokens. The default review specimen is a compact, crisp, centered table with a maximum width, subtle complete cell boundaries, and one integrated toolbar/footer, based on the supplied Figma screenshot; embedded tables can remain flush. Reserve a restrained frosted treatment for transient menus and dialogs, not data cells. Colour roles live in tokens with tenant override seams. Optional haptics are progressive enhancement only, never the sole feedback channel.

## What the current evidence shows

- The canonical `@/design-system` already has foundations, actions, forms, navigation, data grid, overlays, documents and workflow patterns. `/design-system` renders a specimen catalogue. `apps/web/components/ui` is a second, older kit. Consolidate and harden the canonical kit; do not build a third one. The catalogue's “Release candidate” and “System ready” labels are not evidence that feature pages work.
- The presentational pieces are not consistently composed. The commercial and project feature trees still contain many raw controls and feature-local styles; the screens shown here visibly repeat navigation, search/filter toolbars, status labels and warning blocks. A primitive `ApprovalRow` has approve/reject buttons, while `DocumentViewer` has a preview, but neither composes the evidence, exact revision, authority, consequences, history and decision into a usable approval workspace.
- **Design quote screenshot:** three levels of header/navigation plus a second “DESIGN QUOTE” title precede the actual work. An editable room table mixes catalogue provenance, internal costing, price warnings and line controls without a clear primary task or predictable next step.
- **Project screenshot:** module tabs, sub-tabs and an additional segmented view compete. A full-width legacy release warning sits above action cards and a table. The page does not answer “what can I do next?” in one glance.
- **Supply screenshot:** project-flow banner and release warning repeat above two sets of filters. Selection checkboxes have no obvious consequence; “Add requirement” does not explain whether the requirement comes from approved BOQ, a task or stock. The status and action of each material need a clear owner and destination.
- Existing documentation conflicts with implementation: the design-system README still describes green/aqua and Inter, while current tokens permit tenant-configured green and default to Jakarta. The 17 September component inventory and portal UX spec describe a different approved colour direction and some pre-existing component gaps that have since been filled. Resolve this in one current contract before changing styles.

## Reference research, used as interaction evidence only

- [Document Approval Flow](https://dribbble.com/shots/24355993-Document-Approval-Flow): large document preview next to a focused decision area and visible history. Use this *relationship*, not its colours or chrome.
- [Modern Data Table Variants](https://dribbble.com/shots/27574900-Modern-Data-Table-Variants-for-SaaS-Dashboard-UI): different table densities and clear hierarchy. A table is for scanning records, not a substitute for a decision workspace.
- [Procurement Analytics Dashboard](https://dribbble.com/shots/26896425-Procurement-Analytics-Dashboard-UI-Design): summary before detailed data. Adapt only the hierarchy; Wodana supply should lead with shortages, ownership and next action rather than decorative analytics.
- Pinterest's public table-design pin opened a login wall in the available browser session, so it was **not** treated as a verified visual reference. No login or external design asset is required to proceed.

## Library scope — build or harden only what pages repeatedly need

| Layer | Canonical building blocks | Contract to lock |
| --- | --- | --- |
| Foundations | semantic colour roles, typography, spacing, control sizes, icon scale, motion and focus | Current Wodana/tenant theme, light/dark/high-contrast, RTL, reduced motion and mobile; no feature-local hex values for standard chrome. |
| Actions & inputs | button/icon button/menu, text/search/number/date/select/checkbox, validation, upload | `value`/`onChange` or `onPress`/`onAction`, disabled/busy/error/permission states, keyboard and accessible names. No silent submit or double submit. |
| Layout & navigation | one record header, contextual tabs, command bar, empty/loading/error state, dialog/sheet | One page identity, one navigation level for peer views, one primary action, one search/filter area. Title is not repeated by the child panel. |
| Data | one DataGrid and toolbar, selection action bar, row inspector, status, pagination | Selection either exposes valid bulk actions or is absent. Do not combine outer and inner toolbars. Responsive rows, truncation, full-value access and explicit row destinations. |
| Decisions | document preview, revision/amount summary, evidence checklist, approver identity, decision footer, history | A typed **DecisionWorkspace** composition; approval callback is disabled until permissions/evidence are ready, explains the blocker, confirms consequential decisions, and shows the resulting state. No domain rule lives inside the generic component. |
| Work & supply | next-action card, task detail, material requirement and allocation summary | Consistent owner, due date, state, source record and destination link. Domain adapters supply facts; components never invent statuses or quantities. |

Reuse `@/design-system` exports where sound. Deprecate `components/ui` behind migration aliases only after its remaining consumers are enumerated. Storybook and `/design-system` become truthful specimens, not a second product dashboard.

## Bounded execution and stop/go gates

1. **Inventory and visual contract.** Map the remaining live control variants and page-local CSS to the table above. Decide the *current* primary/action/focus colours with one token source and update stale library guidance. Record the purpose, primary user action and source-of-truth for each page before touching it. Deliverable: reviewed component matrix and 3 annotated page wireframes (quote, decision, supply). **Gate:** no disagreement over the current theme or page purpose.
2. **Library slice only.** Harden button, field/select, record header, tabs, command bar, DataGrid/selection, feedback, preview and DecisionWorkspace in isolation. Add realistic long/empty/error/permission examples and typed callbacks. No sales/project API or stage changes in this slice. **Gate:** Storybook and `/design-system` visually reviewed at desktop/mobile, light/dark, keyboard, focus, RTL and reduced motion; component tests pass.
3. **Lock business contracts.** For each first pilot screen, write: record source, allowed actors, current revision, actions, guards, resulting state, navigation destination and rollback/error behavior. The user reviews this small contract before UI wiring. **Gate:** every button and checkbox has a specified effect or is removed.
4. **Migrate one vertical slice at a time.** Start with **Design Quote** (clear scope/costing and one submit path), then **Approval** (real preview and decision), then **Project Supply** (BOQ → material requirement → reserve/order/issue). Do not move to the next slice until the current one passes API-backed end-to-end checks and visual review. Preserve existing URLs/data and use adapters to avoid rewriting business services for styling.
5. **Release safely.** Compare before/after screenshots and interaction traces, test existing records and a fresh record, verify permissions and dark/mobile states, then deploy a single slice with rollback. No mass migration or production rollout while a slice has unresolved blockers.

## Acceptance for each migrated screen

A new user can state its purpose and next action within five seconds. The header names the record once; all visible controls have a real effect and an explained destination. There is no duplicated toolbar or navigation level, no selection without a bulk action, and no generic approval table replacing a decision. The screen works with zero, partial, stale, loading, error and permission-restricted data; long names and large lists remain legible; keyboard, 390px mobile, dark mode and reduced motion are checked. Backend state and the visible post-action state agree. A passing component test alone is not completion.

## Explicitly out of scope now

No new client workflow stages, no broad project rewrite, no data migration, no production deployment, and no claim that the whole SaaS has been fixed. Existing release warnings must remain truthful until their underlying legacy records are reconciled; the UI may make them smaller and more contextual only during that screen's approved slice.
