# CRM qualification and conversion integrity — 15 September 2026

This backend slice makes qualification decisions enforceable and preserves their exact basis through lead conversion. It does not change the CRM user interface or deploy an environment.

## Locked behavior

- A tenant may activate one global qualification form and one form per enquiry type. A matching enquiry-type form takes precedence over the global fallback.
- Active forms require valid questions. Answer values are checked against their declared text, number, boolean, date, select, or multi-select type; required answers are enforced at qualification.
- `false` and `0` are valid completed answers. Select options, scoring values, question counts, answer counts, and answer payload sizes are bounded and validated.
- A successful qualification freezes the selected form version, question definitions, configuration, scoring, answers, capture times, service type, actor, and evaluation time in immutable evidence with a SHA-256 hash.
- Later form edits do not change the decision shown on an already-qualified lead. Qualification answers cannot be edited after qualification or conversion unless the lead is reopened before conversion.
- A linked opportunity receives the same qualification evidence and hash. Direct opportunity creation cannot bypass the lead-conversion command when a lead is supplied.
- One lead can create only one opportunity. An exact lost-response retry returns the existing opportunity; a retry with different conversion details returns a conflict.
- Conversion closes the lead, stops its SLA, moves existing activities to the opportunity, and keeps the next follow-up only on the open opportunity.
- Existing qualified leads and linked opportunities are backfilled with explicit legacy evidence. Database constraints protect qualification state, evidence hashes, active-form scope, and one-opportunity-per-lead invariants.
- The same evidence contract is used when pre-execution starts from a lead, so alternate entry paths cannot bypass qualification integrity.

## Verification

- Focused qualification, settings, conversion, transition, and pre-execution checks: 78 passed.
- Business Core regression: 486 passed, 10 skipped.
- Existing-data migration rehearsal: 18 qualified leads and 18 linked opportunities complete, with zero evidence-hash mismatches.
- Full database-backed CRM lifecycle smoke: passed through intake, assignment, SLA, typed qualification, retry-safe conversion, form-edit immutability, opportunity workflow, and project handoff.
- Fresh isolated lead-to-project funnel: passed with required-answer rejection, typed-answer rejection, evidence transfer, identical replay, and changed-retry conflict.
- Business Core TypeScript check and production build: passed.

Provider-specific connections, frontend integration, and deployment remain separate delivery slices.
