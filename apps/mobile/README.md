# Wodana staff app

Expo SDK 55 / React Native 0.83 / Expo Router. The field and office staff app for Wodana: today's
work, sales, projects and site, purchasing and factory, people (attendance, leave, time), and quick
captures that work offline. The product is generic: a tenant's name, logo, colours, currency, time
zone and permissions all come from the server.

## Run

From `wodana-saas/apps/mobile` (Business Core must be running, by default on `127.0.0.1:8000`):

```sh
npm install
npx expo start            # Expo Go / dev client; press i (iOS) or a (Android)
npx expo run:ios          # native build (needed after adding native modules)
npx expo run:android
npm run web               # browser preview on http://localhost:8082 (proxies /api/v1 to Business Core)
```

Copy `.env.example` to `.env.local` to point at another API. The iOS simulator reaches the Mac at
`127.0.0.1`; the Android emulator uses `10.0.2.2`; a phone needs a reachable HTTPS API. A white-label
build sets `EXPO_PUBLIC_APP_NAME`, `EXPO_PUBLIC_APP_ICON`, `EXPO_PUBLIC_SPLASH_IMAGE`,
`EXPO_PUBLIC_BUNDLE_ID` (see `app.config.ts`); nothing in the code knows a tenant.

Push: a uat or production build needs `EXPO_PUBLIC_EAS_PROJECT_ID` (set it as an EAS environment
variable; the build refuses to start without it). On sign-in the app asks to allow notifications,
records the answer, registers the phone's Expo token and turns push on unless the person turned it
off (Me → Notifications on this phone). Signing out unregisters the phone.

Approve from the lock screen: an approval notice that needs no note (an order, a payment run, petty cash, a quote
review, a daily report) shows Approve and Open. On iOS, Approve asks for Face ID or the passcode and decides it in
the background; Android opens the app (unlocked) and decides it at once. It goes through `approvals/decide`; anything
that needs more than a tap opens the app instead. Approvals never wait for a connection: without one the phone says so
(the tap is held a few minutes only, so a send the phone paused part-way finishes when the app next runs).

## Check

```sh
npm test                  # node:test over scripts/*.test.* (pure logic, auth client, proxy, labels)
npx tsc --noEmit -p .
node scripts/i18n-keys.mjs  # labels not yet in apps/web/lib/i18n/en.json
```

## How it's built

- `src/app/`: routes. `(auth)` is sign-in (email first; the account picks its workspace), two-step
  code and password help. `(app)/(tabs)` is Today · Work · + · Inbox · Me; everything else is a
  pushed screen.
- `src/features/<module>/`: screens, query hooks and outbox senders per module (hrms, projects,
  capture, sales, purchasing, factory, survey, inbox, today, me).
- `src/core/`: session and permissions (`access.ts`, from the server's permission codes only),
  workspace API, region formats (`format-core.ts`), the offline outbox, deep links, media and
  location.
- `src/ui/`: the design system on the web's generated tokens (`npm run sync:design`): Screen,
  ListScreen, Section, ListRow, Sheet, fields (text, select, date/time, stepper, segmented), toast,
  photo grid and the tenant-branded theme (same palette logic as the web).
- Labels are English keys through `t()`; layouts use start/end so they work right-to-left.

## Offline

Attendance, crew days, site photos, daily reports, snags, measurements and deliveries are saved on
the phone first (sealed with a device key; photos are copied out of the camera cache) and sent in
order when there is a connection, each with the same operation id so a repeat is recognised by the
server. When the server asks for something (an exception reason, a fix) the item waits in
Me → Waiting to send. Approvals, decisions and money always need a connection.
