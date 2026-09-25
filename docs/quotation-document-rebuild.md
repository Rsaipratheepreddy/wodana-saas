# Quotation document builder

Journey: open a quotation → edit consecutive numbered A4 pages with a shared properties panel → open Scope & Items → collect catalogue/custom items in a basket → add the selection together → edit quantities, materials and photos → preview all pages → save/review/export.

Reference: user-supplied Estimate Proposal 0744 Rev. 5. The cover, image introduction, proposal letter, item schedule, two-column terms and closing artwork form the default. Item pages grow with actual scope; no example client, project, amounts or quoted products are imported. Existing authored layouts are retained and can be explicitly replaced after confirmation.

Fields: editable customer/project/location/contact, quote reference/date, company/client logos, author, brief/letter/terms/closing text, page colour/images, text size/alignment; scope room, description, image, dimensions, quantity/unit/rate, materials and custom columns. Financial summaries always use quotation calculations. Custom items are quotation-local, require the existing price-override permission and a reason; they do not silently create catalogue records.

Dependencies: existing commercial save/revision endpoint, catalogue-options and catalogue media endpoints, existing requirement import, draft/approval/price permissions. Images use the existing validated embedded-image format. Same canvas renderer feeds preview and PDF. Preserve authored pages and existing financial data. Draft changes remain local until Save; save failure retains edits. No deployment.

Checks: template initialization/idempotence, backend presentation validation, basket selection/custom item/permissions, revision-save handling, image visibility, continuous canvas and responsive/RTL layout, actual rendered page overflow and PDF output.
