# CP04.3 tenant entitlement effects acceptance

Verified locally on 18 September 2026 with synthetic users, organizations, entitlements and offline drafts. No Palm Living data, provider, invitation, physical device or deployment was used.

## Accepted behavior

- Web navigation is built from the active organization’s current `allowedModules`. Every direct `/workspace/...` request independently reloads `/me`, maps the path to its module and redirects an unsold or suspended module to the access-denied screen.
- Business Core remains authoritative. A role grant cannot bypass a removed commercial module, and both reads and commands receive `403` before domain work runs.
- Native module cards use the same `/me` projection. Foreground restoration revalidates it; a server `403` during a stale session triggers an immediate profile refresh, removes the module card and closes an already-open module.
- Once refreshed, native requests for the removed module are rejected locally instead of repeatedly sending stale queued work.
- Project and Pre-execution field queues retain local evidence and move a denied item to **Access changed**. HRMS attendance now follows the same rule: `401/403` becomes an explicit permission state with a discard/review action, while network failures remain safely pending.
- Restoration is reversible: a later active allocation returns the module to `/me`, web direct routes and API commands without rewriting retained records.

## Verification

- Web entitlement/navigation tests: **3 files, 10 tests passed**, including active-organization selection and direct-link allow → downgrade denial → restoration. Web typecheck passed.
- Full native suite: **75/75 tests passed** and native TypeScript check passed.
- Native acceptance includes stale-capability refresh after an API `403`, local rejection of the next queued write, module-card filtering, user/workspace/case queue isolation, idempotent media checkpoints and Project/Pre-execution/HRMS access-change classification.
- Fresh disposable migration and authenticated app-effect smoke passed:
  - a team role granted Projects while the sold allocation omitted it;
  - `/me` omitted Projects and its real API returned `403`;
  - restoration enabled the route and a real workflow-template command;
  - a suspended allocation reduced the profile to Workspace and denied the same command;
  - a new active allocation restored the command;
  - cross-account, suspended-organization and revoked-member denials remained intact.
- The disposable database and local service were removed after the smoke.
- `git diff --check` passed before this evidence update.

## Honest boundary

This closes the local CP04.3 consistency gate. Physical iOS/Android device behavior, real Palm users/data, provider delivery and deployment remain P09 release gates. Offline evidence is deliberately retained for user review after access changes; it is never uploaded after the backend denies the module.
