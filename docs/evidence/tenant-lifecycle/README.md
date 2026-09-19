# CP06.1 lifecycle, support and audit — in progress

Local audit on 18 September 2026. This is not CP06 acceptance.

## Existing foundation

- Organization access uses the `active`/`suspended`/`archived` workspace state. Authentication already excludes suspended and archived organizations.
- Onboarding, account contract, collection state and commercial entitlements have independent records; a past-due billing label does not itself change module access.
- Support requests are bounded to eight hours, default to read-only and require a second operator for approval. The operator overview projects elapsed requests as expired.
- Data policy, verified export, dry-run clone/rollback and operator-attributed events exist locally. Erasure remains deliberately blocked.

## Gap fixed in this slice

The support decision command previously checked status/version but not the expiry timestamp. A request displayed as expired could therefore still be approved. The command now rejects approval or revocation after expiry, before a database update, and writes a before/after status/version/access/expiry diff to the operator audit on successful decisions.

The legacy Wodana Control inspector also displayed per-workspace billing fields that the new account-billing authority correctly rejects. Those dead editing controls were removed and replaced by a link to the authoritative Billing and usage view. Its earlier direct status editor is now retired; the operator uses one versioned lifecycle command and review instead.

The lifecycle command now records draft/trial/active/grace/suspended/archived transitions in `tenant_lifecycle_versions`, rejects stale versions and conflicting idempotency replays, requires a reason and operator identity, and writes tenant and platform before/after audit events. Activation checks onboarding, accepted owner invitation, entitlement and seat capacity. Archival requires a retention policy, no legal hold and a current verified downloaded export. The UI shows current state, readiness, notice state and chronological history. A disposable migrated operator smoke passed suspend → trial restore, replay, stale-version and conflict checks. Notice state is explicitly `not_configured` where delivery is required; it is not a claim that an email was sent.

The isolated operator-web smoke also completed the access review with no horizontal overflow. [Desktop review capture](screenshots/cp06-access-review-desktop-light.png).

## Still required before checking CP06.1

- Actual notice delivery and receipts, scheduled effective-date/grace-expiry execution, and session revalidation rules. The current command records immediate transitions and a grace end date but does not send a notice or run a scheduler.
- Export/retention/archival proof and a recovery path; no destructive erasure until verified export consumption and legal-hold policy are accepted.
- Persistent expiry/reconciliation and enforcement for any future support-session data access. Lifecycle before/after audit is now append-only, but support-session access remains a separate enforcement task.
- Focused API, browser/client/native and denied-path tests before CP06.1–CP06.3 can close.

No Palm/live data, device, provider, domain or deployment was touched.
