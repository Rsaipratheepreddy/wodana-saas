# P05.3 — approved-design production evidence

## Accepted local scope

- Submitting a quotation for internal review captures the exact approved design revisions, protected file assets, source scope/specification revisions and confirmed definition baseline used by that quotation.
- The accepted quotation hash includes that design evidence. Owner approval creates one Deal File containing the exact design evidence and every exact client-approved material selection required by the quotation.
- Project release recaptures the current approved evidence and rejects release when the quotation or Deal File points to a different design asset/revision, a changed definition/scope revision or different material approval evidence. The recovery instruction is a revised quotation or controlled Change Case; evidence is never silently substituted.
- The released project package carries the immutable material approvals and generated approved project documents for the exact design revisions. Each generated document resolves through the existing protected project-file route to the originating pre-execution asset.
- Factory/site task readiness continues to require the captured approved project document for every linked scope line.
- Native mobile now presents a compact assigned-design-review queue for the signed-in staff member. It shows only current revisions in internal review that are assigned to that actor, identifies the exact revision/source/file, opens the protected file, and supports the existing approve or request-changes contract. Design authoring and client decisions remain web-first.

## Contract and integrity notes

- Design comparison deliberately ignores capture time and preview generation state; neither changes the contractual file. It compares definition hash, scope/specification versions, design/version/asset identity, filename, MIME type, byte size, revision and approval evidence.
- Material comparison deliberately ignores the rotating decision challenge and internal approver identifier. It preserves the contractual selection, revision, decision, attachment/note and approval outcome.
- Release remains transactional and tenant-scoped. Existing project-file authorization is reused; no public asset URL was introduced.

## Verification on 18 September 2026

- Business Core focused production-evidence suites: 4 files, 23 tests passed.
- Business Core full suite: 123 files passed, 1 skipped; 731 tests passed, 10 skipped.
- Business Core typecheck passed.
- Web focused suites: 3 files, 22 tests passed; final changed-area run: 2 files, 15 tests passed.
- Web full serial suite: 143 files, 676 tests passed.
- Web typecheck and changed-file ESLint passed.
- Mobile typecheck and all 52 tests passed.
- Expo Doctor reported 20/20 checks passed against the repository's Expo SDK 55 / React Native 0.83 stack.
- `git diff --check` passed.

## Boundary and remaining acceptance

This is local implementation evidence, not a Palm/live release. No production tenant, invitation, domain, provider or deployment was changed. A physical-device review was not run in this slice; mobile confidence is typecheck, native logic tests and Expo Doctor. Rejected, expired and superseded revision behavior, multiple-room/round-limit acceptance, the complete client-safe view and permission-boundary matrix remain P05.4. Broad migration of older commercial/project feature markup to the shared component catalogue is not claimed by this task.
