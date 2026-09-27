# Wodana brand characters

The approved role avatars and the Woddy mascot. This folder is the only source; the apps get copies
through `node packages/brand/sync.mjs` (web `public/brand/…` and the mobile asset folder). Run it after
changing a file here, and commit the copies.

## Role avatars — `avatars/<role>-<f|m>.webp`

256×256, transparent background with the coloured disc baked in, about 11 KB each (32 files, 355 KB).

Roles: `owner`, `sales`, `designer`, `estimator`, `project_manager`, `site_supervisor`, `purchasing`,
`finance`, `people`, `factory`, `carpenter`, `electrician`, `painter`, `installer`, `client`, `default`.
Each has a woman (`-f`) and a man (`-m`).

Rules:

- A role avatar is a **default picture only**. A person's own uploaded photo always wins; the role
  avatar shows when there is no photo, and the initials show only while the picture loads or if it fails.
- The picture follows the person's **main role** through `roleAvatarKey()` in
  `packages/contracts/src/brand.ts` (workspace role codes → avatar role). Unknown roles use `default`.
- `-f` or `-m` is chosen **deterministically** from the person's id (`avatarVariant()`), so the same
  person always gets the same picture and it never flickers.
- Web path: `/brand/avatars/<role>-<f|m>.webp`. Mobile: `assets/brand/avatars/`.

## Woddy — `woddy/<pose>.webp`

Transparent background. `main` is 451×512 (26 KB); the other poses are 256×256 (13–14 KB each).

| Pose          | When it shows                                   |
| ------------- | ----------------------------------------------- |
| `main`        | Brand pages and large placements                |
| `hello`       | Welcome and empty states                        |
| `thinking`    | Loading, while Woddy is looking something up    |
| `working`     | A task is running                               |
| `celebrating` | Done                                            |
| `oops`        | Error, could not do it                          |
| `idle`        | Resting, the small mark in buttons and headers  |

Web path: `/brand/woddy/<pose>.webp`; the `Woddy` component in `apps/web/design-system` renders
them (a subtle idle bob only, none under reduced motion). Mobile: `assets/brand/woddy/`.
