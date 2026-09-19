# Safe customization engineering evidence

## What this slice establishes

Wodana now keeps tenant customization bounded, versioned and reversible instead of allowing silent in-place configuration edits.

- `workspace_configuration_revisions` stores immutable snapshots, source versions, actor/time, changed paths and rollback provenance under workspace RLS.
- Workspace terminology supports save, default restore, history and rollback without rewriting existing records.
- CRM taxonomy options, custom fields and qualification forms retain revisions and support archive/rollback through the bounded CRM settings API.
- Team defaults retain branch, lead, member, role and queue assignments with permission checks, archive semantics, history and rollback.
- Project workflow templates have one tenant-facing shared-component editor, explicit stages/exit gates/default status, immutable history, archive and rollback.
- Quotation and payment templates retain active/archived state, versions, history and rollback. Existing issued quotations keep their copied snapshot.
- Payment schedules now use the shared `DataGrid`, form fields, checkboxes, buttons, inspector and confirmation patterns; no feature-level raw form controls remain in this screen.

The implementation adds variants and behavior to the existing product patterns rather than creating parallel `New`, `Custom`, `Copy` or `2` components.

## Local Palm acceptance

Migration `0101_safe_configuration_revisions.sql` was applied to the local `wodana` database. A short-lived access token tied to the existing local Operations device session exercised the real Business Core HTTP routes for the Palm workspace; no MFA setting, production session, provider or live deployment was changed.

```text
terminology: 6 revisions; rollback passed; original value restored
CRM taxonomy: 2 revisions; rollback passed; synthetic record archived
project workflow: 2 revisions; rollback passed; synthetic record archived
payment template: 2 revisions; restored first milestone to 50%; synthetic record archived and absent from active selection
```

Synthetic configuration records were archived after the run. The terminology value was restored to its original local value.

## Verification

```text
npm --prefix services/business-core run build
passed

npm --prefix services/business-core test -- \
  src/workspaces/configuration-revisions.spec.ts \
  src/workspaces/tenant-management.service.spec.ts \
  src/workspaces/workspace-terminology.spec.ts \
  src/crm/settings/crm-settings.qualification-integrity.spec.ts \
  src/projects/project-workflow.service.spec.ts \
  src/commercial/quotation-template.service.spec.ts
Test Files  6 passed (6)
Tests      20 passed (20)

npm --prefix apps/web run typecheck
passed

npm --prefix apps/web test -- \
  components/commercial/pre-execution-tables.test.tsx \
  components/projects/project-workflow-templates.test.tsx \
  components/workspace/terminology-panel.test.tsx \
  components/workspace/organization-structure-page.test.tsx \
  lib/hrms/routes.test.ts
Test Files  5 passed (5)
Tests      13 passed (13)

npm --prefix apps/web run build
passed; /workspace/projects/workflow-templates generated
```

The P10.2 feature files were scanned for raw `<table>`, `<button>`, `<input>`, `<select>` and `<dialog>` elements and duplicate/fork naming; the scan was empty. List views use the shared column-definition `DataGrid`. Forms use shared fields and controls. Pages use the existing workspace shell. `git diff --check` passed for the touched safe-customization files.

## Remaining boundaries

- This is local engineering acceptance, not a Palm live mutation or deployment.
- Real Palm team/branch assignments still require the authorized people and access matrix before client onboarding.
- Provider-backed document signing, payments and delivery receipts remain P10.3/P09 gates.
- P10.1 legal/tax wording remains gated by qualified UAE/India validation; rollback does not imply legal approval.
- The repository-wide legacy feature-markup migration remains the final P10 component-compliance gate; this evidence claims only the P10.2 screens listed above.
