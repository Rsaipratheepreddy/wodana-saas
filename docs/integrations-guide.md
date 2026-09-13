# Google, QuickBooks, WhatsApp and Zoho Books

The product placement and delivery order for Meta Lead Ads, QuickBooks and Zoho Books are defined in
[Meta leads and accounting product wiring plan](meta-leads-and-accounting-plan.md).

Implementation and account setup status: 7 September 2026.

## Current status

The local Integration Hub has connection flows and provider tools for all four providers. Automated
tests exercise provider HTTP contracts using mocks. Live checks in the local demo workspace have
also connected Google, QuickBooks sandbox, WhatsApp Business, and Zoho Books. Gmail and WhatsApp
test sends succeeded, and QuickBooks/Zoho authenticated reads succeeded. No accounting transaction
or payment collection was created. Gmail inbound sync still requires one Google reconnect to grant
the read-only inbox scope.

Use **Workspace → Integrations → Set up → choose organization → Save → Connect**. Once consent
succeeds, the account row exposes **Open tools**. Connection status comes from Business Core; creating
a draft does not mark an account connected.

| Provider | Implemented in the Integration Hub | Live verification / remaining work |
| --- | --- | --- |
| Google | OAuth, selected calendars, availability and event APIs, manual meeting creation, optional Gmail send, private Drive text files | Connected and Gmail send verified; reconnect once for inbox read scope; production verification/HTTPS remain |
| QuickBooks Online | OAuth, sandbox/production separation, read customers/items/vendors/invoices/bills/payments/POs/expenses, create invoice, refresh balance and available invoice payment URL, signed change webhook intake | Sandbox connected and customer read verified; production credentials and an eligible activated QuickBooks Payments account remain |
| WhatsApp Business Platform | Meta Embedded Signup, app/WABA/phone verification, scope checks, optional new Cloud API sender registration, approved template list/send, signed incoming messages/media and delivery updates | Connected; outbound sends and CRM delivery status verified; public production webhook/app review still remain |
| Zoho Books | Regional OAuth, exact organization selection, accounting record reads, invoice creation, current balance/status and provider invoice URL | Connected and customer read verified; payment gateway setup and a safe test invoice/payment flow remain |

The tools are usable across operational work, but **automatic synchronization with every Wodana
module is not implemented**. Creating an invoice in Integration Hub does not post it into a Wodana
commercial ledger. WhatsApp inbound messages/media and outbound delivery states now reach the CRM
inbox; Gmail inbound waits for the read-only scope reconnect. The matrix below separates available
manual actions from the next module bindings.

## Who owns which account

Wodana owns the developer applications: one Google OAuth app, one Intuit app, one Meta app and one
Zoho OAuth client per deployment/environment. Each customer grants access to their own accounts.
A connection belongs to a Wodana **workspace and legal entity**. Multiple legal entities can connect
different accounts in the same workspace. Tenant members with `integrations.manage` can connect and
perform outbound actions; `integrations.view` permits reads. Secrets stay in the integration service.

A personal Gmail is valid for testing. The saved email must exactly match the verified Google account;
`gmail.com` alone is not a tenant identity. A Google Workspace business domain can authorize its
configured domain. Gmail and Drive capabilities are optional and require additional consent.

A tenant should connect its own WhatsApp Business Account and sender number through Meta. The Wodana
number is suitable for Wodana's own tenant/workspace. It is not a shared default sender for all
customers. An existing WhatsApp Business app number may be eligible for Meta's coexistence flow;
that must finish successfully. Wodana does not silently migrate or deregister an existing number.
For a new Cloud API number, the setup dialog accepts a six-digit registration PIN, uses it only if
registration is necessary, and does not persist the PIN. See
[Meta's official onboarding sample](https://github.com/fbsamples/business-messaging-sample-tech-provider-app/blob/main/README.md).

For accounting, select one primary system per legal entity as an operating convention. Connecting
both QuickBooks and Zoho is supported, but do not issue the same customer invoice independently in
both: no cross-provider deduplication or master-ledger policy has been implemented.

## Purpose and workflow across modules

| Module | Useful integration workflow | Available now / module work remaining |
| --- | --- | --- |
| Workspace & Organization | Connect the correct accounts, number, region, calendars and legal entity; review access/audit | Connection management and permissions implemented |
| CRM: leads, opportunities and follow-ups | Schedule consultations/site visits; email follow-up; WhatsApp appointment template | Existing CRM calendar read path and Hub calendar/email/template tools; record-linked sends, automatic lead creation and conversation matching remain |
| Pre-project: briefs, estimation, quotations | Save briefing notes to Drive; email quotation/approval links; book design reviews | Manual text-file/email/calendar tools; attachment export, quote conversion and approval-triggered delivery remain |
| Design & approvals | Review meetings, approval reminders, design documentation | Manual tools; design-file upload, folders, document revision linkage and approval rules remain |
| Projects & milestones | Collect design deposits and milestone payments; notify client; check balance | Provider invoice creation and refresh/copy-link tools; linking provider IDs to project/milestone records and automated posting remain |
| Procurement & vendors | Consult accounting vendors, purchase orders, bills and expenses | Read tools available; creating/syncing vendor bills or POs from approved Wodana procurement remains |
| Inventory & catalog | Match materials/services to accounting items | Item lookup for invoices; SKU/unit/tax mappings and stock synchronization remain |
| Production & site execution | Book installations; communicate approved status updates or visit changes | Calendar and message tools; production-triggered bookings, crews and report attachments remain |
| HR & labor | Calendar coordination and operational reminders | Manual tools; payroll, attendance and leave synchronization are outside this implementation |
| Finance | Create customer invoices; obtain invoice URL; check paid/outstanding balance | Provider tools implemented; Wodana ledger reconciliation, taxes, credits/refunds and accounting dashboards remain |
| Client/vendor portals | Show the relevant invoice/payment page and communication history | URLs can be copied; portal record binding and authorization checks for each invoice remain |
| Reports & automation | Delivery tracking, payment alerts, reminders and operational audit | Signed WhatsApp/QBO intake and audit available; scheduled sync/reminders and reporting projections remain |

The intended module architecture is: module command → validate tenant/legal entity and approval →
provider operation with a stable idempotency key → store provider ID against the module record →
verified provider response/webhook → update through Business Core. Each missing binding needs this
record-level path; exposing a connector alone does not supply it.

## What “QuickBooks payment links” means

For project work, use an **invoice payment page**: create an invoice for a customer/milestone, then
refresh that invoice to obtain its current balance and any payment URL returned by QuickBooks.
The implementation uses the accounting API's `include=invoiceLink` read and only displays a trusted
HTTPS provider URL. A missing link stays missing; Wodana does not construct a checkout URL.
[Invoice-link API guidance from Intuit](https://help.developer.intuit.com/s/question/0D5TR000002nScJ0AU/how-we-can-get-payment-link-of-a-specific-invoice-from-where-can-we-get-payment-link-through-api-using-php-sdk-).

QuickBooks also offers standalone payment links. Those are a different product flow and are not
implemented here. Online payments require an activated, eligible QuickBooks Payments account;
connecting the accounting API does not activate payment processing. Confirm eligibility against the
actual company's country/account before promising collection in India or the UAE. A sandbox test
also does not prove that a live merchant can receive funds.
[Intuit payment-link setup](https://quickbooks.intuit.com/learn-support/en-us/help-article/payment-processing/create-buy-button-quickbooks-online/L13HQhTU7_US_en_US).

Zoho Books invoices can return `invoice_url`; whether customers can pay online depends on the
organization's payment gateway configuration. Wodana reads status and balance from the authenticated
Books API. The connector currently uses direct refresh rather than a Zoho webhook.
[Zoho invoice API](https://www.zoho.com/books/api/v3/invoices/).

Do not mark an invoice paid because a WhatsApp message was delivered, a customer clicked a link,
or a webhook claimed an invoice changed. Read the accounting provider's current invoice/payment
record first. Partial payments must keep a nonzero balance.

## Client demo session after accounts are connected

1. Choose a test legal entity and its Google, accounting and WhatsApp connections. Use a test
   customer with explicit permission to receive the demo messages.
2. Open Google tools, load calendars and select the intended writable calendar. Schedule a
   consultation/site visit. Confirm it appears in that Google calendar. The Hub meeting composer
   currently adds no attendees and sends no invitation emails.
3. Create a private Drive text file containing the approved brief/meeting notes. Open its returned
   Google link. This does not create a public share permission or upload design attachments.
4. In **one** accounting connection, load customers/items and create a test deposit invoice with
   the correct dates, currency, amount and applicable tax code. The Hub composer currently handles
   one line; the API supports multiple lines. Existing customers/items must already exist in the
   provider; customer creation is not implemented.
5. Load invoices and refresh the new invoice. Confirm total, outstanding balance and payment page.
   If no payment URL is returned, fix payment setup in the provider before presenting payment as ready.
6. Copy the invoice link into an explicit Gmail message, or use an approved WhatsApp template whose
   body/URL-button parameters match the provider link. Confirm recipient opt-in before template send.
   Templates with arbitrary dynamic domains may require an approved template for that provider;
   Wodana does not create or approve templates automatically.
7. Inspect WhatsApp delivery updates and the test reply. “Accepted” means provider acceptance;
   delivered/read/failed comes later from Meta's signed webhook.
8. Complete only the provider's supported test payment flow. Refresh the invoice again and check
   the new balance. Show that this does not yet automatically update a Wodana project finance record.
9. Review the workspace audit log. Do not repeatedly submit a timed-out send or invoice: an
   unconfirmed operation remains blocked for review to avoid duplicate external actions.

## Provider setup and deployment

Store client secrets only in an untracked environment file or secret manager. Never put them in
`NEXT_PUBLIC_*` variables, UI configuration JSON, commits or chat. See [`.env.example`](../.env.example).
Tokens are encrypted with `INTEGRATIONS_ENCRYPTION_KEY`; production needs a stable managed key,
persistent/private Redis and backups. Changing the key without migration makes stored tokens unreadable.

| Setting | Local session value or required source |
| --- | --- |
| `WEB_ORIGIN` | `http://127.0.0.1:3100` for this running local session |
| `BUSINESS_CORE_URL` | `http://127.0.0.1:8131/api/v1` for this session |
| Google callback | `http://127.0.0.1:8132/api/v1/integrations/google/oauth/callback` |
| QuickBooks callback | `http://127.0.0.1:8132/api/v1/integrations/providers/quickbooks/oauth/callback` |
| Zoho callback | `http://127.0.0.1:8132/api/v1/integrations/providers/zoho_books/oauth/callback` |
| WhatsApp webhook | Public HTTPS integration API + `/api/v1/integrations/providers/webhooks/whatsapp` |
| QuickBooks webhook | Public HTTPS integration API + `/api/v1/integrations/providers/webhooks/quickbooks` |

These local ports differ from the default Compose ports (3000/8000/8001). Set each `*_REDIRECT_URI`
explicitly and register exactly that value at the provider, including host and port. A provider may
require HTTPS even for development; use its permitted local redirect or an approved HTTPS test
endpoint. Meta's JavaScript login requires HTTPS, and provider webhooks cannot reach localhost.
No public tunnel or deployment has been created during this task.

**Google:** Finish “Wodana Integrations Demo” branding in project `wodana`; use
`wodanatechnology@gmail.com` as support/contact email, External/Testing audience, and that account as
the test user. Enable Calendar, Gmail and Drive APIs. Create a Web application OAuth client and
register the Google callback above. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
`GOOGLE_REDIRECT_URI`. Connect from Wodana with Calendar management and optional `gmail.send` and
`drive.file`. Publishing/verification for customer rollout is separate from the demo.
[Google server-side OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

**QuickBooks:** Create/configure an Intuit developer application with a sandbox company. Set
`QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI` and
`QUICKBOOKS_ENVIRONMENT=sandbox`. Grant `com.intuit.quickbooks.accounting`. For change notifications,
set `QUICKBOOKS_WEBHOOK_VERIFIER` from the developer console and register the public endpoint. Move
to production credentials/environment only after the account and payment flow are verified.
[Intuit OAuth documentation](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0).

**Zoho Books:** Register a server-based client and callback; set `ZOHO_CLIENT_ID`,
`ZOHO_CLIENT_SECRET`, `ZOHO_REDIRECT_URI`. Select the organization's actual data center in Wodana:
US, India, EU, Australia, Canada, Japan or Saudi Arabia. China is not currently implemented. Enable
multi-data-center client support in Zoho when needed; do not assume one secret works in every region.
Enter the exact Books organization ID when the account has multiple organizations. Requested scopes
cover reads for contacts/settings/invoices/payments/bills/POs/expenses and invoice creation.
[Zoho OAuth](https://www.zoho.com/books/api/v3/oauth/),
[regional API domains](https://www.zoho.com/books/api/v3/introduction/).

**WhatsApp:** Set `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_CONFIG_ID`,
`WHATSAPP_GRAPH_VERSION` (currently v23.0) and `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Configure Facebook
Login for Business/Embedded Signup for WhatsApp management and messaging, register the HTTPS app
origin and redirect configuration, add developer/tester roles for testing, register the public
webhook and subscribe to `messages`. Each tenant completes signup with their own WABA and number.
External customer onboarding also requires the applicable Meta verification/review and live app setup.
[Meta official setup and rollout requirements](https://github.com/fbsamples/business-messaging-sample-tech-provider-app/blob/main/README.md).

## Operational limits and verification

- OAuth state is one-time and expires after ten minutes; callback completion is version checked.
  Failed/cancelled Meta setup may require reloading the page before starting a new attempt.
- Core checks tenant membership and permissions on each tool request. Outbound actions require
  `integrations.manage`, not merely view access. Provider secret references bind provider/workspace/
  connection and use a unique generation for each OAuth completion.
- Invoice/email/template/Drive operations retain encrypted idempotency state. Exact retries return
  the saved result; changed content under the same key conflicts. Ambiguous outcomes require manual
  review. There is no automatic retry/reconciliation console yet.
- QBO/WhatsApp webhook signatures are verified over the raw body before tenant routing. WhatsApp
  additionally matches the phone number. Encrypted per-connection history keeps the latest 2,000
  events and the UI reads the latest 100. This is a diagnostic inbox, not a full CRM conversation store.
- Accounting record lists paginate. The Hub customer/item selectors load the first 50 records;
  large accounts need a searchable selector. WhatsApp templates are limited to the first returned
  approved batch. WhatsApp media/free-text conversation replies are not implemented.
- Disconnect removes local access and webhook routing. Google also attempts provider revocation.
  QuickBooks/Zoho/Meta grants are not revoked remotely by this action; remove the grant in the
  provider's connected-app settings if required.
- There is no automatic charge, refund, payment-link shortening, attachment sharing or payroll sync.
- Production checks reject development encryption/service secrets and insecure configured callbacks.
  The existing production startup contract still requires Google credentials even if only another
  provider will be used. Configure logs/proxies to redact OAuth callback query strings and provider
  request query strings containing credentials. Access tokens, registration PINs and messages must
  not be logged.

Run the checks from `wodana-saas`:

```bash
npm run typecheck --workspace @wodana/business-core
npm test --workspace @wodana/business-core
npm run typecheck --workspace @wodana/web
npm test --workspace @wodana/web -- components/workspace/integrations-page.test.tsx components/workspace/integration-tools.test.tsx components/workspace/whatsapp-signup.test.tsx
.venv/bin/ruff check services/intelligence-automation/src
(cd services/intelligence-automation && ../../.venv/bin/mypy src && ../../.venv/bin/pytest -q)
```

Mock contract/security tests and local UI checks are complete. Live OAuth, actual provider record
creation, a permitted test delivery and payment reconciliation must still be run before describing
these integrations as end-to-end verified or ready for customer rollout.

Verified in this session: 115 Business Core tests, 57 Python service tests, 7 targeted web tests,
TypeScript checks for web and core, Python type checking, and lint for the integration changes.
