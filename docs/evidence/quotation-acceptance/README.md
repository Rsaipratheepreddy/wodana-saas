# P06.2 — revision-bound quotation presentation and acceptance

Local acceptance completed on 18 September 2026. No tenant, Palm Living, provider or deployed environment was changed.

## Product contract implemented

- An issued quotation is accepted only when its stored SHA-256 snapshot still matches the client-visible scope, prices, tax, terms, validity, branding and payment schedule.
- The responsive client quotation and printable document carry the issued snapshot reference. Primary print links also carry the snapshot hash and reject a mismatched revision.
- Expired issued quotations are explicitly labelled **Expired**, explain the recovery path and cannot be decided.
- Optional items remain outside the base price. During acceptance the assigned approver chooses the desired options and sees base, option and final accepted totals before requesting the purpose-bound OTP.
- The durable decision evidence records decision, issued hash, selected option IDs, base/options/accepted totals, approver, time and remarks. The same OTP command safely replays; a changed payload with the consumed challenge is rejected.
- Agreement evidence binds the accepted quote ID, hash, option selection and accepted total. Agreement execution rechecks that binding. Payment milestones, credits, Deal File value/cost/margin, material approvals, change-control scope and released project scope use the accepted selection rather than silently reverting to the base amount.
- Internal cost and authorization evidence remain absent from the client projection. New option selection uses the shared design-system `Checkbox`; the print action uses the shared `Button`.

## Main implementation

- Business contract and snapshot/selection helpers: `services/business-core/src/commercial/commercial.types.ts`, `commercial.domain.ts`
- OTP decision, idempotent replay and downstream option effects: `client-portal.service.ts`
- Agreement/payment/owner-review binding: `commercial.service.ts`, `release-integrity.ts`
- Accepted contract and execution projection: `change-control.ts`, `variation-controls.ts`, `projects/project-release.ts`
- Responsive client review, expiry, option selection and evidence: `apps/web/components/commercial/client-portal.tsx`, `client-quotation.tsx`, `quotation-document.tsx`
- Revision-bound print surfaces: `quotation-print.tsx`, staff/client print routes
- Staff accepted-value views: `commercial-workflows.tsx`, `quotation-list.tsx`, `quotation-document-page.tsx`

## Verification

- Business Core focused acceptance/release tests: 6 files / 35 tests passed.
- Business Core full: 124 files passed, 1 skipped; 748 tests passed, 10 skipped.
- Web focused acceptance/amount/document tests: 3 files / 14 tests passed.
- Web full serial: 144 files / 683 tests passed.
- Business Core, web and mobile typechecks passed.
- Mobile regression: 52 / 52 tests passed.
- Changed web ESLint: 0 errors; two existing quotation-document `<img>` optimization warnings.
- Playwright quotation regression: desktop and mobile, 6 / 6 passed.
- `git diff --check` passed before this evidence update.

## Honest boundary

The printable route is a deterministic, responsive browser print document that users can save as PDF; Wodana does not yet persist a separately signed PDF binary or claim qualified electronic-signature compliance. The immutable commercial evidence is the issued snapshot hash plus the OTP-bound decision and agreement record. Accounting-provider invoices, credits, receipts and allocation truth are P06.3. Physical-device/client UAT and any live release remain later gates.
