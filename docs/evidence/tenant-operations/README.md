# Tenant operations — local engineering evidence

Date: 2026-09-18

Scope completed locally:

- Plan/module entitlements are versioned, audited and intersected with member permissions.
- Data policy stores quota, retention, legal hold, scan requirement and export-before-erasure policy.
- Managed uploads reserve quota before storage, receive a SHA-256 digest and baseline safety scan state, and retain lifecycle metadata.
- Usage combines governed objects with known legacy brand, discovery, catalogue, HRMS and project attachments.
- Support access is time-boxed, audited and requires a different platform operator to approve it.
- Configuration clone is dry-run-first, idempotent, limited to an empty target, reviewed by a second operator and restricted to setup, terminology, workflows, entitlements and data policy.
- Rollback restores the exact target configuration captured before the selected clone; it does not rewrite operational records.
- Tenant export discovers tenant-scoped base tables, excludes credential/session/provider-command infrastructure, captures member identities plus an object manifest, writes a seven-day system artifact, records its SHA-256 digest and exposes it through an operator-authenticated download that verifies the digest again.
- The internal page composes the shared AppShell, PageHeader, Form controls, Surface, Badge and DataGrid. It contains no raw feature buttons, inputs, selects, dialogs or tables.

Acceptance performed:

```text
Business Core focused tests: 4 files, 15 tests passed
Web tenant-operation tests: 2 files, 8 tests passed
Business Core TypeScript build: passed
Web production build (69 pages): passed
Local PostgreSQL migrations through 0104: passed
Live local operator smoke: passed
```

The live smoke creates two isolated platform operators plus source/target tenants, verifies the requester cannot approve their own support or clone request, creates and downloads a second-operator-approved export, verifies its SHA-256 checksum and payload scope, approves the clone with the second operator, checks the cloned entitlements/data policy, plans a rollback through the other operator, applies it through the original operator, and verifies the target returns to its pre-clone state. Synthetic records and the generated artifact are removed afterward.

Remaining boundary:

- The export contains tenant records and an integrity-bearing object manifest; referenced binary objects remain in governed storage and are not duplicated into the JSON artifact.
- Erasure can be dry-run planned but cannot be approved. The backend returns a conflict and the UI reports that the retention-safe worker is unavailable.
- P10.4 remains open until erasure safely consumes verified export evidence while respecting legal hold, retention, immutable audit and accounting requirements.
