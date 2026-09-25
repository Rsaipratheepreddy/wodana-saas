# Palm project flow rollback

Live release: `20260922-palm-project-rollback-r1` at https://plm.wodana.ai.

- Restored project-list links to `/workspace/projects/:id/overview` and the existing operational screens. Experimental `/projects/new/:id` bookmarks redirect to the equivalent original project or planning screen.
- Kept the latest quotation builder and enquiries unchanged. Reused the existing colorful SVG icons in the original project navigation.
- Preserved the existing Core Collection and connected demo project. Added the supplied electrical collection: 39 hardware records and two units, with original provenance and no invented prices or stock quantities. A repeat rehearsal added zero records.
- Web and core production images built successfully. Both typechecks passed; 50 targeted web tests and 45 backend tests passed. Public login returns 200 with the expected release header; API readiness and both container health checks pass. Authenticated post-release browser UAT was not performed.
- Migration history verified; no pending migrations. No data reset or destructive reseed.

Verified pre-release backup: `/var/backups/wodana/current/release-20260922T185315Z`.

Operational rollback: `/opt/wodana/releases/20260922-palm-project-rollback-r1/rollback.sh`. The previous service containers remain available. Database restoration is separate; the additive material import does not require an automatic restore.
