# Brief & scope and Design — implementation boundary

Updated 7 September 2026. This records what is implemented and tested, separately from the broader item-specification plan. Use the old application as a workflow reference, not as a layout to copy. The operations web screens use the existing Wodana theme, Leads DataGrid, current pickers, modal and inspector components.

## Purpose and user flow

1. **Catalogs** is a shared destination beside the Pre-projects list. Tenants manage named catalogs, their own groups, reusable records, units, prices and execution configuration. Catalogs does not appear inside a selected case.
2. **Brief & scope** captures the client's needs, budget and constraints; actual project rooms; items, notes, references and inspiration. Users can type a custom item, choose from any tenant catalog, edit table cells or paste up to 100 rows. Initial entry uses a compact three-step dialog: Client need (room, title and raw notes), References (optional files/link), and Optional details. Users can save directly from the first step; “Add another after saving” retains the room and returns to the first step. Catalog links and team decisions stay outside initial capture. Existing links, decisions and specification versions are retained when only raw notes change. A compact tab row separates Requirements, Measurements, Client inspiration and Documents; Project brief and Rooms open in dialogs. Measurements reads the same item specification revisions and opens directly at their dimension fields. The default view is a staggered grid of compact note cards, with room labels, optional authenticated image previews and a small handwritten Notes caption and very pale lilac/blush/peach surfaces from the portal palette; body text and measurements use the normal portal font. Cards and the optional editable table follow one compact filter/action row. Measurement cards read the same structured dimensions and clearly separate approximate and unverified measured values. Switching views does not rewrite records.
3. **Item specifications** opens from the scope table. Each item holds component-level material/brand/finish choices, exact manufacturer codes, stock format, supporting files and recorded client selection evidence. Approximate and measured dimensions are separate. Exact drawing revisions can cover multiple items.
4. **Design** uses named folders and individual files, with bulk image/PDF upload, independent revisions, an assigned internal reviewer and separately permitted staff-recorded client decisions. See `design-folders-and-review.md` for the current flow and client portal integration contract.

Reference behavior reviewed in the legacy frontend:
- `../../Wodana-Frontend/web/components/requirements/unified-requirements-register.tsx`: room-wise quick capture, notes, files and client inspiration.
- `../../Wodana-Frontend/web/components/design/pre-project-design-workspace.tsx`: design files, revisions, internal reviewers and client feedback.
- Legacy client portal and backend design service: case ownership and explicit sharing boundaries. No client is entitled to internal drafts merely because they belong to the same project.

## Data relationships and protection

- Project rooms and scope items have stable IDs. Catalog references retain readable snapshots; later catalog renames do not silently change prior project specifications.
- Component rows have their own IDs and application labels. Manufacturer product and finish codes remain strings, distinct from an internal master code. Choosing a product fills configured codes/format and unambiguous brand/finish links; replacing a product clears unrelated previous choices.
- A changed selected product becomes proposed in the editor and needs fresh client confirmation. The API rejects a changed selected code with reused confirmation evidence. Staff recording a selection are distinct from the named client contact.
- Each specification save appends a revision including the source requirement version, room, quantity/unit, catalog snapshots, materials, dimensions and exact drawing references. Prior revisions remain immutable. A specification is a captured revision, **not a fabrication release**.
- Length measurements keep entered units and normalize mm/cm/m/in/ft to metres. Approximate values remain after measured values are recorded. Site now maintains evidence, measured values and explicit verification history. Quantity is entered explicitly; this screen does not infer a quotation formula from dimensions.
- Drawings have stable document IDs and immutable file revisions. Review state belongs to an exact revision. The current reference view reads that version's current state; specification history preserves the state captured when linked.
- Workspace/case-safe foreign keys, tenant RLS, view/edit permissions, optimistic versions and transactional audit/outbox events protect writes. Bulk entry is atomic. Released or archived cases reject editing. Case files require authentication and remain private.
- Budget stores an explicit ISO currency and amount with currency-appropriate decimal precision. Defaults come from the opportunity/workspace. Changing currency clears the entered amount; no exchange rate is invented. CRM value, client budget and master unit prices are distinct values.

## Current integration limits

These operations screens prepare the project data for later modules. They do not implement quotation generation, BOQ calculation, purchasing or execution release.

Formal requirement agreement and release snapshots, shared Approval center routing, and automatic impact checks for downstream commercial records still need their respective integrations. Site measurement verification and assigned Design review are implemented. Internal review and client decisions here are recorded project history, not an Approval center submission or an electronic signature.

Client portal screens remain outside this operations delivery pending the user's scope clarification. Staff can record a client's selection or design decision with attribution and evidence. A future client endpoint must authenticate the case contact, expose only explicitly shared versions/fields, and keep internal notes and costs private. The workspace APIs must never be reused as an unrestricted client feed. No messages or sharing notifications are sent by these screens.

## Verification

- Live API checks covered currency precision, catalog/unit links, bulk rollback, stale updates, cross-case/workspace rejection, private uploads/downloads, image validation/previews, review transitions, immutable drawing history, specification history and leading-zero codes.
- Targeted web tests cover table row actions, duplicate Enter/blur save prevention, retained failed edits, catalog price/dialog behavior, specification payload boundaries, product replacement, paste parsing and module/case navigation.
- Browser verification covers dark/light themes with Leads gradient primary actions (including modal and drawer footers), compact tabs, focused measurement editing, material lookup, specification save/reopen, code preservation, whole-row design opening, version history and saved review comments.
- Temporary verification cases, records and local files are removed after checks. Append-only audit history remains; existing tenant catalogs and imported data are preserved.

## Local preview

The review server runs on port 8130 against Business Core on 8131. `WODANA_NEXT_DIST_DIR=.next-case-preview` isolates its build cache from another development server using the normal `.next` directory. The default build directory is unchanged when that environment variable is absent.
