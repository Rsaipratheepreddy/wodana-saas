# Palm project flow release gate — 24 September 2026

Status: **local acceptance passed; production deployment not approved**.

## Verified

- Browser fixture, desktop and mobile: project entry; Requirements → Design Quote → Design & Specifications → Approvals → Fitout / Furniture Quotations navigation; Planning/Production separation; delivery section navigation; gated Procurement stage action; successful stage action; dark-theme and RTL stage layout. Eight selected Playwright checks passed without page errors or horizontal page overflow.
- Visual review of light desktop/mobile and dark RTL desktop/mobile captures found the overview had a second, generic “Plan to handover” rail conflicting with the real workflow stage. That duplicate rail was removed. The stage arrow now mirrors in RTL, and the approved-planning note uses automatic text direction.
- Synthetic Palm funnel persisted the fifteen-stage tenant workflow and released a project at Procurement. Local Palm browser and real-role acceptance are not established by the fixture.
- Disposable delivery acceptance passed factory output/QC, dispatch, site receipt and installation, partial signed handover, materials/billing checks, and warranty correction. Evidence: `delivery-2026-09-24T10-51-22.194Z/`. Its database was stopped; no external messages were sent.
- Focused project workspace/strip tests: 25 passed. Web typecheck and production build passed. Business Core full regression previously passed 1,205 tests.
- Follow-up for the two client proposal rounds: read the supplied Design Fee Proposal and itemized Main Fitout/Furniture Proposal. The flow now requires at least AED 15,000 in Finance-verified design payment before the first Owner approval creates the Deal File; a post-payment Site Visit & Scope stage must be recorded before design; later main quotation approvals retain the same Deal File. Sample amounts and customer-specific terms were not copied into defaults.
- Real local API smoke: a AED 14,999 design receipt is rejected without creating a project; AED 15,000 creates one Project Ref; design cannot advance until visit date, scope and evidence are recorded; the main quotation round remains in the same Deal; Ready-made furniture skips factory stages.
- Focused Business Core project/commercial regression: 84 files / 551 tests passed. Focused web project/commercial regression: 66 files / 307 tests passed. Business Core and Web typechecks passed; Business Core production build passed.
- Isolated Playwright release fixture: desktop and mobile project workflow checks passed (one each), including dark theme, RTL, no horizontal overflow, gated movement and stage advance. The locally open browser remains signed out, so this does not establish authenticated Palm tenant UAT.

## Release blockers

1. The working tree contains more than 800 changed or untracked paths, including unrelated CRM, mobile, and platform work. There is no reviewed, isolated release commit or manifest; building the current tree would publish substantially more than the tested Palm flow.
2. The production migration-prefix comparison and production backup/rollback preflight have not run for this candidate.
3. Authenticated Palm role/browser UAT has not run for this candidate. Existing frozen projects have not been migrated to the new workflow automatically.

Do not switch the Palm production vhost until the release scope is isolated, the migration prefix and backup/rollback preflight pass, and authenticated Palm UAT is signed off. Docker is currently healthy. The current public release observed during the earlier review was `20260924-palm-scope-r3`; no production state was changed during this follow-up.
