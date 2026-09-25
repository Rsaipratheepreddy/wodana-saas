# Vendor directory

Implemented as the first backend checkpoint of Catalog and Sourcing. Vendor identity is now workspace-owned master data instead of free text embedded in a price or purchase order.

## Boundary

- A vendor may exist without a catalog offer, store, contact or address. Draft records need only a name. Activation requires at least one capability.
- A vendor can have multiple supplier-owned branches, stores, offices, warehouses or factories. These locations are not Wodana inventory locations.
- Catalog products and services are not forced to have a vendor. The supplier-offer checkpoint connects zero or more dated purchase offers to an active catalog record and active vendor.
- Customer quotations never expose this directory. Purchase costs, selling prices and procurement commitments remain separate records.
- No bank or payment credentials are stored in this directory.

## Safety

`workspace_vendors` and `workspace_vendor_sites` use composite workspace identities, forced PostgreSQL RLS and no application-role delete grant. Vendor code, registration number and tax registration number are unique within a workspace. Names may repeat because distinct legal suppliers can trade under the same name.

Creates use caller-supplied UUIDs for safe exact retry. Updates and lifecycle commands use optimistic versions and row locks. Primary-location changes are serialized per workspace and version the displaced location. Archiving keeps history; restoring a vendor returns it to Draft for review, while restoring a location never makes it primary implicitly.

Owner and administrator roles receive `vendors.view` and `vendors.manage`. Other roles must be granted access deliberately. Vendor, Catalog and Procurement display terminology has a stable workspace override key and retains the current wording by default.

## API

- `GET/POST /workspaces/:workspaceId/vendors`
- `GET/PATCH /workspaces/:workspaceId/vendors/:vendorId`
- `POST /workspaces/:workspaceId/vendors/:vendorId/lifecycle`
- `POST /workspaces/:workspaceId/vendors/:vendorId/sites`
- `PATCH /workspaces/:workspaceId/vendors/:vendorId/sites/:siteId`
- `POST /workspaces/:workspaceId/vendors/:vendorId/sites/:siteId/lifecycle`

The list is keyset-paginated and supports status, capability and text search. All mutations are permission checked and emit audit/outbox events in the same transaction.

## Project procurement consumer

Procurement → Suppliers exposes the shared directory through the existing permission-checked vendor APIs. Staff can add a draft, maintain its primary contact and activate it. New purchase orders select an active supplier identity; legacy free-text order records remain editable without silently creating duplicate master records.

`request_supplier_quotes` is an execution command with the existing project lock, revision and request-ID retry protection. It resolves up to 25 active workspace supplier IDs server-side, snapshots the supplier identity and primary contact, and creates one enquiry per supplier for a material requirement. The batch is atomic, open duplicate supplier/material enquiries are rejected, and enquiries create no purchase commitment. Requests share a batch ID and retain a response deadline.

Each enquiry uses the existing restricted supplier response page; replies feed supplier comparison and the selected offer becomes a draft order. WhatsApp sharing opens a prepared message with that supplier's private link. It does not automatically send, report delivery, or broadcast supplier links. Localhost/private app addresses and missing international phone numbers do not offer WhatsApp sharing. Automatic WhatsApp Business dispatch and provider receipt reconciliation for supplier identities are not implemented by this consumer.

### Excel supplier import

Procurement → Suppliers includes Import Excel and a sample workbook download. The browser reads `.xlsx`, CSV or TSV (2 MB maximum), preserves text phone numbers, and validates up to 500 supplier rows. The sample uses a `Suppliers` worksheet with headers in row 1 and a separate `Instructions` worksheet.

`POST /workspaces/:workspaceId/vendors/import` accepts `preview` and `commit` modes. Both require `vendors.manage`. The server validates nested rows, checks duplicate names/codes/emails against the workspace (including archived suppliers), and rechecks under the directory lock at commit time. Existing matching suppliers are kept unchanged. Conflicting identities block the whole batch. Creation of draft suppliers, primary contact locations and audit events uses one tenant transaction; retrying a completed import skips existing matches rather than adding duplicates. Imports do not activate suppliers or send messages.
