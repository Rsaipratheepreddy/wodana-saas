# Site survey

Scope agreed 7 September 2026: survey the physical property before design and quotation. Reuse the existing portal theme, compact tabs, pale staggered cards, and short modal steps.

- **Visits:** use the themed month calendar or visit cards; click a day to schedule, and use the portal date/time picker. Both calendars respect the workspace week start, and visit times use an explicit time zone. Schedule a visit in an explicit time zone, assign an active workspace member, record access instructions and outcome, complete or cancel it. Calendar download is optional; it does not notify attendees or synchronize an external calendar.
- **Measurements:** select an existing room or scope item, capture named dimensions and evidence, then verify or request a recheck. Preserve approximate values beside measured values. Room surveys do not require a fabricated scope item.
- **Observations:** record site conditions, services, openings, access and constraints, with private photos/PDFs and optional room, item and visit links. Resolve or reopen with a note.

The visible **Add photos** action opens a short capture dialog from every Site tab. Multiple images/PDFs belong to one observation and can also be attached to a visit or measurement. The attachment count and remaining capacity are visible.

Each save appends history. The server checks case/workspace relationships and record versions. Measurement verification is a distinct permission and action, requires evidence, and records the responsible user and time. An edit returns the new revision to unverified. Earlier verified revisions remain readable.

An item has one survey measurement set. Saving it appends an item specification revision while preserving materials, codes and exact design references. Site-owned dimensions are read-only in the Brief specification editor. Approximate dimensions can still be captured in Brief before the survey. Neither recording nor verifying a site measurement approves a design, calculates a quotation, or releases fabrication.

Site and Brief are now available in the operations web portal and Expo field app. Design stays on web for this delivery. Client portal, external calendar synchronization and execution monitoring remain separate integrations.

Validated with 69 targeted unit/component checks and 61 live API assertions for the initial Site delivery, followed by additional multi-attachment and Design integration checks. Browser verification covered light/dark modes, both calendars, visit scheduling, review/history, and the Brief-to-Site measurement link. Temporary survey fixtures were removed; existing rooms, samples, catalog records and item specifications were retained.


## Field app and photo drawing (7 September 2026)

The Pre-project module opens the same workspace/case records used by the portal. Brief requirements and Site visits, observations and measurements use short three-step editors. Catalog relationships use stable record IDs. Dates are interpreted in the workspace time zone, currencies remain on the case brief, and approximate/measured dimensions stay separate. The field app shares the portal's pure payload serializers and types; API optimistic versions and tenant permissions apply to both.

Camera, multi-photo selection and multiple PDFs attach to one record (20 attachments, 20 MB per file). Completed uploads survive a later upload failure, and retry keeps the same asset ID. Private originals/previews require authentication. The marked-photo editor follows the legacy Flutter measurement annotator: pen colours, thin/thick strokes, Undo, Clear, and Save marked copy. Drawing is enabled on Site and Brief photos; it is not a Design approval or a substitute for structured measurements.

Migration 0039 stores immutable normalized strokes and their original asset relationship under tenant isolation. The server validates point counts, colours and coordinates, composites the marks onto the correctly oriented preview, and saves a new PNG with a private preview. The original image is unchanged. An identical save retry returns the same asset; reusing that ID with different marks is rejected. Opening an existing mark-up loads its original and editable strokes. Photo rendering is bounded to the existing normalized preview resolution; full-resolution originals are retained separately.

Validation: 72 live Site/mark-up API assertions; 35 targeted backend tests; 40 mobile tests; six Design component tests and targeted web lint; mobile and backend typechecks; successful iOS simulator build (zero errors/warnings). Browser interaction verified requirement entry, decimal quantities, quick Design comments and inline replies. The native app displayed the same requirement and Site evidence and opened the drawing editor. A live check through the mobile authentication client saved a multi-file requirement, read private marked-image bytes, rejected a different workspace, and verified comments/retries on an earlier Design revision.

Final visual checks are pending because the Mac locked during the native drawing gesture. The subsequent notch-spacing correction, full drawing gesture/save and native multi-photo picker still need an unlocked simulator; Android has not been device-tested. The isolated Temporary site verification fixture is retained for that check. No existing client project was used for these writes.

The final full web typecheck is blocked by the concurrently edited `apps/web/components/projects/vendor-order-form.tsx` (line 4, missing closing brace). No Projects files were changed by this work.
