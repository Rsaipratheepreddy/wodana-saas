# Structured decision requests — local engineering evidence

Local engineering evidence for P07.2 on 18 September 2026. No provider, Palm Living account, production tenant or deployment was changed.

## Accepted behavior

- Staff create one structured request against an exact issued quotation or client-review material revision. The request records the current staff membership as owner, due date, two bounded choices, escalation delay and opt-in reminder channels.
- A request is available only when the exact revision already has an assigned client approver. Only that grant can respond; another portal approver is denied.
- The client Inbox shows the exact revision, due date, choices, reminder/escalation summary and response state. Submission is replay-safe, rejects stale/expired revisions and preserves the immutable response ID, choice, note, actor and time.
- The public projection omits staff membership IDs, client grant IDs, internal comments and controlled-change internals.
- In-app/email/WhatsApp are stored as notification preferences. This slice does not claim provider delivery; verified dispatch/receipts and cost visibility belong to P07.3.
- New decision UI uses the shared Button, TextInput, TextAreaField, SelectField, NumericInput, Checkbox and modal components. No forked feature controls were added.

## Verification

- Business Core focused tests: commercial domain/client portal — 2 files, 20 tests passed.
- Web focused tests: policy helper, decision composer and client portal — 4 files, 13 tests passed.
- Business Core and web typechecks passed.
- Touched web files passed ESLint.
- Targeted `git diff --check` passed.

## Remaining boundaries

Real email/WhatsApp delivery, provider receipts, plan/cost visibility and non-technical automation setup remain P07.3. Real Palm roles/data, physical devices and deployment remain P09. Repository-wide legacy feature-control migration remains the final component-compliance gate; this slice does not claim that global cleanup is finished.
