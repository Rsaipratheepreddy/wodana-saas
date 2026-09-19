# Palm-style quotation reference and web drawing parity

Local engineering slice, 19 September 2026. The [Palm estimate sheet](https://docs.google.com/spreadsheets/d/1JYyQIYtjqDR3AFTmNY_jHsGNEDt970ROpUSfyGq6LV0/edit?gid=2132390133) was used as a structural reference, not copied as a spreadsheet UI. Its relevant fields are room, item, inspiration image, L/H/D, requested materials, quantity, unit rate and amount.

The existing room-first quotation builder already selected catalog work/variants, supported authorized manual items, photo upload, material rows, options, tax and totals. This slice adds optional, unit-aware finished-item dimensions through the shared numeric/select controls. The server validates the values, includes them in the client quote and template, and binds changes to the issued revision hash and structural diff. The client document places size beside materials/details and keeps the existing room totals and overall calculations. It does not invent account-manager or estimator fields without a persisted source.

The web already had an authenticated photo-markup endpoint and SVG drawing tool. The shared attachment list now exposes a visible **Draw** action on editable image files in requirements, material references and design uploads/revisions. It saves a separate marked copy against the original. PDF and read-only attachments do not offer the action; the 20-file cap is respected. Pen colours align with the mobile tool. Actual dimensions remain in measurement fields, not inferred from a drawing.

Verification: Business Core quotation pricing 8/8; web pre-project attachment/drawing and quotation-focused tests 20/20; quotation preview Playwright desktop/mobile 2/2; root typecheck and `git diff --check` passed. The visual preview was reviewed at desktop and mobile width. This is local-only; no Palm production data, invitation or deployment changed.

Remaining product work: compare the final Palm legal/approval fields and document wording with Cece in UAT; finish the repository-wide legacy table/control composition cleanup. The template's sample values and logo are not seeded into customer records.
