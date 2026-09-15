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
3. Create a generic CRM pipeline.
4. Submit and idempotently replay a real CRM intake event.
5. Verify the generated Enquiry and Lead, then qualify the Lead into an Opportunity.
6. Start and idempotently replay Preparation from the Opportunity.
7. Create the room, included requirement and current site plan.
8. Upload the linked design, save its controlled specification, record and independently verify the
   site measurement, then pass internal and recorded client design approval.
9. Import Preparation into a quotation, set selling terms, pass internal approval, issue through the
   enabled client portal, and record OTP-backed client acceptance.
10. Record and execute the agreement, submit owner review, approve it with the second owner, create
    the Deal File, and release the delivery project.
11. Verify preserved accepted hash, scope/specification versions, selling rate and line total, CRM
    project link, released Preparation state, absence of internal cost/photo, and retry-safe release.

All business records in this proof are created through authenticated API endpoints. SQL is used only
by the migration runner when preparing the disposable database.

## Result

The completed run passed and returned concrete Intake, Enquiry, Lead, Opportunity, Preparation,
Quotation, Deal File and Project identities. A post-run check confirmed no test API process,
temporary database, or temporary file root remained.
