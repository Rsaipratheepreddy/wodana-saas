# Palm acceptance tests (PLM-175)

The ten tests Palm asked Wodana to demonstrate before go-live, with the steps to run each one on a workspace where Palm's
configuration is applied (`ops-cli configure --profile docs/fixtures/palm-golive-config.json`): the project BOQ review
and auto-start on (Settings › Projects), the five ordering gates on (Settings › Purchasing), the bespoke release checks on
(Settings › Factory) and the client BOQ section on (Settings › Client portal).

Use a joinery or fit-out job with at least one Core Collection product that has a technical drawing, one with a
verified recipe, one bespoke (path E) item, and one line in the Joinery work package.

| # | Test | Where | Steps | Pass when |
|---|---|---|---|---|
| 1 | An accepted Proposal 2 creates a linked draft BOQ | Opportunity › Quotes, then Projects | The client accepts Proposal 2 in the portal; Finance verifies the agreed upfront payment (the release milestones) | The project starts by itself (or the project managers are told it is ready to start when no PM is set) and Project › Scope shows the BOQ as **Draft**, every line linked to its quotation line |
| 2 | Each quoted product pulls the right Core Collection record and drawing | Project › Scope, line sheet | Open a BOQ line quoted from the catalogue | The line names its catalogue item; a product with a linked technical drawing needs no shop drawing, a bespoke line does |
| 3 | Quoted quantities carry into the BOQ | Project › Scope | Compare the BOQ lines with Proposal 2 | Quantities, units, rooms and rates match the accepted quotation |
| 4 | Material quantities calculate from verified rules | Catalogue item › Recipe, then Project › Scope › Technical handover | The Factory Lead marks the product's recipe **Verified** | The line shows board, fabric, foam, hardware and labour hours worked out from the recipe × the line quantity (with waste and rounding) |
| 5 | Missing technical / factory data is flagged, not guessed | Project › Scope › Technical handover | Look at a line whose recipe isn't verified, and at a bespoke line | They show **Needs factory requirements**; the missing-info checklist counts what is missing; the technical team can't accept the pack until each item is resolved or marked Not applicable with a reason |
| 6 | QS can approve or return a BOQ | Project › Scope (BOQ panel) | The technical team clicks **Verify**; the QS clicks **Return** with a reason, the technical team verifies again, then the QS clicks **QS approve** | Each step records who and when and tells the next owner; QS approval is never counted as the client's approval |
| 7 | Changes create a traceable revision | Project › Scope (BOQ panel), Changes | Approve the BOQ (R-1), then apply a variation | The approval is kept as **BOQ R-1**; the variation returns the BOQ to Draft; the next approval is R-2; the history lists every step |
| 8 | The client cannot see costs or margins in the portal | Client portal › Bill of quantities | Open the portal as the client | Rooms, items, quantities and selling rates only; no cost, committed or margin anywhere (staff without cost access don't see them either) |
| 9 | An order cannot be released while a gate is open | Purchasing › Orders, Factory › Work orders | Try to place an order before the BOQ is QS-approved; then mark one check **Not applicable** with a reason; raise a price above the agreed rate | The order lists each open check and can't be placed; Not applicable is recorded with the reason and who; the work order shows **Client approved the price** as open until the client approves the price correction |
| 10 | Project profitability compares revenue, variations, costs and payments | Project › Money › Profit & loss | Open the project's Money tab | Quoted vs revised revenue (with variations), the QS estimate vs actual and committed cost, payments received, and the margin to date and forecast |

## Notes

- Test 1 needs a project manager on the planning record or the opportunity; otherwise Wodana tells the people who can start
  projects that it is ready, and starting it by hand creates the same draft BOQ.
- Tests 4 and 5 use the factory's own confirmation: a bespoke line's requirements are confirmed per line by the Factory
  Lead; editing them afterwards reopens the confirmation.
- Test 9's checks are each a Purchasing setting, so a firm can switch any of them off; Palm has all five on.
