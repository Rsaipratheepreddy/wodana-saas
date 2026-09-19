# Wodana mobile

Expo/React Native application for the new Wodana web product. There is no Flutter
source in this repository. The current milestone includes email/password/MFA,
an authenticated shell, CRM, employee HRMS and Pre-project Site/Brief field capture.
The public welcome and sign-in screens use the same neutral canvas, flat indigo
action colour and Wodana logo as the web design tokens.

`Sign in with email` opens the email/password form. `I don’t have an account` opens
invitation guidance. The form includes masked/showable passwords, keyboard actions,
validation with field focus, back navigation, and password-help guidance.
Unconnected Google Workspace SSO is not shown as an available action.

Authentication uses the new Business Core API. Login verifies the active profile
and workspace before opening Home. Access tokens stay in memory; native refresh
tokens use Expo SecureStore and rotate when restoring a session. Sign out clears
the local session and requests server revocation. The Metro browser preview keeps
refresh tokens in an HttpOnly cookie through its local API proxy.

Password help submits a reset request. The existing backend does not deliver reset
emails yet, so the screen directs the user to their administrator for a reset link.

The global bottom navigation contains only working Home and Profile destinations.
Its selected state uses the semantic navigation/action tokens, with 48-point touch
targets, RTL order and keyboard navigation in the browser. The CRM module retains
its working Inbox; global Inbox, Create and Notifications are hidden until they
have real flows.

Home has a flat token-based header, the selected organization name/brand, profile initials,
live updates when HRMS is granted, and a compact list limited to that user's effective module grants.
Home shows only granted modules with a working native destination; Projects remains
available on web until its native screen is built.
Updates show up to two relevant HRMS items: open attendance, upcoming leave, or requests
the member can approve. Each opens the corresponding HRMS screen. Counts respect
permissions and exclude the member's own approval requests. Updates refresh on return
to Home, foregrounding, and manual refresh; failed sources show a retry state.
HRMS opens working attendance, leave, history, and approval screens. Other module entries retain their existing destinations.
Profile shows the signed-in account and Sign out.

## Run

From `wodana-saas`:

```sh
npm run install:mobile
npm run ios:mobile
# or
npm run android:mobile
```

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local`, then set the native
Business Core API URL, tenant slug, browser proxy target and tenant web origin for your environment.
The web origin lets the app display an operator-provided logo when `/me` returns a relative URL;
without it, the organization name and approved colour remain the safe fallback.
The iOS simulator can use `127.0.0.1`; Android Emulator uses `10.0.2.2` for the same
Mac. Rebuild standalone native apps after changing their public configuration.
The Metro proxy is for browser development; a deployed web export needs its own
server proxy. Native apps connect directly to Business Core.

For Metro / Expo Go, use `npm run dev:mobile`. From this directory, `npm run web`
opens a browser preview of the same React Native screen.

To install a standalone iOS simulator build that opens without Metro:

```sh
npx expo run:ios --configuration Release --device "iPhone 17 Pro" --no-bundler
```

The native runtime is Expo SDK 55 / React Native 0.83 / React 19.2.0, compatible
with this Mac's Xcode 26.2. SDK 57 needs Xcode 26.4+. Mobile has its own
`package-lock.json` and dependency install, separate from the web workspaces, so
their different React versions cannot be accidentally mixed by Metro.

## Design source

The new `apps/web` is the visual source. The older Flutter splash and theme were
reviewed for context; this app uses the new web brand and design tokens.

- Exact `wodana-logo-v4.png` wordmark and `woddy-mark-v4.png` mascot from web.
- Inter and Noto Sans Arabic, regular / medium / semibold / bold, bundled from
  `@expo-google-fonts` packages. No runtime font downloads. Their font licenses
  are distributed in the respective packages' `LICENSE_FONT` files.
- Semantic light, dark, and high-contrast colors; type sizes; spacing; radii;
  and motion timings generated directly from `apps/web/styles/tokens.css`.
- Sign-in controls use a 48-point height, 12-point corners, 13-point input/button
  text, 12-point labels and one solid action colour. `login-theme.ts` records
  public light-surface styles; the authenticated shell follows the system light/dark mode.
- Safe-area-aware layout, compact spacing on short screens, text scaling,
  accessible controls, and reduced-motion-aware entrance and focus animations.
- Native launch uses the neutral light/dark canvas and the Wodana mark until fonts
  and the rendered wordmark are ready.
  Android 12+ uses the mascot within its system splash mask, then shows the
  complete wordmark in React Native. Native launch presentation should be
  verified in release builds, because Expo Go substitutes its own launch UI.

After updating web tokens or logos:

```sh
npm run sync:design
npm run test
```

## Native components

Import from `src/design-system`:

- `DesignSystemProvider`: `system`, `light`, `dark`, `high-contrast`; locale,
  Latin/Arabic font selection, text direction, and reduced-motion preference.
- `Text`: web type scale, regular/medium/semibold/bold, semantic text tones.
- `Screen`, `Stack`, `Surface`: native layout and borderless surface primitives.
- `Button`: primary, secondary, ghost, flat public brand and brand-secondary variants,
  plus legacy white/glass variants. Icons, pressed/focused/disabled/loading states,
  accessible role/state, and minimum 48-point targets
  that grow when text wraps or scales.
- `TextField`: default and login variants, label/hint/error states, animated focus
  border and ring, trailing actions, ref forwarding, standard keyboard/password/
  autofill props, and a minimum 48-point touch target.
- `BrandLogo`: public and authenticated Wodana wordmark in `src/components`.
- `BottomNavigation`: controlled two-destination bar in `src/components`.
- `ModuleIcon`: eleven module/shortcut icons, with `brand` and `outline` variants,
  in `src/components/module-icon.tsx`. SVG exports live in `assets/icons/modules`;
  run `npm run icons:export` after changing the shared geometry. The module plan
  and current backend boundaries are documented in `../../docs/mobile-modules.md`.

The web component catalogue is not fully ported. Native controls use mobile touch sizes while preserving web
colors, hierarchy, and shape. Set an Arabic locale and the native app's RTL
configuration when building Arabic screens; no global direction is forced here.

## Check

```sh
npm run typecheck
npm run test
npx expo-doctor
```

Tests cover session restoration, refresh rotation, logout races, storage failures,
and browser cookie handling. Parity tests detect stale generated tokens or changed
brand files. A live API smoke check is available with a dedicated test account:

```sh
# Set MOBILE_AUTH_SMOKE_EMAIL and MOBILE_AUTH_SMOKE_PASSWORD in your environment.
node --env-file=.env.local --import tsx scripts/smoke-auth.mjs
```

Generated
`ios/`, `android/`, `.expo/`, build outputs, and dependencies stay out of Git.

Android's native launch screen still needs device/emulator verification.

## HRMS

HRMS uses fresh camera photos and action-only foreground location, with a durable pending capture and retry. It shares Business Core attendance, corrections and leave rules with the web. Administrators configure calendars, employees, sites and allowances in web HRMS. See [setup and verification](../../docs/hrms-implementation.md). New camera/location/date-picker modules require rebuilding the native development app.

### HRMS appearance and local examples

HRMS uses the same generated semantic light/dark tokens as Home and CRM, with flat selected tabs and restrained borders. Attendance, leave, history and approvals share these controls. Native date pickers, half-day selectors and keyboard-aware sheets are available in leave/correction forms. HRMS tabs scroll on narrow screens instead of wrapping.

The local sample-data script and its scope are documented in `../../docs/hrms-implementation.md`. Refresh HRMS or reopen the module after seeding. Sample attendance is labeled Demo and has no photo or GPS evidence. Live check-in remains available because no open sample session is created.

The HRMS tab bar reserves its full button height plus vertical inset and does not shrink beside the page scroll view. This prevents the selected pill from being clipped, including on long leave/history screens. The main bottom navigation is hidden while HRMS is open; Back to Home restores it.


## Pre-project field work

Pre-project opens the same case list and records as the operations portal. Brief & scope has room/catalog-linked requirements, notes, inspiration and reference files in three short steps. Site survey has visits, observations, structured measurements, evidence and permission-controlled verification/history. Assigned internal design reviewers also receive an exact-revision review queue with the protected file, source context, review note, approve and request-changes actions. Design authoring and client decisions remain web-first.

Camera, Photos and Files support several images/PDFs on one record. Draw opens an original photo with pen colour/thickness, Undo and Clear; saving creates a separate marked copy. Both assets remain linked to the record. Strokes use normalized coordinates and are rendered by Business Core. Measurement fields remain the source of numeric dimensions.

Shared contracts and serializers live in `apps/web/lib/pre-project`; Metro watches this pure module directory. Keep API migration 0039 applied before testing photo marks. Native dependencies must be rebuilt after installing the image picker, document picker and sharing modules with `expo install`.

See `docs/site-survey-implementation.md` for validation status and pending device checks.
