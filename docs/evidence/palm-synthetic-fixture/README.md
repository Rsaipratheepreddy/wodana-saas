# Palm synthetic UAT fixture

Local acceptance evidence for P00.5 on 18 September 2026. This fixture is a reusable test path, not Palm Living production data, a deployment, an invitation, or a provider-delivery claim.

## Fixture contract

`npm run test:smoke:palm-fixture` creates a uniquely named `wodana_funnel_test_*` PostgreSQL database, applies every migration, verifies tenant isolation, starts Business Core on loopback, runs the complete fixture, and drops that exact database from the shell `EXIT` trap. A failed assertion follows the same reset path. The command refuses a remote API; the Job-ledger verification also refuses any database that is not loopback and does not have the disposable prefix.

All people, email addresses, mobile numbers, locations, evidence references, commercial values and project content are synthetic. Staff emails use the reserved `.invalid` domain. No client credentials, Palm records, provider credentials, real messages or payments are used.

The fixture creates:

- a Palm-labelled synthetic UAE/AED organization and legal entity;
- an Operations actor with the system Owner role;
- a distinct Cece reviewer actor with no direct role, inheriting only the UAT design/commercial review permissions from an active synthetic team;
- a Sales and account managers queue with Operations as the available assignee;
- a published, branded shared enquiry form and one replay-safe public submission with source, channel and form attribution;
- a separate realistic enquiry that proceeds through qualification, Opportunity and Pre-execution;
- one room, one included wardrobe requirement, a site-plan asset, verified measurement, exact design revision and immutable confirmed definition;
- a room-first quotation, two payment milestones, client acceptance, signed-agreement evidence, independently verified advance-receipt evidence, Owner Review and execution release;
- the resulting Project, frozen workflow/package facts, resource/capacity checks, hold/recovery history and a controlled replacement variation;
- a purpose-bound client-portal actor for the exact definition and quotation decisions; and
- two Job identities: the untouched shared-link enquiry and the released delivery path, including permission-limited and denied readers.

## Verification

The passing isolated run produced the following non-secret result before cleanup:

- `fixture: palm_synthetic_uat`
- public shared-link replay, attribution and queue assignment passed;
- Operations and the team-inherited reviewer completed their permitted actions; pending-invitation and accepted-member seat reservations reconciled without double counting;
- permission-filtered universal search returned all five record kinds for Operations, only Job/Room/Quotation for the reviewer, and nothing after the review team was archived;
- client decisions were exact-record and purpose bound;
- the full enquiry → qualification → requirements → design → quote → finance gates → release → project path passed;
- cross-tenant, limited-reader, denied-reader, stale-write, replay and concurrency checks passed;
- Job link/audit counts reconciled inside a read-only transaction; and
- the disposable database was removed after the process exited.

The run also found and fixed a PostgreSQL parameter-type ambiguity in the canonical design-review update. `src/pre-projects/design.service.spec.ts` then passed 35 tests and Business Core typecheck passed before the full fixture rerun.

## Remaining release boundaries

This fixture does not validate Palm's live people/teams, exact CRM field decisions, regional tax/compliance, connected Meta/PlyLeads, email/WhatsApp receipts, physical mobile devices, clone migration, domain/TLS, or deployment. Those remain explicit P02, P06.3, P09 and control-plane acceptance work.
