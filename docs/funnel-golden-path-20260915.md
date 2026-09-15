# Backend funnel golden path — 15 September 2026

The repeatable local funnel proof is:

```bash
npm run test:smoke:funnel
```

It requires local PostgreSQL command-line tools. The wrapper creates a uniquely named disposable
database, applies all registered migrations, builds and starts Business Core with development-only
authentication and portal OTP, runs the journey, stops the server, force-closes test connections,
and deletes the database and temporary file root. It refuses non-local API hosts and unexpected
database or port names.

## Verified journey

1. Create a neutral SaaS workspace and its first owner.
2. Invite and activate a second owner through the public membership APIs.
3. Prove the built-in project-workflow fallback, workspace template versioning, stale-write
   rejection and non-destructive archival, then create a tenant default for new projects.
4. Create a generic CRM pipeline.
5. Submit and idempotently replay a real CRM intake event.
6. Verify the generated Enquiry and Lead, then qualify the Lead into an Opportunity.
7. Start and idempotently replay Preparation from the Opportunity, and create its pre-release
   planning project.
8. Create the room and included requirement, then prove that pricing readiness returns the ordered
   missing site-plan, specification, measurement, and design actions.
9. Add the current site plan, upload the linked design, save its controlled specification, record
   and independently verify the site measurement, pass internal and recorded client design
   approval, then prove that the unfinished Definition blocks pricing with an ordered next action.
10. Publish the client-safe Definition Baseline, idempotently replay publication, confirm the exact
    version through an OTP-backed client decision, and prove that Preparation is pricing-ready with
    a deterministic state hash.
11. Edit the controlled specification, prove that the confirmed baseline becomes superseded,
    publish and confirm its replacement, and restore readiness without modifying history.
12. Import Preparation into a quotation, create and replay a Definition-bound quotation proposal,
    apply and replay it without duplicating imported scope, then set selling terms, pass the same
    readiness gate and internal approval, issue through the enabled client portal, and record
    OTP-backed client acceptance.
13. Record and execute the agreement, submit owner review, approve it with the second owner, create
    the Deal File, and release the delivery project.
14. Verify preserved accepted hash, Definition Baseline, scope/specification versions, selling rate
    and line total, CRM project link, released Preparation state, absence of internal cost/photo,
    and retry-safe release.
15. Verify that the planning project retained its frozen tenant workflow after the template changed,
    advance it through real ownership/task gates, place and release an independent hold, and preserve
    the stage and hold histories.

All business records in this proof are created through authenticated API endpoints. SQL is used only
by the migration runner when preparing the disposable database.

## Result

The completed run passed and returned concrete Intake, Enquiry, Lead, Opportunity, Preparation,
Definition Baseline, Quotation Proposal, Quotation, Deal File and Project identities. A post-run check confirmed no
test API process, temporary database, or temporary file root remained.
