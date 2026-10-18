# Slice 1F — selected offers and split supplier quantities

Journey: record supplier offer → retain revised offers in order → select the latest offer by its exact ID → choose a full or partial quantity and record a reason → draft purchase order → existing spend/release approval. No automatic messages or activation.

Selection records the offer ID, quoted quantity/rate/date/reference, selected quantity, actor/time and reason. Server derives rate/date from that offer, rejects stale or foreign IDs and requires a positive quote. Previous offers remain visible as Superseded; the selected offer stays visible after conversion to an order. Historical orders are not assigned invented selection evidence.

One request batch may be split between suppliers. Existing non-cancelled selections (including draft orders) consume that batch's frozen requested quantity. The next selection and draft quantity edits cannot exceed remaining batch quantity or the selected supplier's offer. This is a batch planning limit; current requirement, stock, commercial and budget checks remain in submission/approval. Cancelled orders release batch allocation. Different request batches still rely on existing requirement/commitment checks; this slice does not introduce a global material reservation ledger.

UI: keep Items / Offers / Receipts / Invoices / Notes inside the existing inspector. Offers gains a State column and the exact selected offer remains inspectable. Supplier comparison shows requested and selected quantities; latest quote selection sends the displayed offer ID. The selection dialog asks only quantity and reason; quoted price/date come from the recorded offer. To negotiate a different quote, record a new offer before selection. Selected draft edits expose quantity, contact and lead time only. Item/supplier identity and quoted rate/date remain locked; cancel a draft selection to release its batch quantity and request corrected terms. No new main tab.

API dependencies: existing record_supplier_offer, award_enquiry, order and restricted vendor submissions. New selection metadata is optional for stored data. RFQ revision/supersession, multiple orders from one supplier request, negotiated order amendments, quote validity and tax/freight terms remain separate slices.

## Implemented and verified

Exact latest-offer selection, retained selection evidence, immutable selected price/date and identity, partial supplier allocation, batch remainder enforcement on selection and draft edits, draft cancellation, and inspectable offer history are implemented locally. Supplier submissions cannot append quotations to already selected RFQs. Invalid offer input is validated before mutation. Shared allocation calculation supplies both the selection dialog default and server checks.

Verification: 58 focused backend tests, 6 focused UI tests, 2 browser checks (desktop/mobile) passed; both TypeScript checks and targeted inspector/comparison lint passed. Browser coverage includes keyboard offer-tab access, RTL overflow, bordered tables and retained Selected/Superseded states; screenshots reviewed. Fixtures and mocked supplier database calls only—no live customer data, supplier messages or deployment. The broader application test suite was not rerun.

Next slice: explicit RFQ replacement/revision links so changed scope can be followed through its history, followed by controlled order amendments. Selected orders currently require cancellation and a new request for changed price/date; no automatic amendment, approval or downstream release is implied.
