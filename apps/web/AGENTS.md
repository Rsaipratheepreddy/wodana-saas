<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Wodana product UI guardrails

- Product layouts are full-bleed by default. Do not wrap the application shell or page canvas in
  an all-sides bordered, rounded card and do not add global page padding to simulate a card.
- Do not use complete rectangular borders to group page regions, tables, sidebars, or passive
  cards. Prefer hierarchy from whitespace, background tone, typography, and a single structural
  divider where separation is necessary. Complete borders remain valid for interactive controls,
  menus, dialogs, and selectable objects when their boundary is required for usability.
- Keep product typography compact and neutral. Use colour for action and state, not decoration.
- Use shadows only for transient elevation such as menus, dialogs, drawers, and drag previews.
- New shell and navigation work must preserve keyboard access, RTL layout, reduced motion, and
  mobile behavior.
