# Palm Living onboarding runbook

From an empty production database to Palm Living working. Rehearsed end to end on an empty local
database on 27 September 2026. No secrets here: every secret comes from the host's secret store.

## 0. Before you start

- [ ] The release you deploy contains `fix(control): every scoped operator role can sign in to Wodana Control`.
  Without it, the first operator cannot sign in and step 2 stops.
- [ ] You have from Palm: the owner's real email, the three teammates' emails and roles, the trade
  licence number, the TRN, the registered address, the logo file, and the budget bands and enquiry
  types they approve (see §9).
- [ ] You have a TOTP authenticator for the operator account.

## 1. Environment (`core.env`, `intelligence.env`)

Set or confirm:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `ENVIRONMENT` | `production` |
| `DELIVERY_ALLOWLIST` | **removed** (Business Core and the worker refuse to start in production while it is set) |
| `AUTH_MODE` | `password` |
| `LOCAL_AUTH_ISSUER` / `LOCAL_AUTH_AUDIENCE` | HTTPS issuer / explicit audience |
| `LOCAL_AUTH_JWT_SECRET`, `MFA_ENCRYPTION_KEY`, `PORTAL_OTP_SECRET`, `BUSINESS_CORE_INTERNAL_TOKEN` | from the secret store (`openssl rand -hex 32`) |
| `PORTAL_DEMO_OTP`, `EXPOSE_DEMO_AUTH_TOKENS` | `false` |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`, `MAILGUN_BASE_URL` | set together; HTTPS base URL |
| `LOGIN_TENANT_SLUG` | empty (never `iglo-architects`); Palm signs in at `palm-living.<domain>` |
| `WEB_ORIGIN`, `BUSINESS_CORE_URL`, `NEXT_PUBLIC_BUSINESS_API_URL` | the production URLs |
| `WODANA_RELEASE_ID`, `INTELLIGENCE_API_URL` | set (required in production) |

## 2. Fresh database and migrations

Follow `infra/hostinger/README.md` → "Start a fresh v2 database" (backup and stop writers first), then:

```bash
sudo -u postgres createdb wodana_release
sudo -u postgres env POSTGRES_USER=postgres POSTGRES_DB=wodana_release \
  POSTGRES_APP_USER=wodana_app POSTGRES_APP_PASSWORD='<from secret store>' \
  sh infra/postgres/001-create-app-role.sh
sudo -u postgres psql -d wodana_release -v ON_ERROR_STOP=1 -c \
  'CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);'
# deploy with APPLY_PENDING_MIGRATIONS=1, or directly:
MIGRATION_DATABASE_URL=postgresql://postgres@localhost:5432/wodana_release \
  npm run db:migrate --workspace @wodana/business-core
```

Check:

```bash
psql -d wodana_release -Atc "select count(*) from drizzle.__drizzle_migrations"   # = entries in drizzle/meta/_journal.json (81 today)
DATABASE_URL=postgresql://postgres@localhost:5432/wodana_release \
  npm run test:smoke:tenant-isolation --workspace @wodana/business-core           # "ok": true
curl -fsS https://api.<domain>/api/v1/health/ready                               # postgres ok
```

## 3. First Wodana operator

On the host (the tool accepts only a localhost database and an interactive terminal):

```bash
OPERATOR_SETUP_DATABASE_URL=postgresql://postgres@localhost:5432/wodana_release \
  node services/business-core/scripts/provision-local-operator.mjs
```

Answer: your work email, display name, role `platform_security_owner`, a strong password.

Then open `https://<domain>/internal/sign-in` → email and password → **Start setup** → add the key
to the authenticator → enter the 6-digit code → **save the recovery codes offline** → Continue.
Check: the Accounts page opens and shows "No accounts yet".

## 4. Create the tenant (Wodana Control → Create tenant)

| Field | Value |
| --- | --- |
| Account name / Organization name | Palm Living |
| Contract contact / Contact email | Palm's contract contact |
| Login address | `palm-living` (shows `palm-living.<domain>` is free) |
| Registered name | Palm's registered name (e.g. `Palm Living Interior Design L.L.C`) |
| Country | United Arab Emirates (AED, Asia/Dubai, en-AE come from the region pack) |
| Firm setup | **Design & build · deal first** |
| Plan / Seats | starter / the contracted number of seats |
| Owner name / Owner email | Palm's owner |

Review → Create tenant. Check on the account page:

- [ ] Owner invitation badge is **Sent** (if not: **Send new link**; the one-time link is shown only
  when email isn't delivered, share it with the owner only).
- [ ] State is **Trial**; when the contract starts, **Change state** → Active.

## 5. Owner activation (with the owner, on a call)

1. Owner opens the email "You have been invited to Palm Living" → **Accept invitation** → sets a password.
2. **Protect your account**: ask the owner to **Set up authenticator** now (not "Set up later").
3. Onboarding wizard:
   1. Company: display name, registered name, country UAE, **Upload logo** (Palm wordmark PNG).
   2. Preferences: AED, Asia/Dubai, English (UAE), Metric, Monday → Save and continue.
   3. Seats & people: invite each teammate with a role (see §7), or Skip for now.
   4. Connections: Skip for now (WhatsApp, Google, accounting are connected later by Palm).
   → **Enter workspace**.

## 6. Company settings (owner, Settings)

| Where | Enter |
| --- | --- |
| Company profile → Edit profile | Registration number (trade licence), **Tax registration number (TRN)**, address, Emirate, City → Save |
| Company profile → Brand colour | `#E4E3DE` (Palm's brand fixture) → **Save colour** |
| Business records → Tax & numbering | **Add rate**: Name `Standard VAT`, Rate `5`, Default on; Prices include tax **off** → **Save tax**. Numbering prefixes default to `PL-QUO-{YYYY}-`, `PL-INV-…`, `PL-CN-…`, `PL-PO-…`; change only if Palm asks |
| Quotations → Pricing / Quotes | Default markup % (Palm to confirm), Valid for **7** days (Palm's terms), **Review before sending on** → Save |
| Design packages | Minimum deposit **AED 15,000** |
| Client portal | **Clients can sign in on**; welcome title and text; support phone, WhatsApp, email → Save |
| Sales → Settings → Options → Enquiry type | Palm's approved list (draft: Renovation / Fit-Out, Full Fit-Out, Interior Design, Interior Design + Furniture, Furniture Only, Concepts / Early Ideas, Architecture / ODG; keep Not Sure Yet) → Save options |
| Sales → Settings → Options → Budget | Palm's AED bands (e.g. Under AED 50,000 · AED 50,000–150,000 · AED 150,000–300,000 · AED 300,000–600,000 · Over AED 600,000) → Save options |

Proposal kit (words, contact block, pictures), from the repo on the host:

```bash
MIGRATION_DATABASE_URL=postgresql://postgres@localhost:5432/wodana_release \
  node services/business-core/scripts/import-proposal-kit.mjs palm-living docs/projects/palm-living/proposal-kit.json
# → "Proposal kit loaded for palm-living (3 terms pictures, 324 KB of pictures)."
```

Check Settings → Quotations → Proposal: introduction, terms, exclusions, contact details and the
pictures are filled.

## 7. Team and access

1. Settings → Roles & permissions → **Custom role** "Sales" → switch on the Sales capabilities
   (enquiries, customers, opportunities, activities, communications, notifications, reports; not
   "erase" or CRM settings), Planning & design: Create / Edit / View planning cases, Supply & catalog:
   View master data → **Save changes**. (The firm kit has no Sales role yet; "Member" cannot open Sales.)
2. Settings → People → Invite each teammate: Sales → **Sales**, QS → **Quantity Surveyor**,
   Finance → **Finance reviewer**, Operations approver if Palm names one.
3. Each teammate accepts the email invite and sets a password.
4. **Before Sales converts anything: the owner converts the first enquiry** (Sales → Enquiries →
   Convert). On a new workspace this creates the default Sales pipeline; a Sales user gets 403 until
   the pipeline exists.

## 8. Day-one checks

- [ ] `palm-living.<domain>/login` shows Palm's name and logo, "Powered by Wodana" only in the footer.
- [ ] Invitation emails show Palm's logo and name, from "Palm Living", "Powered by Wodana" at the foot.
- [ ] Wodana Control → Palm Living → Seats shows the accepted people.
- [ ] Sales creates an enquiry (Emirate, Enquiry type and Budget lists show Palm's values) and the
  owner-converted opportunity appears under Pipeline.
- [ ] A test quote with three lines shows VAT 5 % on the proposal preview and Palm's kit pages.
- [ ] Send for review → QS approves → issue → client portal code → accept → record the advance →
  Finance verifies → owner approves → start the project. Use a staff member's own phone as the
  client contact for this test and delete the test case afterwards.

## 9. Go-live checklist

- [ ] `DELIVERY_ALLOWLIST` removed and `ENVIRONMENT=production` in `core.env` and `intelligence.env`;
  both services restart cleanly.
- [ ] `PORTAL_DEMO_OTP=false`, `EXPOSE_DEMO_AUTH_TOKENS=false`, `LOGIN_TENANT_SLUG` empty.
- [ ] Mailgun sending domain verified; one real invite delivered to the owner.
- [ ] TLS certificate includes `palm-living.<domain>` (`wodana-certificates.timer`).
- [ ] Backup timer enabled and one restore tested.
- [ ] Operator recovery codes stored offline; owner has MFA enrolled.
- [ ] Palm confirmed: enquiry types, budget bands, markup, quote validity, bank details for the
  proposal/invoice, portal support contacts, team list and roles.
- [ ] Account state in Wodana Control set to Active when billing starts.
