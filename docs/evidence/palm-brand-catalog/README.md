# Palm Living brand and catalogue — local acceptance evidence

Verified locally on 18 September 2026. This is a local tenant configuration and regression record, not a production deployment.

## Tenant configuration

- Tenant: Palm Living (`palm-living`)
- Primary surface colour: `#E4E3DE`
- Secondary/action colour: `#000000`
- Heading font token: Alta, with Montserrat fallback until Palm supplies a licensed Alta webfont file
- Body font: Montserrat
- Client-supplied Palm Living wordmark and monogram are stored as tenant assets
- Public tenant discovery, login, workspace shell and shared enquiry forms receive the same brand contract
- Light and dark login appearances were visually checked; the Palm wordmark remains legible in both modes
- The persistent local Operations account completed sign-in, accepted the MFA enrollment grace path, completed all four onboarding steps, entered the workspace and loaded CRM Today
- The team invitation step was intentionally skipped so Palm can test first and later onboard staff through team-based access

## Electrical-material catalogue

Source: Palm Living's `ELECTRICAL MATERIALS` Google Sheet, gid `1237561810`.

- 39 source item rows preserved
- 2 normalized units (`PCS` and `BOX`)
- 41 import records in total
- Duplicate switch names are disambiguated by colour
- Source model codes, colours and row provenance are retained
- Blank source price and quantity fields remain blank; no price, stock or quantity was invented
- Imported items are explicitly marked unpriced and needing specification review
- The Master Data → Materials table was visually verified with all 39 records, both units and `Not set` pricing

The source snapshot is `docs/fixtures/palm-living-electrical-materials.json`. The deterministic mapper and assertions are `services/business-core/scripts/palm-living-fixture.mjs` and `services/business-core/scripts/palm-living-fixture.test.mjs`.

## Verification

- Web typecheck passed
- Business Core typecheck passed
- Mobile typecheck passed
- Tenant-host and colour-token tests passed: 8 tests
- Backend tenant-brand tests passed: 11 tests
- Catalogue fixture assertions passed (`39` source rows, `41` mapped records)
- The isolated Palm end-to-end fixture passed enquiry intake, assignment, SLA/takeover, qualification, requirements, design, quotation, finance gates, execution release and project creation
- The persistent Palm workspace completed onboarding and opened CRM without a server or Jobs loading error

## External boundary

Meta Lead Ads and PlyLeads are not connected because provider credentials/specifications have not been supplied. Shared enquiry links are the approved intake path for now. The application flow is implemented so provider connections can be added without changing Palm's core CRM lifecycle.
