# Palm enquiry intake and attribution

Local acceptance evidence for P02.1 on 18 September 2026. This slice uses synthetic, disposable data only. It does not deploy, change Palm Living data, connect a provider, or claim that Meta Lead Ads or PlyLeads are available.

## Accepted contract

The local Palm profile is recorded in `docs/fixtures/palm-crm-intake-profile.json` and follows the two supplied client documents:

- source, channel, intake method and assignment method remain separate dimensions;
- the five source families and their documented channels are preserved;
- the eight enquiry types are exact: Renovation / Fit-Out, Full Fit-Out, Interior Design, Interior Design + Furniture, Furniture Only, Concepts / Early Ideas, Architecture / ODG and Not Sure Yet;
- the public form collects name, mobile, email, property location, enquiry type, optional budget and optional project details;
- the seven documented budget choices are available without making budget required;
- the original human-readable answers and exact option IDs are retained together;
- service-contact consent is explicit, required and stored with the form revision, statement and capture time;
- duplicate candidates are retained for review rather than deleting or silently merging the submission; and
- published forms expose a shareable link and QR code without exposing internal source, channel, queue or assignment controls to the visitor.

## Routing and provider truth

The public submission records the form's configured source, channel and `FORM` intake method, then requests automatic assignment as a separate decision. The disposable Palm run confirmed that the resulting lead used automatic assignment.

Shared enquiry links and QR codes are the supported social-entry path for this slice. The Integrations page explicitly labels Meta Lead Ads and PlyLeads **Not connected** and explains the missing authorization/specification. No webhook, delivery receipt or provider capability is implied.

## Verification

The following checks passed:

- Business Core focused run: 4 files, 23 tests;
- Business Core TypeScript check;
- web focused run covering the public form, form builder and integrations page: 3 files, 16 tests;
- web TypeScript check and touched-file ESLint;
- raw-control scan of the changed feature files returned no raw `form`, `button`, `input`, `select`, `table` or `dialog` markup;
- fixture validation returned 8 enquiry types, 7 budget ranges, 5 source families and both external providers as `not_connected`;
- `npm run test:smoke:palm-fixture` passed against a fresh migrated loopback database and cleaned the disposable database on exit;
- the smoke verified exact Palm taxonomy, public-field safety, retained raw answers, persisted consent evidence, automatic assignment and a preserved duplicate candidate; and
- local browser inspection passed for the Forms and Integrations views in light and dark themes. The accessibility tree exposed the complete provider boundary and the shared configured-accounts table without horizontal-page overflow at the inspected desktop viewport.

## Remaining boundaries

P02.2 still owns Palm queue/team routing, team-inherited access, weekend notification policy, the 60-minute elapsed takeover rule and its audit trail. P02.3 owns the staff response workspace on web/native mobile. Real Palm people, provider credentials, delivery receipts, clone migration, physical devices and deployment remain P09 release work.
