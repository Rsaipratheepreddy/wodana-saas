# Palm qualification and identity-preserving handoff

Local acceptance evidence for P02.4 on 18 September 2026. This slice uses synthetic, disposable data only. It does not deploy, mutate Palm Living data, contact a real customer, or claim an external provider connection.

## Accepted handoff

- A qualified enquiry creates one replay-safe Opportunity with the same customer party, lead and deliberately selected owner.
- The exact qualification form version, question labels, typed answers, selection, evaluation time and evidence hash are frozen at conversion.
- Opportunity shows that frozen decision in a dedicated Qualification view. A directly created opportunity is labelled honestly and does not invent enquiry history.
- Creating Pre-execution is replay-safe and carries the same customer, lead, Opportunity, current owner, conversion origin and frozen qualification evidence.
- Discovery defaults use the frozen snapshot first. Later edits to live lead answers or form configuration cannot rewrite the original decision; legacy records without a snapshot retain the existing fallback.
- Property type, requirements, budget, timeline, location, decision maker and preferences can seed Discovery while remaining editable as later discovery detail.
- The Pre-execution overview shows the frozen answers and direct links back to the original enquiry and Opportunity.
- Reassigned qualification, lost Opportunity reopening, duplicate conversion/creation retries, cancelled case reopening and Job lineage are covered without creating parallel customer or work identities.

## Verification

- Business Core focused run: 4 files, 23 tests covering conversion integrity, reassigned ownership, duplicate retries, lost/reopened opportunities, case replay, cancelled/reopened cases and frozen Discovery defaults.
- Web focused run: 3 files, 10 tests covering evidence normalization, Opportunity qualification UI, direct-opportunity truth and Pre-execution source links.
- Business Core, web and native mobile TypeScript checks passed.
- Native mobile full run: 57 tests passed; the Deal sheet shows frozen qualification answers and stage-decision history.
- `npm run test:smoke:palm-fixture` passed against a fresh migrated disposable database, including `qualificationHandoffVisible`, `frozenDiscoveryDefaultsSafe`, conversion replay, preparation replay and Job identity lineage.
- Playwright desktop and Pixel 7 acceptance: 2/2 passed with no horizontal overflow or page errors.
- Touched web-file ESLint passed and the changed feature UI contains no raw `table`, `button`, `input` or `select` elements.
- Expo export completed for iOS, Android and web.
- Targeted `git diff --check` passed before this evidence update.

## Remaining boundaries

P02.5 owns reconciled source/channel/owner/team/type/freshness/SLA reporting and the final two-role Palm synthetic acceptance matrix. Provider-backed social ingestion, email/WhatsApp receipts, push delivery, real Palm people, clone/live migration, physical-device UAT and deployment remain later release work.
