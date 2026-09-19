# Mobile foundation evidence

## 18 September 2026 — Home and module entry

The mobile Home was reviewed against current business-dashboard references rather than copied from a single concept:

- [AI-Powered Sales CRM Mobile App](https://dribbble.com/shots/27114998-AI-Powered-Sales-CRM-Mobile-App): daily focus, real quick actions and restrained indigo emphasis.
- [Conneq CRM — Productivity Management Mobile App](https://dribbble.com/shots/27082491-Conneq-CRM-Productivity-Management-Mobile-App-UI-UX-Design): one readable daily hierarchy rather than a wall of equal cards.
- [Invoice App mobile references](https://dribbble.com/tags/invoice-app): compact business navigation and consistent card rhythm.

Wodana keeps its own generated web tokens, Inter/Noto Sans Arabic typography, gradient brand mark and permission model. The resulting screen uses:

- a compact Wodana/profile app bar;
- a personal greeting and explicit active workspace;
- a real `For you today` feed, with honest loading/error/empty states;
- a featured CRM destination plus smaller Pre-execution and People destinations;
- descriptions that explain the work behind each module;
- a compact two-destination global dock; and
- a consistent module header with back action, icon, name and purpose.

No metric, task, module, provider or notification is invented for presentation. Module visibility still comes from the authenticated membership's `allowedModules`.

### Verification

- Native TypeScript check: passed.
- Native logic tests: 47/47 passed.
- Expo iOS, Android and web bundle export: passed.
- Synthetic loopback sign-in: Home, Profile and CRM shell inspected on iPhone 17 Pro simulator in light and dark modes.
- Public welcome/sign-in: inspected on iPhone 17 Pro simulator.
- Clean native iOS Debug build: succeeded with zero errors, installed on iPhone 17 Pro simulator, opened the development client and bundled the app.
- No Palm or production data was read or changed.

Physical iOS/Android acceptance, real push/deep links and release signing remain P09 tasks.
