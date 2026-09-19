# CP05.3 tenant billing effects acceptance

Verified locally on 18 September 2026 with synthetic tenant users, billing history and collection transitions. No Palm Living data, physical device, provider or deployment was used.

## Accepted behavior

- `/me` returns an explicit tenant-safe `billingAccess` projection alongside commercial entitlements. Web and native mobile read the same contract, collection state and effect.
- Trial, grace and past-due billing states are visible but do not silently remove modules. Sold entitlement, tenant permission, record scope and organization lifecycle remain separate authorities.
- Any future restricted billing policy must be an explicit versioned lifecycle decision; collection events alone cannot delete data or unlock/lock modules.
- Tenant billing responses expose contract/allocation/collection/usage/document truth without internal reasons, provider external references, idempotency material or metadata.
- Native Billing summary handles unconfigured, current and past-due states and routes to the tenant billing area only when the backend grants billing visibility.

## Verification

- Full native suite: **76/76 tests passed** and native TypeScript check passed.
- Fresh migrated tenant app-effect smoke proved a synthetic past-due transition was visible through `/me` and Billing while `allowedModules` and the effective access policy remained unchanged.
- The same smoke verified public-field redaction, duplicate invoice replay, provider-verification denial, failed receipt to finance verification to refund, orphan-refund rejection, missed-renewal/past-due history and reactivation to current.
- Web billing component tests cover loading, unconfigured access, current history and private-field absence.

## Honest boundary

This closes the local web/native consistency gate. Physical-device UAT, real provider delivery, Palm clone/live users, regional compliance and deployment remain P09/P10 release gates.
