# Approved logo rollout

The login page now uses the approved rounded Wodana wordmark with Woddy alongside the name. The original concept remains archived; older logo files are retained for recovery.

Assets:
- ../../packages/brand/logo/wodana-mark.svg — the house mark; the wordmark is set live in Plus Jakarta Sans.
- ../../packages/brand/logo/ — rendered lockups (light and dark) and app icons, copied to the apps by `node packages/brand/sync.mjs`.
- ../../apps/web/app/icon.tsx — publicly available, statically generated 64 × 64 PNG favicon using the icon master. No auth dependency.

The imagegen skill and built-in image-generation tool were used to prepare transparent assets. No CLI image generation was used. Login typography, theme, tenant branding, and authentication behavior are unchanged. This request does not replace the separate animated Woddy chat avatar.

## Wordmark preparation prompt

```text
Use case: background-extraction.
Input image: the user's APPROVED Wodana logo. This is a production asset preparation edit, NOT a redesign.
Remove ONLY the white background and the excessive outer whitespace. Preserve the approved logo exactly: the same standalone six-lobed Woddy mascot on the left with its two WHITE oval eyes and orange/rose/lilac gradient, and the exact same rounded dark plum lowercase lettering "wodana" on the right. Preserve every letter's shapes, thickness, rounded ends, spacing, relative size and alignment. Do not change the font, trace it into a different font, recolor it or redraw the mark.
Output a single tightly framed horizontal logo on a GENUINELY TRANSPARENT alpha-channel background, not white and not a painted checkerboard. Retain white inside Woddy's eyes; those eye shapes must be opaque white, not holes. Transparent space inside letter counters. Tight horizontal framing, just 2% empty margin around the complete mark. No crop into artwork. No extra elements or shadows. High-resolution crisp clean contours.
```

## Icon preparation prompt

```text
Use case: background-extraction.
Input image: approved Wodana logo. Extract ONLY the standalone Woddy mark at the far left for use as the browser favicon. This is NOT a redesign.
Preserve the exact six-lobed silhouette, its original orientation, two white oval eyes, and the exact orange/rose/lilac gradient from the approved input. Keep both eyes opaque white. Remove all lettering and the white background entirely.
Output ONE centered square icon on genuine transparent alpha background. Woddy fills approximately 88% of the canvas with even transparent padding. No text, no lettering, no borders, no card or tile behind it, no shadow, no extra shapes, no invented details, no embossing. Perfectly clean antialiased edges with NO stray pixels, color fringes or white halo. This is a high-quality faithful cutout for the existing approved brand, not a new version of the mascot.
```
