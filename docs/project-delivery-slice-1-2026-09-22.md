# Slice 1A — item classification and planning

Implements final UX plan G and the route distinction in blueprint 6. Local only. Existing CRM controls and released BOQ source links remain authoritative.

Journey: open item → choose supply responsibility → explicitly choose work location for our/subcontract work → choose site work → save draft or continue → assign owner/dates → add route-appropriate tasks → existing readiness checks. Saving a plan is not approval, booking or execution release.

Field addition: optional workLocation = factory | supplier | site | office on ProjectWorkPackage. Our team may work at factory/site/office; subcontract work at supplier/site/office. Bought/client-supplied goods need no manufacturing location. Existing records without this field retain their legacy route until reviewed. Site work remains independent. No migration overwrites saved classifications.

Actions: existing work_package command persists classification/owner/dates. Server validates compatible responsibility/location and protects classification changes after linked output, receipts, committed orders or active execution. Incompatible planned tasks also prevent changing the route. Existing status, budget, release and independent-review controls remain.

Task suggestions are proposed titles/locations, never automatically created tasks. Source quantity/unit is shown as BOQ context; a multi-line/missing source must not default to a made-up unit quantity. Detailed many-to-many delivery allocations and confirmed unit conversions remain later work, not implemented by this slice.

Verification: nine route scenarios, invalid combinations, legacy compatibility, authority, preservation after commitments, dates and draft/continue behavior. UI navigation must not lose entered plan fields. Component/backend tests and typechecks; local browser tests where fixture coverage permits. No production activation or external actions.

## Local implementation result

Implemented explicit work location, shared route/task suggestions, incomplete draft saving, failed-save preservation, confirmation before closing unsaved planning, latest operational-field preservation, and server-side classification guards. The existing CRM DataGrid now includes a Delivery plan column; older make/subcontract items show Review location until explicitly classified. Source BOQ quantities appear in the editor; missing or grouped sources leave task quantity/unit blank for deliberate entry.

Validation: 79 backend tests across six project suites, 36 UI tests across editor/items/workspace, and web/backend typechecks passed. Four Chrome checks passed across desktop and mobile, covering navigation, keyboard column controls, RTL and empty-state overflow. Browser coverage uses the read-only empty demo fixture: a populated item editor and persisted complete journey have not yet been browser-validated.

This is slice 1A, not completion of the 30-section blueprint. Next: delivery quantity allocations and item-plan approval/action contracts, including explicit RFA, before deeper procurement and execution. Factory capacity, partial QC/custody, invoices, portals and aftercare retain their documented outstanding scope. No project was activated or deployed, and no customer database records were changed.
