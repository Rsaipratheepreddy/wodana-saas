# Catalog adoption review slice

This slice extends the existing generic workspace catalog. It does not create a Palm Living-only catalog type and it does not import the reviewed workbook.

## Catalog record metadata

Sellable catalog records may optionally include:

- `commerce.pricingMode`: `unpriced`, `fixed`, or `on_request`.
- `provenance.namespace`: a stable source namespace.
- `provenance.sourceKey`: the stable identity of the source item within a catalog.
- `provenance.sourceFingerprint`: a SHA-256 fingerprint used to detect source changes.
- `provenance.reviewStatus`: `needs_review`, `approved`, or `rejected`.
- Optional source file, sheet, and row labels for reviewer traceability.

Source identity is unique inside one workspace catalog. Copying a catalog remains supported because the same source identity may exist independently in another catalog.

Workbook prices are selling-price candidates only. They are not supplier offers and are not activated as rate-card entries until currency, effective date, tax treatment, and inclusions are reviewed.

## Catalog media

Catalog items and variants support:

- one active primary image;
- ordered gallery images;
- ordered technical drawings as images or PDF files;
- generated image previews;
- optimistic versions, idempotent upload IDs, audit events, archive/restore history, file limits, and workspace row-level isolation.

Files are served with private no-store caching, MIME sniffing disabled, and a sandbox content policy. Failed database writes clean up only the new objects written by that request.

## Read-only workbook reviewer

The reviewer reads `.xlsx` data and embedded-image placements with Python standard-library code. It has no database client, tenant/catalog identifier, HTTP route, or persistence function.

It emits item and variant candidates, stable source keys and fingerprints, explicit fixed/on-request/unpriced modes, brochure flags, media candidates, and issues requiring human review. Formulas are reported and ignored. Numeric workbook prices are marked `notSupplierCost` and remain `needs_review`.

Summary-only example:

```bash
PYTHONPATH=services/intelligence-automation/src .venv/bin/python \
  -m wodana_intelligence.catalog_workbook_review \
  "/path/to/Catalog.xlsx" \
  --namespace xlsx:customer-catalog \
  --summary-only
```

Removing `--summary-only` prints the complete review plan to standard output. Neither mode imports or saves anything.
