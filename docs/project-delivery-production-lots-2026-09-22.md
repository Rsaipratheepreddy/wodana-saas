# Production lots

Journey: approved factory daily output → name a measured lot → independent QC → select that passed lot on a dispatch → independent dispatch approval → site receipt → installation. A production lot is an output quantity, not a resource booking or a shared cross-project run.

Factory task detail reuses the installation batch grid: lot/reference, quantity/unit, QC state, inspection evidence, contextual action. The task team or manager creates the lot; a different reviewer passes it or requests rework. Rework retains review history. Unpassed lots can be cancelled with a reason. Passed lots stay immutable; rejected deliveries use the existing physical-return and independently closed snag ledger. Photo/PDF evidence uses the existing owned project attachment control.

API commands: factory_lot, factory_lot_review, factory_lot_cancel. Payloads use the existing project revision and request ID. Approved output is the only source of lot quantities; active lots cannot exceed it. Output corrections cannot reduce quantities below existing lots. Whole-task inspections and lot inspections cannot overlap. Once output exists, location and inspection policy cannot change. Dispatch approval checks both remaining passed lot quantity and overall remaining QC quantity, inside the existing project transaction. Whole-task QC remains supported when no lots exist. Finished-stock availability excludes output awaiting QC.

This slice does not complete shared factory capacity reservations, split source-task planning, shared time/cost attribution, or the full project blueprint.
