# P08.5 — handover and aftercare local engineering evidence

Date: 18 September 2026  
Scope: local Business Core and native mobile only. No Palm/live mutation, invitation or deployment.

## Connected flow

- A handover is generated from an area or released work package. Its task, scope, commissioning, dispatch and published closeout-document facts are frozen into a versioned packet.
- Client accept/return remains a client-portal or signed-record decision. Native staff can inspect the exact packet but cannot accept for the client.
- Remaining commitments are named records with owner, due date, blocking state and evidence. The owner submits completion; a different reviewer verifies closure.
- Accepted packets open only their exact warranty scope. Warranty issues become canonical snags and preserve the completed project and financial history.
- Retention remains a separate accounting control with due-date, accepted-handover, open-snag and independent verification gates.
- Native field users can walk the pack, see manuals/closeout documents, complete assigned commitments, verify where permitted, and record warranty issues. Evidence photos use the same durable per-user/workspace/project queue and stable upload checkpoints as field reports.

## Privacy and failure boundaries

- The native projection excludes client identity, signed acceptance evidence, finance, supplier contacts and employee calendar data.
- Optimistic revision conflicts, permission changes and invalid records stop for explicit review; transient failures keep the local action and copied evidence for retry.
- Warranty expiry and exact handover scope are revalidated on the server; the mobile date check is guidance only.
- Unresolved blocking commitments prevent portal acceptance. A completion submitter cannot verify their own commitment.

## Verification

- `npm test --workspace @wodana/business-core -- --run src/projects/execution.domain.spec.ts src/projects/project-field-work.spec.ts src/projects/project-handover.spec.ts src/projects/project-warranty.spec.ts src/projects/execution-controls.spec.ts` — 5 files, 53 tests passed.
- `npm run typecheck --workspace @wodana/business-core` — passed.
- `npm --prefix apps/mobile run typecheck` — passed.
- `npm --prefix apps/mobile test` — 65/65 tests passed.
- Targeted `git diff --check` for the Business Core and native project slice — passed.

## Remaining acceptance

P08.6 intentionally remains the final cross-module project run, per the instruction to finish the remaining slices before end-to-end testing. Physical iOS/Android permission, offline/reconnect and deep-link acceptance remains P09.5. Regional retention/tax policy remains externally gated by D06/P10.1.
