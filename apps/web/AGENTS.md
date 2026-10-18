<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Wodana product UI guardrails

- Product layouts are full-bleed by default. Do not wrap the application shell or page canvas in
  an all-sides bordered, rounded card and do not add global page padding to simulate a card.
- Tables use the shared frame: a 1px border with rounded corners, a header band and row hairlines
  (`design-system/styles/record-tables.css`, the same for DataGrid, RecordTable and GroupedTable).
  Page regions, sidebars and passive cards have no borders: prefer hierarchy from whitespace,
  background tone, typography, and a single structural divider where separation is necessary.
  Complete borders remain valid for interactive controls, menus, dialogs, and selectable objects
  when their boundary is required for usability.
- Keep product typography compact and neutral. Use colour for action and state, not decoration.
- Use shadows only for transient elevation such as menus, dialogs, drawers, and drag previews.
- New shell and navigation work must preserve keyboard access, RTL layout, reduced motion, and
  mobile behavior.

## Portal-wide UI consistency

- UI/UX is a primary acceptance criterion. Reuse shared design-system controls and tokens; do not accumulate page-specific replacements for the same input, button or table pattern.
- Preserve the current configurable brand colors and shared geometric typography. Use reference products for interaction quality while keeping one coherent Wodana identity across staff and client journeys.
- Every module needs a clear primary action, contextual record links, truthful empty/loading/error states and preserved drafts. Visual polishing alone does not complete a disconnected flow.
- Before implementing a module, document its end-to-end journey, fields/columns, business rules and API dependencies. Verify desktop, mobile, keyboard and RTL before reporting it complete.
- Do not add AI branding or assistance to onboarding. Seats means allocated capacity; Invite people is a separate action.

## Operations table rule

- Purchasing, Inventory and Factory default views must be scannable, compact tables: show the item or material, the necessary project context, the order or work state, delivery/shipping when relevant, and one clear next action. Do not surface accounting-style calculations, redundant summaries, or technical workflow fields by default.
- Put partial quantities, configuration, receipts, approvals, evidence and history in the related record detail or a deliberately opened secondary view. A status must describe the real source record; colour reinforces meaning but never carries it alone.
- A global row must link to its source record, and any create/approve/receive action must use the existing permission, validation and approval gates. No duplicate global records or decorative buttons that cannot finish their named action.
- Keep purchasing language and navigation to the essentials: Materials and Orders. Show the ordered items and delivery/shipping information people need to act; do not add test, demo, diagnostic, or configuration concepts to the user-facing flow. Shipping configuration belongs inside the opened order, not as another global queue or a crowded table column.
- Do not truncate material names, order titles, supplier names or action labels in operations tables. Let text wrap and rows grow while keeping a compact minimum height. Use semantic status tones from shared tokens (attention, danger, information, success); never rely on colour without a written state label.
