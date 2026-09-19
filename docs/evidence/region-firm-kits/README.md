# Region and firm-kit engineering evidence

## What this slice establishes

- Region and firm type are separate, immutable selections in the existing workspace setup snapshot.
- UAE and India v2 region profiles carry independent locale, currency, timezone, calendar, tax, privacy and provider policy structures.
- Tax rates and privacy wording are deliberately empty and marked `requires_validation`; the product does not claim legal or tax approval.
- Design & build v3, interior studio v2, fit-out contractor v2, joinery/furniture v2 and blank v2 are selectable operational kits.
- Every selectable kit has a bounded default project workflow and an explicit list of applicable Job sections. The blank kit does not invent design, factory, survey or site stages.
- Existing workspaces keep their pinned configuration snapshot; new profile versions never silently rewrite tenant setup.

## Verification

```text
npm --workspace @wodana/business-core exec vitest run \
  src/workspaces/setup-profile-catalog.spec.ts \
  src/projects/project-workflow.spec.ts

Test Files  2 passed (2)
Tests      13 passed (13)

npm --workspace @wodana/business-core run typecheck
passed
```

## Remaining release gate

Qualified UAE and India advisers must validate tax treatment, privacy wording, statutory calendars and provider constraints before a region pack is described as compliant or enabled for a production rollout. This engineering slice keeps those values explicitly unconfigured until that validation exists.

