# Brief & scope: requirements and item specifications

Updated 7 September 2026 from the user's additional requirements. See [current implementation and remaining integration](brief-design-implementation.md) for the tested delivery status; the stages below describe the broader workflow. This is the current implementation plan, not a statement that the workflows below are already built. It supersedes the earlier preparation UI concept. Use the existing portal theme, navigation, room cards and detail drawer. Operations web comes first; mobile and client portal remain deferred. The current starter catalog is accepted for now, with broader product coverage planned for production setup.

The catalog UI was subsequently rejected. Its new prerequisite is the [catalog workbook plan](catalog-workbook-research-plan.md): group tables, generic editable sheets, reusable recipes, named quantity rules, price books and factory/site operation costs. The existing starter data remains available; its acceptance does not approve the current catalog editing workflow.

## Core decision

Every scoped item has one stable identity under its actual project room. Its specification connects the final requirement, item details, exact selected materials/brands/finishes, approximate and final dimensions, and the applicable approved 2D/3D revisions. The item can be opened from Brief & scope, Site, Design and later BOQ without re-entering the same information.

Example: `Bedroom 1 → Wardrobe → WDR-01`. Another wardrobe in Bedroom 2 is a different item even when both use the same workspace work template. Catalog records are reusable defaults; all project selections and agreements belong to the item and its revision.

## Required coverage

| User requirement | Planned record and behavior |
|---|---|
| Final requirement | Original request retained alongside the agreed wording, inclusions, exclusions, assumptions, quantity and unit. Finalization records the exact requirement revision, decision-maker, date and supporting confirmation. |
| Approved 2D/3D design | Separate links to 2D drawings and 3D views/models, with document number, revision, relevant sheet/page/view and approval decision. Link the exact approved revision, not a changing “latest file” URL. One drawing can cover several items; one item can reference several drawings. |
| Client-selected material with code and reference | Component/application, exact product name, internal catalog reference, manufacturer product/model/SKU/decor code as applicable, and sample photo/catalog page/technical sheet/URL. Record the client contact, selection date, captured-by staff member and evidence. |
| Brand | Brand ID and a readable snapshot of the selected brand. Keep manufacturer identity separate from a local dealer or supplier. |
| Finish | Finish type and appearance, attached to the particular material/component or surface: for example matt laminate on shutters and a different finish inside the carcass. |
| Finish code | Exact manufacturer finish/texture/shade code where applicable, preserving leading zeroes and punctuation. Store the collection/product context and a reference. A generic master code such as `MATT` is not a manufacturer's finish code. |
| Item details | Stable item code, room/location, item name/type, description, quantity/unit, construction details, components, fittings/accessories, installation notes, inclusions and exclusions. Allow custom items as well as catalog templates. |
| Approximate/final dimensions | Separate measurement records for estimates and verified final values, with named axes, unit, measurement basis, source/evidence and verification history. Retain the estimate after final values are entered. |

Material code, finish code, item code and internal catalog reference are distinct fields. Codes must be strings; never replace an unknown supplier code with a generated code that appears verified. Use **Pending** for unknown information and **Not applicable** with a reason where the manufacturer genuinely has no code.

## Portal structure

Keep **Preparation → Brief & scope · Site · Design** and the existing shared **Approval center**.

- **Brief & scope** owns the brief, room instances, scope items and their agreed specifications. Preserve fast capture of requirements, notes, photos, files and inspirations. Let a captured request become a scope item or link to an existing item without discarding its source.
- **Site** owns survey evidence and measurement verification. Brief & scope displays those linked measurements and provides a direct route to the relevant survey record.
- **Design** owns drawings/models, uploaded revisions and review submissions. Brief & scope shows the applicable design references and decisions from the same records.
- **Approval center** owns formal approval decisions. A file upload, staff review, client preference and approval are separate events.
- **Pre-project → Catalogs** manages workspace-owned reusable rooms, work templates, material/product references, brands, finishes and units. This replaces the earlier Workspace settings placement. Project choices do not silently change these masters.

The main Brief & scope register stays grouped or filtered by room, using the old portal's compact cards. Each scope card shows the item code/name, a useful photo/preview, short requirement and separate summaries for requirement, design, selection and dimensions. For example: **Requirement agreed · 2D approved · 3D pending · Materials selected · Dimensions approximate**. Search by item name/code, room, material code, brand or finish code. Include filters for missing specifications and changes awaiting approval.

Open an item in the existing detail drawer with these sections:

1. **Requirement & item details** — request, agreed wording, quantity, construction, inclusions/exclusions and source notes/photos.
2. **Materials & finishes** — component rows with exact product, brand, material code, finish, finish code, reference and selection state. Duplicate a row for similar components; explicitly choose whether a room-wide default applies to this item.
3. **Dimensions** — approximate and final values side by side, with evidence and verification state.
4. **Design & decisions** — separate 2D and 3D revision references, previews, comments and approval history.

A final-specification view summarizes the same item records. It is not another independently editable copy. Explicit save, validation and preserved drafts on errors remain the baseline. Avoid making the initial capture form require final product codes or approved drawings.

## Multi-material item example

A wardrobe may require separate rows for carcass board, external shutter laminate, internal laminate, exposed edges, handles, hinges and drawer runners. A countertop may have a different finish from its supporting cabinets. Each row needs an application/component label so that “approved matt white” cannot accidentally apply to every surface.

For each selection, plan explicit fields for:

- Component/surface, product category, selected catalog ID/version or project-specific product.
- Brand, product/collection, manufacturer material/model code, finish name/type and manufacturer finish/shade code.
- Thickness or selected stock format where relevant; these are separate from the finished item's dimensions.
- Sample/product image, reference document revision/page, technical sheet and external URL as applicable.
- Proposed/shortlisted/client selected/change requested/superseded state; any required formal approval has its own decision reference.
- Selecting client/contact, selected-at date, staff recorder, confirmation evidence and the exact selection revision.

For now, staff record client selections received during a meeting, email or other documented conversation. Label this “Recorded by [staff] on behalf of [client]” with its evidence; do not present it as a direct client-portal action. A future portal can submit to the same underlying selection records.

## Dimensions and verification

Use named dimensions appropriate to the item: width, height, depth, length, thickness, diameter, opening/cut-out or a custom named segment. Do not force every item into a rectangular length × width × height formula. Keep count, finished-item dimensions, material stock format and measured area as distinct concepts.

Each measurement revision records the value and entered unit, normalized value for calculations, basis (site opening, finished item, fabrication/cut size or estimated allowance), source drawing/photo/visit, measured-by/date and verified-by/date. Store any specified tolerance or installation allowance explicitly rather than assuming one.

States: **Approximate → Measured / awaiting verification → Verified final**. A changed or conflicting value becomes **Recheck required**. Client-supplied measurements remain unverified until the responsible staff member verifies them. A “final” label on an upload does not establish verification.

Approximate values support briefing, design exploration and clearly labelled preliminary costing. Fabrication-sensitive dimensions must be verified before their item is released for fabrication or purchase. Final site dimensions and final fabrication dimensions can differ; preserve their basis, allowance and drawing revision instead of silently overwriting one with the other. Show unresolved differences between drawing dimensions and survey measurements.

## Decisions, revisions and handoff

Keep requirement agreement, design approval, material selection and dimension verification independent. An agreed requirement can still have pending designs or approximate dimensions. A client-selected material is not automatically ordered, approved for technical suitability or released to production.

For applicable scope, track both required 2D and required 3D deliverables. Each approval records its document revision, reviewer/decision-maker, decision date and scope. If an item genuinely does not require a particular deliverable, record that applicability and reason; do not manufacture an approved document state.

At the appropriate release point, assemble a versioned item specification containing:

- Agreed requirement and item details revision.
- Exact applicable approved 2D/3D revision references.
- Client-selected material/component rows with brand, product code, finish code and evidence; required formal decisions linked separately.
- Verified final measurements for the dimensions needed by that release.
- Remaining explicit assumptions/exclusions and the item revision being released.

Editing an agreed requirement, selected code, approved drawing or verified dimension creates a new revision. Preserve the prior approved specification and show **Change pending** on affected parts. Re-evaluate the relevant approvals and commercial/release dependencies before using the changed values. Catalog renames, archived products or newer manufacturer references must not silently rewrite an agreed item.

Later BOQ, quotation, procurement and execution should reference this item ID and the selected specification revision. Any commercial snapshot must identify whether its quantities were estimated or final. Historical quotations and purchase instructions keep their original snapshots; updates are explicit.

## Implementation order

1. **Extend the catalog contract where needed.** Add first-class manufacturer product/collection code and product-specific finish/shade code fields with reference evidence. Keep current internal catalog codes unchanged. Generic finish vocabulary stays reusable; specific finish codes are scoped to their brand/product collection. Existing generic records can remain unspecified.
2. **Implement Brief & scope item identity and detail capture.** Link actual rooms and scope items to the workspace masters; retain quick photo/note/inspiration capture. Provide the requirement/item drawer and approximate measurements without requiring later-stage approvals.
3. **Implement component material selections.** Allow multiple materials/finishes per item, client selection evidence, staff-on-behalf recording and explicit revisions. Add the final requirement view using the same item data.
4. **Connect Site and Design.** Introduce verified measurement revisions and item-to-2D/3D-document revision links. Use the shared approval workflow for actual decisions rather than editable “approved” checkboxes.
5. **Freeze and carry forward the agreed specification.** Evaluate item readiness at the appropriate handoff, preserve snapshots and manage subsequent changes. Connect commercial/procurement/execution consumers in their respective implementation stages.

The existing Brief & scope draft backend currently has capture entries, quantity/unit and attachments only. It does not yet contain all the structured selections, measurement revisions, document approvals or released-specification records above. Rework that draft before registering its migration; keep the currently working catalog intact. Implement project relationships with workspace/case-safe references, authorization, optimistic concurrency, idempotent writes and audit history.

## Acceptance scenarios

1. Two wardrobes in different bedrooms share a catalog template but retain independent materials, dimensions and agreements.
2. One wardrobe has different inside/outside finishes, each with its own brand/code/reference; a leading-zero finish code survives save/export unchanged.
3. A requirement is agreed while 3D and final measurements remain pending. No unrelated approval is inferred.
4. One approved 2D drawing covers several items; uploading its next revision preserves the prior approval and shows the new revision as pending.
5. Approximate dimensions remain visible after verified final values arrive. A site-versus-drawing mismatch is surfaced before release.
6. Staff record a client selection with named contact and evidence; the history clearly identifies the actual staff recorder.
7. Changing a selected finish code after agreement creates a pending revision without changing historical quotes or released instructions.
8. A catalog rename/archive or supplier SKU change leaves already agreed item snapshots readable and unchanged.
9. Missing information is permitted in drafts, displayed clearly in summaries and checked only at the relevant agreement/release stage.
10. Cross-workspace/cross-case links, stale updates and unapproved release attempts are rejected by the server; failures preserve editable drafts.

Related: [catalog audit and starter coverage](workspace-catalog-master-data.md), [earlier preparation research](preparation-section-plan.md).

## Implemented catalog foundation

The [tenant catalog and recipe implementation](factory-onsite-master-structure.md) now supplies shared items, component recipes, exact product/finish configuration, factory/site processes and a read-only cost preview. Brief & scope should consume those IDs and versions, while storing project requirements, selected products, approximate/final dimensions and exact approved 2D/3D revisions as project snapshots. Previewing a master recipe does not capture a client selection or create an approval.
