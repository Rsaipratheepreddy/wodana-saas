# Slice 2C — reviewed handover scope and acceptance

Local only. Partial delivery remains a completed package/area handover, not an arbitrary quantity from an unfinished task. This slice closes integrity gaps before expanding that model.

Preparing a pack reserves its completed task scope against other ready/accepted packs. Returned packs release that reservation; acceptance rechecks it for both portal and signed-record decisions. Quantities, units, task location and area must match the reviewed packet. Signed acceptance validates the existing packet rather than regenerating a new one. Failed packet generation must leave the existing packet/history untouched.

The handover inspector shows the frozen task quantities, units, area, packet version and closeout document revisions in bordered tables, with existing prepare/accept actions. Before preparation it clearly shows planned scope as unprepared. Full-task inspection decisions gain a structured evidence record (reviewer, date, passed/returned, measured quantity/unit), shown on the task. This does not yet introduce quantity-level QC batches or quantity-level client acceptance.

API dependencies remain `inspect`, `handover_status` and authenticated client portal acceptance. No external publication or customer data is exercised during local verification.

Evidence UX: these decision dialogs currently collect text references. Existing record-level Files attachments support images/documents, but direct upload selection and immutable file links on inspection/acceptance decisions remain to implement.

Validation: 42 backend tests and two component tests pass. Desktop/mobile browser checks pass for frozen scope/documents, full grid borders, RTL overflow and keyboard access to signed acceptance; mobile screenshot inspected. Backend/web typechecks and targeted new-component/browser-test lint pass. Existing workspace-component lint issues remain as previously recorded. No live database or production acceptance was exercised.
