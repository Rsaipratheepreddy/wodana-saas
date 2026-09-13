# Wodana design system

The Wodana design system is a layered, product-ready React library for dense interior-design operations. It borrows Notion's information hierarchy and Figma's contextual editing model while keeping Wodana's green and aqua as functional accents.

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

Supported themes are `light`, `dark`, and `high-contrast`; densities are `compact` and `comfortable`. Set `direction="rtl"` with an Arabic locale. The root uses Inter for Latin and Noto Sans Arabic for Arabic content. Numbers, IDs, email addresses, phone numbers, and currency values should use localized value components when embedded in RTL text.

## Interaction contract

- UI text is 12–14px. Product headings are 16–24px.
- Controls use 32px compact or 36–40px standard heights. Data rows are 40px.
- Borders are one pixel; radii are 6–8px; shadows are reserved for floating layers.
- Green means primary action or success. Aqua means information or active context.
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

The polished catalogue is at `/design-system`; Storybook is the engineering reference. Existing product pages remain untouched until their replacement components pass these checks.
