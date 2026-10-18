# Palm project entry and planning journey

Status: historical entry notes. The later client-confirmed flow in [Palm flow v2 acceptance](qa-projects/palm-flow-v2-acceptance.md) governs Palm implementation and release checks. In particular, the earlier single-quotation ordering below is superseded.

## Entry and roles

An enquiry is captured in Sales and qualified to an opportunity. Requirements, the applicable first quotation, QS review, client approval, agreement, Finance-verified payment and Owner/Admin approval stay in Sales preparation. Only that first paid, approved Deal File opens one Project Ref and linked project. A member needs `pre_projects.view`, `pre_projects.create`, and `crm.opportunities.view` to start preparation for an existing open or won opportunity. Turning a qualified lead into an opportunity additionally needs `crm.opportunities.manage` and `crm.leads.manage`. A member without create access sees an explanation instead of a dead action.

## Project fields and destinations

The Projects planning list shows only linked projects opened by the first Deal File for Palm; unpaid cases remain in Sales preparation. Requirements contains the brief, measurements, plans and inspiration. After the first payment, a design path begins with site visit and Design & Specifications; its separately reviewed main fitout/furniture quote stays in the same project and Deal File. A no-design furniture path opens at the main paid agreement and skips design stages. Production projects remain under the Production view.

## API and rules

- `GET /api/workspace/pre-projects/candidates?workspaceId=…&search=…` lists open or won opportunities and any existing case IDs.
- `POST /api/workspace/pre-projects?workspaceId=…` with `{ opportunityId }` starts or returns the one linked case. The backend checks role permissions, opportunity state and uniqueness.
- A case cannot be treated as a production project until its commercial and approval gates permit release.

The current sequence is Requirements → first applicable quotation → QS → client approval → agreement/payment → one Deal File/project, then conditional site visit/design, main quotation/QS/client approval/second agreement/payment, material sign-off and applicable delivery. Design and main quotations are distinct rounds with their own immutable decisions; the main round appends to the first Deal File and does not create another project. Each quote remains tied to its reviewed scope and cost revision.

## Verification

Check the Sales preparation start with and without permissions, no eligible opportunities, failed API responses and a successful case creation; confirm the new case opens Requirements. Verify the first paid Deal opens one project, the main round keeps the same Deal, and missing commercial evidence blocks stage movement. Validate desktop/mobile, keyboard and RTL. The isolated Palm smoke now drives both design and main quotation rounds through QS, client, Finance and Owner APIs; it also covers design-only completion and ready-made furniture through its main quotation, while the sub-minimum deposit negative case uses direct synthetic evidence. Production migration and browser acceptance remain required before release.
