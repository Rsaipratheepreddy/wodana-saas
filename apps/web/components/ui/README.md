# Wodana UI primitives

Import product primitives from the barrel, never from an individual file:

```tsx
import { Badge, Button, DataTable, TextField } from "@/components/ui";
```

## Rules

- Use tokens from `styles/tokens.css`; do not add one-off hex colors, radii, shadows, or spacing.
- Keep one primary action per work area. Confirm any action that changes money, approval, production, or access.
- Use underline `Tabs` for peer views. Do not use a stepper as page navigation.
- Use `DataTable` for operational records and cards only for summaries or focused empty states.
- Set `dir="ltr"` or `dir="rtl"` at the portal shell. Primitives use logical inline properties and directional icons mirror automatically.
- Inter is the Latin product face; Noto Sans Arabic is the RTL companion and activates through `lang="ar"`.
- Keep IDs, emails, phone numbers, and currency strings in an inner `dir="ltr"` element when their character order must remain fixed.
- Motion must explain state, finish within the token durations, and continue to work when reduced motion is enabled.

## Scale

- Type: 1.25 modular scale.
- Spacing: 4px base with 8, 12, 16, 20, 24, 32, 40, 52, 64, and 84px steps.
- Controls: 32px compact, 40px default, 48px prominent.
- Golden ratio: use 38.2% / 61.8% for macro layouts only.

The living reference is available at `/design-system`.
