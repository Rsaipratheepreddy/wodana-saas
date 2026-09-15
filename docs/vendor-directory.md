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
