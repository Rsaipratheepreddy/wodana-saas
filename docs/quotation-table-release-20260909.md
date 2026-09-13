# Quotation sheet

Release: `20260909-quotation-table` (web 13290, business-core 18180).

- Replaces the room-card workspace with a full-width editable table: room/section → item and variant → materials, finishes, labour and other rows.
- Custom rows and catalog selection are available without opening the old item inspector. Catalog selection copies descriptive information; users enter selling rates in the quotation currency.
- Material quantities and amounts are explicitly per one item unit. Existing quotations retain entered item rates. Selecting material-based pricing makes the backend recompute the item rate from rounded material-row amounts; client-supplied rows contribute zero. Internal unit cost remains private and unchanged.
- Item photos are compressed in the browser, validated and capped on the server. They appear in client preview and print. Reusable templates deliberately exclude client photos.
- Sections can represent delivery, installation or other charges. Discounts, taxes, totals, scope/terms and the payment schedule remain visible below the sheet.
- Client preview/print uses the same breakdown and a compact plain header. Existing catalog/specification data is retained. Refreshing scope preserves the quotation's pricing rows and photos.

No database migration: the new optional fields use the existing quotation JSON document. Client projection, frozen approval hash and execution material descriptions include the new customer-facing fields.

Verification: 72 frontend commercial tests, 46 backend commercial tests, TypeScript for both workspaces, desktop/mobile browser editing/catalog/photo/reopen/preview checks. Browser fixtures use only local storage and intercepted APIs and are excluded from Docker production builds.

Deployment uses `infra/hostinger/deploy-web.native-host.sh`, with `DEPLOY_CORE=1`, `CORE_PORT=18180` and `CURRENT_CORE_RELEASE_DIR=/opt/wodana/releases/20260909-design-approval`. No password is stored in source. The script backs up state and prepares a proxy rollback before cutover. After a later rollback, avoid editing new material breakdowns through the older backend, which does not understand the optional fields.
