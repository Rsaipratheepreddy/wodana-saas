# Preparation: product research and implementation plan

> Current direction (7 September 2026): the user rejected the standalone preparation UI concept. Follow the current portal and the old portal capture patterns. Mobile and client-portal implementation are deferred. The current catalog starter is accepted. The authoritative next-step plan is [Brief & scope: requirements and item specifications](brief-scope-item-specification-plan.md), covering final requirements, approved 2D/3D revisions, client material selections/codes/references, brands, finishes/finish codes, item details and approximate/final dimensions. The four-tab concept and broader release sequence below are historical research, not the approved implementation direction. See also [catalog decisions and audit](workspace-catalog-master-data.md).


Research date: 7 September 2026. Status: proposal for review, not implemented.

## Recommendation

Build one shared preparation record, organised around actual spaces, with three experiences: the designer's web workspace, the staff Flutter field app, and a client portal that works from the beginning of pre-project. Capture information once, retain the original evidence, and carry a versioned agreed brief into design and eventually execution.

Keep the agreed Preparation navigation: **Brief & scope · Site · Design**. Inspirations live within Brief & scope; survey photos live within Site. Both use the same asset library and stable space identities. This plan includes design documents, revisions and review because Design is already part of Preparation. BOQ, pricing, quotations, contracts, payments, procurement and execution workflows remain separate.

The primary productivity outcome is fewer repeated questions and less re-entry. A designer should immediately see what the client wants, what is verified, and exactly what is still needed.

## What was inspected

The current local SaaS web app was inspected in the browser at `127.0.0.1:3100`, including the pre-project selector, selected-case navigation and Brief & scope placeholder. The older hosted application redirected to sign-in; its capabilities below were verified in the adjacent web/Flutter source and backend, not through an authenticated runtime walkthrough.

| Area | Observed implementation | Planning consequence |
|---|---|---|
| New SaaS | Persisted case linked one-to-one to a CRM opportunity; case-specific routes and preparation navigation. Preparation content is a placeholder. | Extend this case foundation. Do not build a second intake disconnected from CRM. |
| Old requirements register | Requirements, notes, files and client inspirations; room filtering, source links, quantities and contributor information. Its quick-add path currently creates requirements as confirmed. | Preserve capture convenience, but distinguish captured information from reviewed scope. |
| Old reference board | Image, audio, video, document, URL and note support, thumbnails, contributor and time. | Keep multi-format evidence and provenance. Separate purpose from file format. |
| Old Flutter measurements | Camera/gallery, room and optional item, dimensions and units, original and marked image, draft/verified/revisit states and history. Current drawing editor has freehand strokes and raster output. | Preserve camera capture and annotation. Add typed dimension markers and editable annotation geometry as new work, not claimed existing functionality. |
| Old Flutter save rule | Lead measurement requires room, a positive dimension and an image before saving. | Allow incomplete local drafts; enforce evidence requirements at submission/verification so field work is not lost. |
| Old client portal | “Your visual brief” accepts title, room name, notes and multiple images through `/projects/:id/client-selections`. | Bring this capability forward to pre-project; replace free-text room association with stable space IDs and an unassigned option. |
| Old domain types | Requirement review states, priorities, source evidence, room configurations, measurement revisions, readiness and baseline snapshots. | Reuse these domain ideas after mapping them to the new architecture. |
| Old offline foundation | Secure mutation storage, scope keys, retry/error and conflict reporting. Separate strategy calls for durable media jobs. | Audit and extend for the new case API; the presence of a mutation queue does not establish complete offline photo sync. |
| Current theme | Live UI and CSS use lilac–rose–peach brand accents, neutral surfaces and compact typography. Older design-system prose emphasises green/aqua. | Match current rendered styling and current tokens; retain semantic green/warning/error states. |

Evidence pointers:

- [New case and navigation agreement](pre-project-navigation.md)
- [Preparation navigation](../apps/web/components/workspace/workspace-navigation.ts)
- [Current case placeholder](../apps/web/components/pre-project/pre-project-case-page.tsx)
- [Current brand and semantic tokens](../apps/web/styles/tokens.css)
- [New case database schema](../services/business-core/src/database/pre-project.schema.ts)
- [Old unified capture register](../../../Wodana-Frontend/web/components/requirements/unified-requirements-register.tsx)
- [Old evidence board](../../../Wodana-Frontend/web/components/requirements/requirements-evidence-board.tsx)
- [Old portal visual brief](../../../Wodana-Frontend/web/app/(client-portal)/client-portal/[projectId]/page.tsx)
- [Flutter lead survey capture](../../../Wodana-Frontend/mobile_flutter/lib/features/lead_workspace/view/lead_workspace_page.dart)
- [Flutter photo editor](../../../Wodana-Frontend/mobile_flutter/lib/features/project_workspace/view/measurement_image_annotator.dart)
- [Offline requirements](../../docs/mobile-offline-strategy.md)

## Research and implications

These are documented product patterns, not independently measured productivity claims. The Wodana decisions below are recommendations inferred from that evidence and this repository.

| Source | Documented pattern | Proposed Wodana application |
|---|---|---|
| [DesignFiles questionnaires](https://s.designfiles.co/features/interior-design-client-questionnaires/) | Service-specific templates, mobile response, submission tracking and responses stored with the project. | A short initial brief, reusable residential/commercial templates and clearly tracked client requests. |
| [DesignFiles questionnaire workflow](https://intercom.help/designfiles/en/articles/3798654-update-questionnaire-on-behalf-of-the-client-or-request-client-update) | Designer or client can complete the questionnaire. Questions cover reasons, existing furniture, budget, timing, images/links and measurements. | Support live interview capture as well as self-service; preserve who supplied each answer. |
| [Houzz Pro mobile capture](https://pro.houzz.com/pro-help/r/how-to-add-photos-and-videos-on-the-mobile-app) | Batch photo/video capture, audio context, project filing and photo markup. | Keep capture close to the camera, remember the selected room, and attach context before the surveyor moves on. |
| [Houzz Pro files and photos](https://pro.houzz.com/pro-help/r/how-to-access-and-organize-your-files) | Shared file library, bulk upload, permissions, previews and separate team/client comments. | One underlying asset with contextual links and deliberate client sharing. |
| [Mydoma client portal](https://mydomastudio.com/features/client-portal/) | Branded access to project information, presentations, messages and approvals. | Give the client a consistent preparation home and a short list of actions. |
| [NN/g form guidance](https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/) | Related fields grouped together, persistent labels and progressive disclosure reduce the effort of completing forms. | Use small relevant sections, visible labels and conditional questions; keep advanced detail available on demand. |

## Workflow

1. **Start from CRM.** Show existing customer, contacts, opportunity, service type and available property/budget context. Identify imported answers as “From CRM”; request only missing information. A change to a customer's master contact record must be distinct from an answer about this property.
2. **Collect the essentials.** Team member records a conversation or invites the client to complete the same brief. The first pass covers goals, spaces, budget range, timing and decision-makers. Save partial progress.
3. **Build the space list.** Add or duplicate room instances, including multiple bedrooms, floors or office areas. Templates suggest relevant scope; they do not silently include it.
4. **Collect references and site evidence.** Clients contribute inspirations and existing-space photos. Staff conduct visits and measure. These can happen alongside brief collection.
5. **Resolve gaps in context.** A question belongs to the relevant answer, room, requirement, image or measurement. It has an owner and resolved/unresolved state. “Need window width for Kitchen” is more useful than “Site incomplete.”
6. **Record an agreed brief version.** Client confirms the intended work; the responsible designer verifies the reviewed record and outstanding assumptions. Confirmation is tied to the exact published version.
7. **Develop and review design.** Concepts and drawings reference the brief version, spaces and verified survey information. Share selected revisions through the existing planned Approval center boundary.

Collection is flexible, while agreement is explicit. Client confirmation of a preference is different from staff verification of a dimension, and both are different from approval of a design revision.

## Desktop: Brief & scope

Use four secondary tabs: **Brief · Rooms & scope · Inspirations · Review**. Default to Brief for a newly started case; remember the last tab thereafter. Keep the current module sidebar and case switch/back behaviour.

### Brief

An editable summary with small grouped sections:

| Group | Initial information | Ask conditionally |
|---|---|---|
| Project goals | Intended use, reason for the work, top priorities, desired outcome | Renovation pain points, rental/owner responsibilities, phasing |
| People | Decision-makers and who uses the space | Household routines, children/pets, guest needs, work-from-home; or staff headcount, departments and visitors for an office |
| Budget | Range, currency, flexibility, included cost categories and priority areas | Room allocations and allowance assumptions; do not imply a product budget equals a total project budget |
| Timing | Target use/move-in date, possession/access availability, flexibility | Hard events, phased occupancy, dependencies and long closures |
| Preferences | Styles, colours/materials liked or disliked, maintenance preferences | Lighting, acoustics, privacy, accessibility and cultural requirements when relevant |

Use chips, choices and short answers where useful, plus “Not sure yet” and free text. Avoid requiring people to understand style labels. Images and “what I like about this” are valid answers.

Use a reusable residential and commercial base template first. Version the template and answers; leave a general drag-and-drop questionnaire builder for a later iteration.

### Rooms & scope

Make this the designer's main working view: a compact table grouped by space, with inline editing and a contextual inspector. Each requirement shows **requirement · priority · scope decision · review state · evidence**. Owner, quantity, measurement dependency and detail remain available in the inspector or optional columns.

- Stable space instance identity: “Bedroom 1” and “Bedroom 2” remain distinct even if both use the Bedroom template. A room rename does not break files or measurements.
- Store priority separately from scope: Must have / Preferred / Optional; Included / Excluded / Undecided; Captured / Reviewed / Needs clarification. Do not overload a single status badge.
- Describe retained, removed, reused and new elements explicitly.
- Keep whole-project requirements available: painting all included rooms, common material rules, access requirements.
- Support duplicate space, copy selected requirements to selected rooms, bulk owner/priority changes, paste rows and keyboard editing.
- A template creates suggestions for review, not consent or confirmed work.
- Quantity and measurements can remain unknown until relevant. No default zero that looks like a real measurement.
- Keep inclusions, exclusions, client-supplied items and assumptions visible in the final summary.

Example: **Kitchen → base cabinets → must have → included → reviewed**. Its inspector links the client's oak reference, a request to avoid gloss, the survey wall dimension and an open plumbing question.

### Inspirations

A calm visual gallery grouped/filterable by room and source, with a detail panel containing:

- Image, file or reference URL; original source link when provided.
- Room(s), optional requirement/item, contributor and time.
- “What do you like?” and “What should we avoid?”; quick choices such as colour, finish, layout, lighting or storage plus free text.
- Team interpretation and contextual discussion.
- New / Reviewed / Clarification needed; explicit link to an existing requirement or “Create requirement.”

Let clients upload first and organise later. Use **Unassigned** instead of forcing a room choice that the client cannot answer. A reference may belong to several rooms without duplicating the file. URL-only references remain usable if an external site cannot provide a preview; do not promise automatic Pinterest/Instagram imports.

### Review

Show a plain-language summary and a specific gap list. Examples: “Kitchen finish needs a decision,” “Two client answers changed,” “Bedroom window measurement needs verification.” Assign or request only those missing items.

Actions: **Preview client summary**, **Request client confirmation**, and **Record agreed version** subject to the chosen business rule and permissions. Staff-assisted confirmation must record the person, time, channel and evidence, rather than pretending the client clicked a portal button.

## Desktop: Site

Use **Visits · Survey · Photos & plans**. Visits handles appointment and ownership; Survey is organised by the same spaces used in scope.

**Visits:** proposed/scheduled/in progress/submitted/closed/cancelled; assignee, contact, address, visit purpose, access notes, appointment and follow-up. Integrate scheduling with the current Google Workspace work where appropriate. An unavailable calendar provider must not prevent a locally recorded visit.

**Survey:** room dimensions; openings and offsets; ceiling levels, beams and columns; power/data, plumbing, AC and lighting points; retained fixtures; wall/floor/ceiling conditions; and practical site constraints. Use the relevant subsets for the selected service. Record units explicitly, retain original input and normalise for calculations. Irregular rooms need segments or a drawing reference rather than a forced rectangular area.

**Photos & plans:** overview shots, wall/elevation photos, measurement evidence, defect details, retained items and floor plans. Select a room once, then batch capture/upload into it. Associate plans with a revision and source; distinguish a builder drawing from a measured site record.

Measurements move through **Draft → Submitted → Verified**, with **Revisit required** and superseded revisions. A client or AI estimate is visibly unverified. Verification requires a responsible staff member and the evidence required by the survey template. Corrections invalidate affected verification and show what downstream design depends on it.

The main action changes with the job: Schedule visit, Continue survey, Submit survey, or Review measurements. A surveyor should not need to navigate through commercial screens to record a wall dimension.

## One photo and file system

Every upload has a **format** and a **purpose**. “JPEG” is a format; “inspiration” or “measurement evidence” is a purpose. Use the same reusable uploader and asset model across the three products.

| Purpose | Prompt | Common context |
|---|---|---|
| Inspiration | What do you like or want to avoid? | Space(s), requirement, source URL |
| Existing condition | What does this show? | Space, wall/area, visit |
| Measurement | Which dimension is this? | Space/item, value/unit, survey record |
| Constraint/problem | What needs attention? | Space, observation, follow-up owner |
| Plan/document | What is this document and revision? | Property/space, author/source, revision |

Support desktop drop/paste/batch selection, mobile camera/gallery and portal phone uploads. Auto-fill context from the screen. Show thumbnails and per-file progress, pending, failed and retry states; preserve successful files when another fails. Preserve original images plus marked derivatives. JPEG/PNG/WebP/HEIC intake needs tested preview conversion; PDF needs a useful preview. Do not declare an upload saved until its asset and record association are persisted.

Store editable annotation coordinates separately from the rendered preview for future changes. Offer arrow, text, freehand and a dimension marker that references a real typed measurement. Client sharing follows an explicit asset/record audience; internal annotations and comments are not exposed just because a photo is shared. Strip unnecessary location metadata from client derivatives and retain access checks on originals and download links.

## Staff Flutter app

Reuse the supported Flutter app. Preparation is accessible for an assigned pre-project before an execution project exists.

Primary screens:

1. **My visits / assigned cases** with next action and pending sync indicator.
2. **Preparation home** with brief, spaces, visits and missing information.
3. **Room survey** with camera, measurement and note actions close to the thumb.
4. **Photo annotation** with original/marked preview and typed values.
5. **Survey review** listing missing evidence and unverified dimensions.
6. **Sync centre** for pending files, failures and conflicts.

Typical flow: open assigned visit → select Kitchen → capture several photos → annotate the required dimension → add a note → save draft → next room. Keep the room selected until the surveyor changes it. Allow simple interview answers and client inspiration capture during a meeting too.

Offline is part of the first field release: persist draft fields and media before leaving the screen; copy media into durable app-owned storage; queue attachment upload followed by record association; use stable command IDs; survive app restart; retry without duplicates. Display **Saved on this device**, **Uploading**, **Synced**, **Needs attention** honestly. Conflicting edits require reconciliation. Final confirmation and verification happen against the current server version online. Handle logout/workspace switching without losing track of pending work or exposing another workspace's cache.

Later improvements: dictation/transcription, photo-to-room suggestions, Bluetooth measuring devices and platform-specific scan features. Manual recording remains complete without them.

## Client portal, including phones

Introduce a preparation portal tied to a pre-project case and its authorised client contacts. An execution project ID must not be a prerequisite. Use a consistent branded space that can later continue into the project's portal.

Client navigation: **Your brief · Your spaces · Inspirations · Visits · Reviews**. On a phone, show a compact action list and a bottom/overflow navigation adapted to the available width.

- **Home:** only the current requests, upcoming visit and recently shared update. Example: “Tell us your kitchen priorities,” “Add existing-space photos,” “Review brief v2.”
- **Brief:** small sections, clear labels, save-and-resume, “Not sure” and targeted follow-ups. Avoid sending the whole questionnaire again for one missing answer.
- **Spaces:** names the client recognises, priorities and retained items, with an optional photo guide. Clients can suggest a missing room; staff reconcile it with the canonical space list.
- **Inspirations:** upload photos/screenshots or paste a link, optionally choose space and say what they like/avoid. Show acknowledgement and subsequent team questions.
- **Visits:** proposed/confirmed appointment, access instructions and ability to request a different time. Client scheduling changes remain requests until confirmed.
- **Reviews:** a published, versioned brief or design package with comments and explicit confirmation/change request. A like is never approval.

An invitation should deep-link to the specific request while using a verified, expiring access flow. Client participants have individual identities; contributors and decision-makers can differ. Define whether one or several named approvers are required. Publish only selected records; enforce audience and case access in the API.

Scope changes after an agreed version are submitted as requests. They cannot silently replace the version used by the team. The client must be able to see what they submitted and whether the team has reviewed it. The initial client experience is responsive web; a separate native client application is not required for this preparation release.

## Design within Preparation

Use **Concepts · Drawings & specifications · Reviews**.

- Store concept boards, drawings, specifications and supporting documents against the actual spaces and the brief version.
- Let designers assemble a lightweight concept board from existing references or upload a prepared presentation. Advanced freeform editing and CAD creation are outside the initial scope.
- Track document revisions explicitly, retaining comments and review decisions on the exact revision.
- A submission identifies included files, room(s), requested decision, recipient(s), due date and revision.
- Display draft/shared/changes requested/approved/superseded states with explicit scope. Approval of one room or one drawing is not approval of every room or later revision.
- Use one approval record shared with Approval center and the portal. Local Review tabs are contextual views, not independent approval engines.
- Mark concepts based on provisional measurements. Survey changes flag affected drawings for review.

This phase prepares design information for later costing. It does not release procurement, production or execution.

## UI contract

- Preserve the current full-width workspace, compact neutral typography and current sidebar. Use whitespace, subdued backgrounds and structural dividers; avoid surrounding every form section with a bordered card.
- Reuse the current brand gradient for the primary action/identity where the app already does so: lilac `#d6b9f3`, rose `#e4a2bc`, peach `#f39b54`, dark ink `#2f232d`. Reuse semantic tokens for states and dark mode. Do not turn every status into a decorative gradient.
- Keep the case identity, current section, save state and one primary action easy to find. Put secondary actions in their local context.
- Use an inspector only when a row/image is selected. Desktop inspector widths follow the existing 420/560/720 pattern; phones use a full-screen detail screen or sheet.
- Use table editing for staff scope work, a gallery for visual references and guided single-column input for clients. These are different views of shared records.
- Persist draft changes server-side with conflict protection. “Saving…”, “Saved” and actionable retry states are required. A local-only fallback must be labelled as such.
- Aim for 44-point/dp touch targets and 16px phone input text; keep existing compact desktop density. Support keyboard editing, visible focus, screen readers, RTL, reduced motion, dark and high-contrast themes.
- Empty states tell the user the next useful action. Missing, loading, unassigned, offline and forbidden states must remain distinct.

## Shared data and architecture

The repository contains an architecture transition: the root canonical-source document describes FastAPI plus the adjacent web/Flutter repository, while the new SaaS README and running pre-project feature use Next.js plus NestJS Business Core. For this plan, the **new SaaS pre-project case is the target**; old code provides parity and migration inputs. The first implementation packet must document ownership and the Flutter/portal API transition so preparation is not written into two databases. This is an implementation dependency, not a reason to block the product design.

Suggested entities, with tenant/case ownership and audited revisions:

- Preparation brief; template version; answer and provenance; client request and submission.
- Space instance with building/floor/zone as optional parents.
- Scope requirement with priority, inclusion decision, review state and evidence links.
- Asset, derivative, annotation and contextual attachment link.
- Site visit, observation, measurement and measurement revision.
- Clarification/decision attached to a source record.
- Published brief baseline and acknowledgement of its exact version.
- Design document, document revision and submission linked to shared approvals.
- Portal case membership with contributor/approver roles.

CRM stays authoritative for customer identity and opportunities. Preparation owns the evolving brief. Execution later references the agreed baseline and stable space mapping. Do not copy the same room and photo into unrelated pre-project, project and client tables. Subsequent amendments create versions and, when commercial commitments are affected, link to the later variation process.

Use Business Core commands for all new writes, authorised client projections for reads, optimistic revision checks for editing, and idempotency for mobile/retried requests. Media upload/finalisation, processing and record association need explicit state and failure recovery. Intelligence workers can propose extracted answers with source links through the command boundary; they do not directly edit authoritative business data.

## Readiness without a misleading single percentage

Track three distinct milestones and show unmet reasons:

| Milestone | Minimum evidence |
|---|---|
| Ready for concept | Goals, space list, priorities, budget/timing context and identified assumptions; a measurement gap may remain if concept work does not depend on it. |
| Brief agreed | Published version, explicit inclusion/exclusion decisions, resolved critical questions and the required client acknowledgement. |
| Ready for commercial handoff | Agreed brief plus the survey/design evidence required by the selected service; remaining exceptions explicitly accepted by a permitted reviewer. |

No universal photo count or survey checklist should block every service. A furnishing-only consultation and a full office fit-out need different evidence. However, an exception must have a reason and owner; an incomplete field must never appear verified by default.

## Build sequence and acceptance criteria

| Packet | Deliverable across surfaces | Exit condition |
|---|---|---|
| 1. Ownership and shared foundation | Confirm new API ownership; preparation/space/source schema; asset lifecycle; client case membership; Flutter case access; theme component mapping. | One pre-project can be addressed by web, mobile and authorised client without an execution project. Cross-case/tenant access is rejected. |
| 2. Brief and inspirations | CRM prefill, manual capture, room scope editor, basic templates, client questionnaire, reference uploads and contextual requests. | A client adds a room reference; staff see it with its note and source, link it to scope, and request only the missing answer. No re-entry is required. |
| 3. Site and field capture | Visits, shared room survey, original/marked photos, units, verification/revisit, durable offline draft and media sync. | A survey survives airplane mode and app restart, syncs once, and can be verified on desktop with original and marked evidence. |
| 4. Agreement and design review | Gap list, versioned brief confirmation, concept/drawing revisions, client review and shared approval integration. | Client confirms an exact brief/design version; changing it creates a new revision and leaves the previous decision intact. |
| 5. Parity and handoff | Old-record mapping, media preservation, role checks, accessibility and usability validation; baseline reference contract for Projects. | Existing sample references/measurements retain their history and associations; downstream handoff uses the agreed version without duplicate records. |

Mobile and portal work are included in each relevant packet. Do not call the preparation feature complete after desktop-only delivery. Estimate calendar dates after checking existing backend/portal work and mobile migration effort; these are dependency-ordered packets, not a promise of fixed weekly delivery.

### Required verification

- Two spaces of the same type, room rename, one reference linked to multiple rooms and whole-project scope.
- Client input and staff edit arriving concurrently; no silent overwrite.
- Private staff notes absent from portal response payloads and assets, not merely hidden in CSS.
- Expired/revoked client access; contributor versus approver permissions.
- Partial upload failure, duplicate retry, large/HEIC image preview, annotation resize and PDF preview.
- Offline app restart with media; rejected/changed server permissions; a 409/412 conflict surfaced for resolution.
- Client-uploaded dimensions remain unverified until staff review.
- Brief acknowledgement and design approval remain attached to the exact version; later edits show a new review requirement.
- A furnishing-only scope can progress without an irrelevant construction survey; a critical dimension cannot be bypassed without an authorised, recorded exception.
- A residential case and a commercial fit-out both work on desktop, small phone and tablet, including keyboard and assistive-technology use.

### Productivity validation

Pilot with representative designers, field staff and clients. Establish current task times first, then compare the proposed flow. Suggested targets to validate: essentials captured in 5–8 minutes when the client has the answers; a room-linked inspiration added in under a minute; finding the source for a requirement in at most two actions; zero required retyping between the three surfaces. Track questionnaire abandonment, clarification cycles, time to verified brief, duplicate uploads and sync failures. These are proposed targets, not results already achieved.

## Initial release versus later

The initial release needs reliable manual intake, room scope, client contributions, photos/plans, field capture, offline recovery, verification, versioned agreement and basic design-document review. Optional AI summarisation, auto-tagging, transcription, advanced moodboard editing, WhatsApp ingestion, platform scanning and device integrations can follow once that path is validated. A client can still attach a screenshot or paste a link without any social-platform integration.

The first concrete implementation should be **Brief & scope plus client inspiration contribution as one complete slice**, supported by the shared space/asset/case model. Then finish Site with Flutter capture, then the brief agreement and Design review slice. This leaves Preparation coherent before expanding into commercial and execution work.
