# Provider adapter engineering evidence

## What this slice establishes

Wodana now exposes one tenant-safe provider capability contract across the Business Core, connected-provider worker and workspace UI.

- The registry covers messaging, lead sources, payments, accounting, e-sign, calendar, storage and AI.
- Google Workspace, QuickBooks, Zoho Books and WhatsApp are the only tenant-connectable adapters reported as implemented. Wodana AI is reported separately as platform-managed and always human-reviewed.
- Meta Lead Ads and PlyLeads are explicitly unavailable until tenant authorization or a provider specification is supplied. Payment gateway, DocuSign, Dropbox, Microsoft 365 and Autodesk are explicitly planned.
- Setup state, connection health, confirmed provider operation and independently received delivery evidence are separate fields. A successful API call is never presented as message delivery.
- Provider actions retain allowlisted endpoints/scopes, one-time OAuth state, encrypted credential references, idempotent writes and safe error handling.
- The integrations screen consumes the Business Core capability response rather than inventing availability in feature markup. It uses the shared fields, buttons, badges, callouts and dialog patterns.

## Local Palm acceptance

A short-lived token tied to the existing local Palm Operations session exercised the real Business Core route for the local Palm workspace. No external provider, production tenant or deployment was changed.

```text
GET /api/v1/workspaces/:workspaceId/integration-capabilities
without authentication: 401
with Palm Operations authentication: 200
provider definitions: 12
implemented tenant adapters: Google Workspace, QuickBooks, Zoho Books, WhatsApp
platform-managed capability: Wodana AI review
Palm connected providers: none
Meta Lead Ads: unavailable / not tested
PlyLeads: unavailable / not tested
```

## Verification

```text
npm --prefix services/business-core run build
passed

npm --prefix services/business-core test -- \
  src/integrations/provider-capabilities.spec.ts \
  src/integrations/integrations.security.spec.ts
Test Files  2 passed (2)
Tests       9 passed (9)

services/intelligence-automation/../../.venv/bin/pytest -q \
  tests/test_providers.py \
  tests/test_google_actions.py \
  tests/test_google_client.py \
  tests/test_google_integration_service.py \
  tests/test_calendar_events.py \
  tests/test_integration_security.py \
  tests/test_notification_adapter.py
47 passed

npm --prefix apps/web run typecheck
passed

npm --prefix apps/web test -- \
  components/workspace/integrations-page.test.tsx \
  design-system/components/components.test.tsx
Test Files  2 passed (2)
Tests      12 passed (12)

npm --prefix apps/web run build
passed
```

The P10.3 integration feature files were scanned for raw `<table>`, `<button>`, `<input>`, `<select>` and `<dialog>` elements; the scan was empty. `git diff --check` passed for the provider-adapter files.

## Remaining boundaries

- This is local engineering acceptance, not proof of a real Palm provider connection or delivery.
- Actual OAuth authorization, provider receipts, failure monitoring and cost checks remain P09.4 and require authorized provider accounts.
- Meta Lead Ads still needs Palm's Meta Business/Page/form authorization. PlyLeads still needs its API or webhook specification and credentials.
- A payment processor and e-sign provider have not been selected, so those capabilities remain planned and cannot be used.

