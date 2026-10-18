# Wodana design system

The Wodana design system is the shared React component library for dense interior-design operations. The current workspace keeps its varied icon and status colours; the tenant's primary colour is for primary actions and focus, not a wash over every surface. A component specimen passing review does not mean its consuming business screen is complete.

## Architecture

| Layer | Responsibility |
| --- | --- |
| `foundations` | Provider, tokens, direction, locale, theme, density, formatting |
| `primitives` | Layout and typography with no business knowledge |
| `components` | Accessible actions, fields, navigation, status, and overlays |
| `patterns` | Data, files, scheduling, collaboration, workflow, integrations, AI, analytics |
| `domain` | Finance, interior-design, administration, and portal compositions |

Use the stable public entry point:

```tsx
import {
  Button,
  DataGrid,
  DesignSystemProvider,
  InspectorSheet,
} from "@/design-system";
```

Do not import styling or implementation files from another layer directly. Domain patterns should compose public primitives instead of creating new colors, focus behavior, or spacing values.

## Provider

```tsx
<DesignSystemProvider
  theme="light"
  density="compact"
  locale="en-AE"
  direction="ltr"
  currency="AED"
  timeZone="Asia/Dubai"
>
  <Application />
</DesignSystemProvider>
```

Supported themes are `light`, `dark`, and `high-contrast`; densities are `compact` and `comfortable`. Set `direction="rtl"` with an Arabic locale. The root defaults to Plus Jakarta Sans for Latin and Noto Sans Arabic for Arabic content unless a tenant sets another font. Numbers, IDs, email addresses, phone numbers, and currency values should use localized value components when embedded in RTL text.

## Interaction contract

- UI text is 12–14px. Product headings are 16–24px.
- Buttons use the `--wd-button-*` sizing tokens: 28px compact, 32px standard, and 40px large; coarse-pointer targets grow to at least 44px. Table rows use `--wd-table-row`: 40px standard or 36px compact.
- Borders are one pixel; radii are 6–8px; shadows are reserved for floating layers.
- All component colours come from semantic tokens in `styles/tokens.css`. Tenant primary and accent override seams keep the existing multi-colour icon/status language; changing a tenant's primary colour must not recolour every module icon.
- Use `DataGrid appearance="contained"` for a centered, max-width table with subtle complete cell boundaries and one integrated toolbar/footer. `appearance="flush"` remains available for embedded sheets and inspectors. The table max width, rows and padding are tokens; do not recreate them in feature CSS.
- Glass is limited to transient menus, tooltips and dialogs, with a solid fallback for reduced-transparency and forced-colour modes. Tables and form fields remain opaque for legibility.
- Haptics are optional. Use `Button haptic="selection"` only for deliberate selection actions; call `emitHapticFeedback("success")` only after a real save/approval succeeds. Unsupported browsers silently continue without vibration. Never rely on vibration as the only feedback.
- Enter commits editable cells, Escape cancels, and Tab commits then advances.
- Primary record cells open the fixed inspector. Cell controls stop row activation.
- Inspectors use 420, 560, or 720px widths and become full-screen on mobile.
- Dirty inspectors ask before dismissal and restore focus to their trigger.
- Destructive actions require an explicit confirmation summary.
- Motion uses 120, 180, or 240ms and collapses to 1ms for reduced-motion users.
- All layout CSS uses logical properties; directional icons mirror in RTL.

## Component catalogue

### Foundations and primitives

Provider, money/date/quantity/measurement formatters, Box, Stack, Inline, Grid, Surface, Container, Split, Separator, ScrollArea, AspectRatio, VisuallyHidden, Text, Heading, LabelText, Caption, MetricText, TextLink, Code, lists, and LocalizedValue.

### Universal components

Button, IconButton, SplitButton, MenuButton, ToggleButton, ButtonGroup, Badge, Tag, Avatar, AvatarGroup, Persona, tooltip, popover, menu, dialog, alert dialog, drawer, SideSheet, BottomSheet, toast, callout, empty/error/offline state, progress, spinner, skeleton, app shell, sidebar, top bar, breadcrumbs, tabs, pagination, command palette, and mobile navigation.

### Forms and property editing

Form, Fieldset, validation summary, autosave state, text, textarea, search, email, phone, URL, password, OTP, masked, numeric, money, percentage, quantity, measurement, duration, date, range, time, date-time, recurrence, time zone, checkbox, tri-state checkbox, radio, switch, select, combobox, autocomplete, multi-select, segmented control, user/vendor/material picker, file upload, upload queue, logo upload, image cropper, attachment list, rich text, mentions, inline edit, character count, signature, and repeatable fields. Both `FieldStack` and `PropertyRow` layouts are available.

### Data and inspectors

`DataGrid<Row>` provides sorting, search, facets, saved URL views, selection, bulk actions, column visibility/order/resize/pinning, grouping, aggregation, sticky regions, density, export, pagination, editable cells, virtualization, same-schema tree rows, different-schema subtables, lazy states, and fixed inspectors.

### Documents, schedule, and collaboration

File browser, folder tree, gallery/viewer, metadata, versions, comparison, approval stamps, calendar overlays, agenda, week schedule, availability, resource planning, timeline, Gantt, page-level point comments, pins, mentions, replies, reactions, resolve/reopen, activity, audit, notifications, presence, watchers, and sharing.

### Wodana patterns

Workflow, integration, organization administration, finance, BOQ, procurement, interior-design lifecycle, client/vendor portals, analytics, and human-approved AI patterns are exported as compositions. The canonical interior lifecycle is brief → design → BOQ → client payment → technical drawings → production → installation → snagging → handover.

## Documentation checklist

Each new component or material variant must document and test:

- Purpose, anatomy, variants, props, and composition.
- Default, hover, focus, active, disabled, loading, read-only, and error states.
- Keyboard behavior, focus order, and screen-reader name.
- LTR/RTL, English/Arabic, long text, and localized values.
- Light, dark, high-contrast, and reduced-motion behavior.
- 320, 390, 768, 1024, and 1440px layouts at 200% zoom.
- Content guidance, destructive wording, do/don't examples.
- Loading, empty, error, partial, and permission-restricted data states.
- Accessibility and performance notes.

## Verification

```bash
npm run typecheck --workspace @wodana/web
npm run lint --workspace @wodana/web
npm run test --workspace @wodana/web
npm run storybook:build --workspace @wodana/web
npm run build --workspace @wodana/web
npm run test:e2e --workspace @wodana/web
```

The catalogue is at `/design-system`; Storybook is the engineering reference. Existing product screens need separate workflow and visual verification before being called complete.
