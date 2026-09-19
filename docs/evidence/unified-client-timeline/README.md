# Unified client timeline — local engineering evidence

Local engineering evidence for P07.1 on 18 September 2026. No provider, Palm Living account, production tenant or deployment was changed.

## Accepted behavior

- Jobs and Customer profiles read the same workspace-and-customer-scoped timeline projection; the UI does not copy or invent communication state.
- Email, WhatsApp, phone, SMS and internal conversation messages retain provider-backed states. Draft, queued, sent, delivered and failed remain distinct; a provider `read` receipt is presented as Read without losing its delivered truth.
- Internal notes and completed calls/meetings are labelled **Manually logged**. A planned call is not presented as a completed interaction.
- Authenticated design decisions made through the client portal are linked through the Job's active Case and labelled Recorded.
- Failure codes remain visible. Missing communication/activity permissions return an explicitly limited timeline rather than leaking hidden records.
- The shared `ActivityFeed` was extended once with optional status/detail metadata and reused by both Job and Customer views.

## Verification

- Business Core focused test: `src/crm/shared/client-timeline.spec.ts` — 3 tests passed.
- Web focused tests: Job profile, timeline presentation and shared components — 3 files, 10 tests passed.
- Business Core and web typechecks passed.
- Touched web files passed ESLint.
- Raw `table`, `button`, `input` and `select` scan was empty in the changed feature files; controls remain shared-library compositions.
- Targeted `git diff --check` passed.
- Authenticated local runtime check loaded CRM Jobs and Customers without a server/runtime error. The current real local organization has no Job/Customer rows, so populated behavior is covered by the focused synthetic tests rather than a claim about live data.

## Remaining boundaries

Real email/WhatsApp delivery still requires a configured provider and verified receipts. Palm clone/live data, physical-device checks and deployment remain P09 work. P07.2 adds revision-bound decision requests and reminders on top of this timeline; P07.3 adds the non-technical setup experience.
