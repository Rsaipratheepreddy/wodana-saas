# Quotation item table — 9 September 2026

## Changes

- Neutral quotation-style table with separate Item and Description columns.
- Materials start collapsed. Expand from the Item cell to open that item's indented material table, with material name and specification in separate columns.
- Description is assembled from current materials and updates immediately in the editor and shared customer-facing preview/document. Existing authored item notes are preserved separately and appended. New catalog selections do not inject catalog codes into the description.
- Item and material units combine a native dropdown with a text field offering browser suggestions: common units, catalog units and custom typed values. Shared catalog lookup is cached; lookup failure leaves common/custom units available. Native menus avoid floating-overlay scroll dismissal at table edges.
- A clear variant chooser supports linked catalog variants and custom variants. Changing a variant preserves current material rows and prices.
- AI is a collapsible side panel, closed initially to maximize table space. Closing/reopening preserves the conversation and unsent input. Manual editing, explicit AI review, retry and duplicate prevention remain available.
- Fixed mobile horizontal overflow caused by absolutely positioned screen-reader labels escaping the quotation scroll container; contained positioning keeps dropdown/modal hit targets aligned.

## Verification

- Web typecheck passed.
- Targeted lint: no errors; three existing inline-image warnings for user-uploaded images/document covers.
- 59 frontend regression tests passed, rerun after the final native unit-selector adjustment.
- 19 backend pricing, commercial domain and description tests passed.
- Six real-browser workflows passed across desktop and mobile: live descriptions, collapsed item materials, catalog/custom units and variants, photos, prices, save/reopen, preview, AI panel persistence, failure/retry and explicit review.
- The unit/variant/description/AI-panel workflow additionally passed twice on each desktop and mobile after the final control change.
- Desktop/mobile screenshots reviewed. Browser fixtures and authentication bypass remain excluded from production images. No customer data or paid AI calls used for testing.

## Deployment

Target: existing VPS, web-only release `20260909-quotation-item-table`, web port 13320.
Previous release: `20260909-quotation-workspace`. Preserve current backend port 18190; no database migration.
Status: live, verified at 2026-09-09 04:18 UTC. Automated backup, production build and proxy cutover completed. The new web container is healthy. Existing deployment script retains the previous release and provides rollback.

Post-deployment checks:

- Public `/login`: HTTP 200, release header `20260909-quotation-item-table`.
- Public API readiness: ready; PostgreSQL healthy.
- Published JavaScript includes native unit suggestions, custom variant selection, item-owned materials, linked descriptions and the collapsible AI panel.
- `/testing/quotation`: HTTP 404 in production.
- Authenticated editing was tested locally with synthetic fixtures; live customer quotations were not modified for verification.
