# Simple smart rules — local engineering evidence

Local engineering evidence for P07.3 on 18 September 2026. No live provider, Palm Living account, production tenant or deployment was changed.

## Accepted behavior

- Tenant users see four business-language rules only: new enquiry ownership, missed-response escalation, client decision reminders and weekly project progress. The graph builder and run internals are not exposed in tenant navigation.
- Enquiry ownership and missed-response escalation publish or pause the existing validated workflow definitions. Decision and weekly rules are stored as notification policies with explicit supported channels.
- Due decision reminders use the workspace-local date, exact revision-bound request owner, notification preferences and a stable daily idempotency key.
- Weekly project summaries use the configured workspace-local weekday, active project assignments, open/overdue task and snag counts, notification preferences and a stable ISO-week idempotency key.
- Weekly email is attempted only when the rule includes email. The existing project notification service still requires an individual email opt-in and an approved `project.update` template.
- Provider cards distinguish built-in, connected-but-unverified, delivery-verified and disconnected states. Email and WhatsApp show that the tenant's external provider plan applies; a connection alone is never presented as verified delivery.
- The new page composes shared `Surface`, `Badge`, `Callout`, `Switch`, `Checkbox` and `SelectField` components. It adds no feature-owned raw button, input, select or table controls.

## Verification

- Business Core focused tests: automation preset catalog/provider truth and reminder scheduler — 2 files, 4 tests passed.
- Web focused tests: smart rules, internal workflow editor regression and workspace navigation — 3 files, 16 tests passed.
- Business Core and web typechecks passed.
- Touched web files passed ESLint.
- Targeted `git diff --check` passed.

## Remaining boundaries

External provider receipt verification requires a connected tenant provider and a real authorized test delivery. Until that exists the UI deliberately reports `Needs delivery test` or `Not connected`; it does not claim success. Real Palm configuration, physical-device push checks and deployment remain later controlled acceptance work. Repository-wide legacy component cleanup is not claimed by this slice.
