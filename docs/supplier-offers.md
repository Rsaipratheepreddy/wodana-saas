# Supplier offers

Implemented as the second backend checkpoint of Catalog and Sourcing. It connects zero or more vendor purchase offers to a catalog item without putting vendor identity, purchase cost or procurement decisions inside the catalog master.

## Boundary

- A catalog item may have no supplier, one supplier or many suppliers. An offer may apply to the vendor generally or to one active vendor-owned branch, store, office, warehouse or factory.
- An offer records purchase terms only: supplier SKU, unit cost, currency, quantity tier, minimum order quantity, order multiple, lead time, validity, evidence, tax treatment, inclusions and notes. It never records or exposes a quotation selling price.
- Quantity-tier eligibility, minimum order quantity and order multiple are separate facts. The API does not pretend an offer can fulfil the requested quantity merely because its tier applies.
- A missing price is different from a genuine zero cost. Zero is accepted only when the source is explicitly `included`.
- Catalog records, vendor records and supplier offers keep separate identities and versions. Creating or changing an offer never mutates catalog master data.
- Supplier selection and commitment happen later in procurement. The options API returns valid choices in stable vendor order and never silently chooses the cheapest.

## Lifecycle and history

Draft offers may be incomplete and can be edited. Activation requires an active vendor, active optional location, active purchasable catalog record, active unit from the same catalog, amount, currency, effective date, attributable source reference and confirmed tax treatment.

Active offers are immutable. A commercial change is represented by archiving the prior offer and creating a replacement, preserving what earlier decisions were based on. Offers for the same vendor, location, item, unit, currency and quantity tier cannot have overlapping active validity periods. Different currencies, locations, units and quantity tiers may coexist.

Lifecycle calls use optimistic versions and durable request IDs. Exact retries return the original response; reusing a request ID for different intent is rejected. Concurrent activations are serialized by workspace so overlapping records cannot both become active. Archiving a vendor, its referenced location, a priced catalog record or its unit is blocked while an active offer depends on it.

## Security

`workspace_supplier_offers` and its command ledger use composite workspace identities and forced PostgreSQL row-level security. The application role has no delete grant. Owner and administrator roles receive `supplier_offers.view` and `supplier_offers.manage`; vendor-directory access alone does not reveal supplier costs. Every mutation writes an audit/outbox event in the same transaction.

## API

- `GET/POST /workspaces/:workspaceId/supplier-offers`
- `GET /workspaces/:workspaceId/supplier-offers/options`
- `GET/PATCH /workspaces/:workspaceId/supplier-offers/:offerId`
- `POST /workspaces/:workspaceId/supplier-offers/:offerId/lifecycle`

Lists use keyset pagination and support status, vendor, catalog item and text filters. Applicable options require item, unit, currency, quantity and an optional validity date, then return the most specific eligible quantity tier for each vendor/location. When the date is omitted, the workspace's configured time zone determines its current business date.

## Deferred consumers

Quotation, pre-execution and procurement will consume explicit versioned snapshots in later checkpoints. Existing catalog rate records are not rewritten or silently migrated by this change. Excel review/import will be added after the supplier and assembly contracts are stable; AI-assisted raw-data mapping remains a later optional layer over the same reviewed import contract.
