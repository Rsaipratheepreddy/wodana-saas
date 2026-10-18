# Unified Projects

Projects is the single entry for qualified client work: Planning (qualified enquiries/deals and existing planning cases), Production (active execution and handover), Delivered (completed projects). Existing project case IDs deduplicate planning records. Cancelled planning cases stay out of the active board; on-hold records retain a visible badge. No lifecycle changes occur through board movement.

Data: projects/portfolio plus all paginated pre-projects records, using existing authenticated endpoints and permissions. Qualified opportunities already appear in the planning list without manufacturing projects on a read. Clicking one invokes the existing idempotent case-start endpoint and opens its planning overview; existing cases and execution projects open directly. Production release gates remain in their existing screens. Errors show which source failed rather than pretending the board is empty.

Cards: project title, client, current stage, owner, next action when available. One search and status filter; three responsive columns with counts. No duplicate page heading or repeated create buttons. The separate Planning sidebar item is removed; old case deep links remain valid and activate Projects.

Verification: unified-board tests cover deduplication, lifecycle grouping and connected case creation; workspace typecheck passes. Live board displays the two qualified sample clients and opening the existing Villa case reaches its original planning route. The broader sidebar suite has four failures expecting the previously removed Search workspace control; the new Projects navigation check passes. Existing project deep links remain unchanged. Legacy Planning entry redirects to Projects.

## Corrected client-centric layout

The user clarified that Planning, Production, Deliveries and Inspections are sections belonging to every client project, not separate buckets. The entry now uses a compact semantic table with one row per client project and direct links in these four columns. Existing execution projects retain their planning case link; deliveries opens the project's dispatch view and inspections opens its snags/quality screen. Qualified clients without execution setup show truthful unavailable states. No placeholder execution records are created to enable links. Previous three-column board design is superseded.

Projects uses the compact Sales-style tab bar without a Calendar tab. Factory is a Work sidebar destination at `/workspace/projects/factory`, listing actual execution projects with production and dispatch links. Planning section controls use a single semantic fill spanning the status label and arrow, without nested badges.
