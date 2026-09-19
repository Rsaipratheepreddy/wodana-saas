# Palm enquiry response workspace

Local acceptance evidence for P02.3 on 18 September 2026. This slice uses synthetic, disposable data only. It does not deploy, mutate Palm Living data, contact a real customer, or claim provider delivery.

## Accepted response flow

The web enquiry inspector and native CRM lead sheet now present the assigned enquiry as one response workspace:

- assigned owner, next action, first-response SLA and the 60-minute ownership-takeover deadline are visible together;
- Call, Email and WhatsApp open the device or browser contact app only when the required contact detail exists;
- follow-up, internal note and completed outbound call are distinct actions;
- activity history shows direction, status and due action rather than implying that an external app completed delivery;
- a completed outbound call creates customer-response evidence, while an internal note remains internal and only stops ownership takeover;
- the provenance view retains source, channel, intake method, received/processed times, external and correlation references, campaign attribution and assignment history; and
- loading, empty, API failure and external-app-open failure remain explicit states.

## Delivery-truth boundary

Opening `tel:`, `mailto:` or WhatsApp does not mark an enquiry answered or a message sent. Web copy directs provider-tracked messaging to Inbox. Native copy reports launch failure without creating a sent state. Only a deliberately completed outbound call is accepted as call response evidence; future email/WhatsApp sent, delivered and failed truth remains P07 provider work.

## API and identity continuity

The lead detail API now returns the enquiry's external event reference, correlation reference, payload reference and ordered attribution touches alongside the existing party, ownership, qualification, opportunity, assignment and SLA data. The response actions keep the same lead, party and owner identifiers and use the existing CRM activity endpoints, so P02.4 can hand the same customer and enquiry history into Opportunity and Job/Discovery without a parallel record.

## Verification

The following checks passed:

- Business Core focused run: 4 files, 25 tests covering lead detail/provenance and response evidence;
- web enquiry page run: 17 tests, including the response/provenance inspector and delivery-truth copy;
- native mobile run: 57 tests, including contact targets and the three response activity bodies;
- Business Core, web and mobile TypeScript checks;
- touched web-file ESLint and a changed-feature scan with no raw `table`, `button`, `input` or `select` markup;
- `npm run test:smoke:palm-fixture` against a fresh migrated disposable database, proving provenance, response actions and completed-outbound-call evidence;
- Playwright desktop and Pixel 7 acceptance: 2/2 passed in light and dark themes with no horizontal overflow or page errors;
- Expo export completed for iOS, Android and web; and
- targeted `git diff --check` passed before this evidence update.

## Remaining boundaries

P02.4 owns qualification and identity-preserving handoff into Opportunity and Job/Discovery, including duplicate, reopened and reassigned cases. P02.5 owns reconciled health reports and the two-role synthetic acceptance path. Provider-backed messages, push delivery, physical-device UAT, Palm clone/live migration and deployment remain P07/P09 work.
