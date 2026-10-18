# Local module completion order

Updated user direction: finish web Catalog/Projects, Client Portal, HRMS and Account Settings in parallel. Mobile work is cancelled and no mobile implementation is included. Do not interpret a passing sample or UI polish as completion of the whole module. Local synthetic data only; no deployment or external communications.

## 1. Catalog and Projects — active

Use the 30-section delivery blueprint and its 46 edge cases as the scope register. Preserve existing CRM/Sales controls, white surfaces, pale semantic chips, complete table grids and keyboard access.

Acceptance gates:

- Catalog room/item/variant/component/material/unit/price links feed requirements and specifications, quotation and released BOQ with traceable versions. Master edits cannot silently change accepted commercial scope.
- Planning covers routes, quantities, owners, teams, bookings, dependencies and dates. Verify each role and conflicting assignments.
- Persist all four delivery scenarios: shared factory wardrobes; purchased chairs with partial supply and billing; subcontract painting; post-handover service. Include rejection, rework, shortages, revisions and reversals.
- Reconcile task updates, approved daily quantities, material consumption, QC, dispatch, receipts, installation and signed handover. Prevent duplicate quantities and premature closure.
- Reconcile budgets, orders, supplier invoices, client billing, payments and corrections; verify access boundaries and concurrent/replayed commands.
- Verify shared global task links and project-specific views, uploads, empty/error states, desktop/mobile, keyboard and RTL.

Current evidence is partial. The isolated runner already covers source-to-release and factory-to-installation; this continuation extends persisted signed partial handover and duplicate acceptance checks. Catalog component tests do not prove Catalog-to-BOQ integration.

## 2. Client Portal — parallel UI work authorized

The latest user instruction permits this work in parallel with project closure. Reuse source records; do not create a second project database. Build a single internal review queue for proposed client updates, exact-revision approval/publication, project-level section visibility, preview-as-client and audited unpublishing. Verify file authorization as well as hidden navigation. A UI pass cannot certify these backend publication requirements.

Keep client navigation minimal: overview, progress, approvals/documents, payments and requests/aftercare. Show approved project design images and progress photos with dates and captions. Do not use stock imagery as evidence of completed work. Issues and delays need an accountable owner, recovery date and approved client wording. Publication and client acceptance are distinct events.

## 3. HRMS — active parallel audit and fixes

Audit existing HRMS implementation and its own plan before changing it. Connect employee identity, role, team, working calendar and availability to project resource booking without duplicating people records. Attendance, leave, shift conflicts and employment changes must update availability with permission and history safeguards. Confirm remaining payroll/compliance scope from the existing product requirements before implementing those areas.

## 4. Account Settings — active parallel audit and fixes

Verify profile, organization settings, sessions and security controls using existing authorization. Preserve drafts and expose actionable errors; never report a failed security operation as successful. No real account credentials or security settings are changed during verification. Use mocked tests for MFA/session changes and local synthetic accounts for acceptance.

## Mobile — excluded

The user explicitly cancelled mobile work. No mobile app redesign or device implementation is being performed.

## Completion reporting

Record implemented behavior, automated tests, persisted acceptance evidence, UI verification and known gaps separately. A failed check remains open until corrected and rerun. Do not mark Projects finished merely to move to the next module.
