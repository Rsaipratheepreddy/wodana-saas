# Project initiation and released packages — local acceptance

P08.1 is accepted as a local engineering slice. No Palm production tenant, client data, deployment or invitation was changed.

## Accepted flow

1. Commercial release checks the exact accepted quotation, Deal File, approved design baseline, material evidence and required finance truth before a delivery project can exist.
2. The project freezes the quote/hash/value/currency, accepted scope-line lineage, approved design and material revisions, agreement/payment references and release identity. A retry fills only missing additive projections; it does not replace the baseline.
3. Every newly released scope line receives one durable planning package. Replays are idempotent, a line cannot belong to two active packages, and accepted deductions block affected packages for re-planning rather than deleting history.
4. Tasks resolve their package from released scope instead of trusting a free-text package label. Work cannot start until the package has an accountable owner, compatible route and factual readiness.
5. The project adopts and freezes the tenant's active default workflow at release. Later template edits therefore cannot rewrite an active project's stage meaning.

## Palm mapping

[`palm-project-workflow.json`](../../fixtures/palm-project-workflow.json) is an API-ready local tenant configuration, not generic hardcoding. It maps Palm's planning-to-handover process to fifteen distinct stages:

- New Project
- Concept & moodboard
- Space planning
- Renders
- Awaiting Client Approval
- Technical Drawings
- Material Selection
- Costing / BOQ
- Procurement
- Ready for Manufacturing
- Manufacturing
- Site works
- Installation
- Snagging
- Complete / Handover

Owner Review and Deal File stay pre-release commercial gates rather than being repeated as project stages. The later requested planning sequence (Requirements, Design Quote, Design & Specifications, Approvals, Fitout / Furniture Quotations) remains in the planning case before production release. When that approved case is commercially released, the Palm delivery project adopts this frozen workflow at Procurement; the earlier decisions remain in the linked case and are not falsely replayed as new project activity. Templates without a release entry still begin at their first stage. Procurement cannot advance until production-bound packages have passed readiness; the Manufacturing transition checks the live contracted production payment, and task start retains its own release and readiness checks. Palm browser and real-role acceptance are still pending.

## Hold semantics

`On Hold` is a project control with a reason, owner, timestamp and append-only hold history. It is not a workflow stage. A hold blocks forward stage movement, new work and completion but preserves the current stage, packages, tasks and prior evidence. Releasing a hold resumes from the same stage.

## Verification

- Focused project release/workflow/readiness suite: 3 files, 28 tests passed.
- Project workspace and workflow-strip UI suites: 23 tests passed; workflow-template editor suite: 3 tests passed.
- Business Core and Web typechecks, and the Web production build passed.
- Full Business Core regression: 190 files passed, 1 skipped; 1205 tests passed, 10 skipped.
- The isolated Palm synthetic funnel passed from intake through project release with the persisted fifteen-stage workflow starting at Procurement. Its local database was disposable; this is not production UAT.
- `git diff --check` passed.

## Remaining boundaries

- Applying this fixture to an isolated Palm clone and completing two-role browser/mobile UAT belongs to P00.5/P09; the synthetic local run is not evidence of live Palm configuration.
- Supplier lead times, HRMS capacity and recovery planning belong to P08.2.
- Regional tax acceptance, physical-device UAT, provider verification and deployment remain explicitly outside this slice.
