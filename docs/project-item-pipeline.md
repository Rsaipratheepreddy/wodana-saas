# Project item pipeline

Implemented locally on 20 September 2026. This replaces the earlier main/subtab navigation described in the section ownership notes.

Project sections are visible tabs. BOQ, materials and stock, procurement, tasks, factory, site, daily progress, budget, QC and files open directly. Related registers use section tabs; there is no Project tools menu. Item planning opens in a modal without a numbered stage strip.

Each released BOQ item independently follows Plan → Source / build → Site work → Quality check → Handover → Accepted. The project state API returns `itemPipeline`, calculated by `project-item-pipeline.ts` from existing linked records. It is not a separately writable status.

- Orders do not imply receipt. Quantities stay separate per material and unit. Returns to suppliers and waste reduce received coverage; issuing stock to work does not erase its receipt.
- Client-supplied materials require receipt without inventing a company purchase. Stock allocation remains on the requirement record.
- Factory inspection remains in Source / build. Dispatch alone does not unlock installation: accepted output must reach the specific receiving task. Active site batches remain visible while later batches are sourced.
- Completed work is not client acceptance. Partial handovers only cover their own tasks. All active tasks need accepted handover coverage before an item appears Accepted.
- Unresolved defects, blockers and overdue work/materials remain visible. Cancelling all tasks cannot complete an item (server mutation guard).
- Item modals link requirements, tasks, defect corrections and handover decisions. Factory dispatch and receiving open from the task in a modal. Requirements offer direct ordering or multi-supplier quotes, and quote creation preserves the requirement context.

Budget, invoices, payments, financial closure, retention and warranty retain their existing commands and permissions. No operational records were seeded or reset for this change.

Domain and UI tests cover quantities, factory handoff, inspection, partial acceptance, cancelled-only work, delay, navigation and action wiring. Local browser inspection covers the pipeline, planning modal and overview navigation. These checks do not establish live accounting OAuth, WhatsApp delivery or physical mobile-device operation.
