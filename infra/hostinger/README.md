# Wodana production host setup

> **Existing live host (7 September 2026):** use `compose.native-host.yaml` and
> `backup.native-host.sh` from `/opt/wodana/releases/20260907`. Native nginx/PostgreSQL are retained.
> The standalone setup below is for a new host and must not replace the current installation.
> See [the verified release record](../../docs/iglo-production-release.md).

This directory adapts the previous Wodana Hostinger stack to the current SaaS architecture. It is
configuration only; adding these files does not deploy or change a server.

## Services

- Nginx terminates TLS and routes the web app, Business Core API, and Integration API.
- Next.js serves the tenant, client, and internal portals.
- Business Core owns PostgreSQL records and runs migrations before startup.
- Intelligence API handles OAuth callbacks and signed QuickBooks/WhatsApp webhooks.
- Intelligence Worker runs CRM automation, provider delivery, and accounting reconciliation.
- PostgreSQL, Redis AOF data, and local object files use named persistent volumes.

Redis is durable because it contains encrypted tenant provider credentials, OAuth state, queues, and
idempotency records. The production policy is `noeviction`; do not reuse the old cache-only LRU
configuration.

## Prepare without deploying

```bash
cp infra/hostinger/env.production.example .env.production
chmod 600 .env.production
./infra/hostinger/validate.sh
```

Fill every `CHANGE_ME` value. Use URL-safe hexadecimal values for the two PostgreSQL passwords
because Compose builds PostgreSQL URLs from them. Generate independent secrets:

```bash
openssl rand -hex 32
```

The four provider applications must contain these exact public endpoints for the chosen domain:

| Provider | Endpoint |
| --- | --- |
| Google OAuth | `https://api.DOMAIN/api/v1/integrations/google/oauth/callback` |
| QuickBooks OAuth | `https://api.DOMAIN/api/v1/integrations/providers/quickbooks/oauth/callback` |
| QuickBooks webhook | `https://api.DOMAIN/api/v1/integrations/providers/webhooks/quickbooks` |
| Zoho Books OAuth | `https://api.DOMAIN/api/v1/integrations/providers/zoho_books/oauth/callback` |
| WhatsApp webhook | `https://api.DOMAIN/api/v1/integrations/providers/webhooks/whatsapp` |

`WHATSAPP_CONFIG_ID` comes from Meta's Embedded Signup configuration and
`QUICKBOOKS_WEBHOOK_VERIFIER` comes from the Intuit application. They are required for new tenant
connections and signed webhook intake. Tenant access and refresh tokens are stored encrypted in
Redis; they do not belong in `.env.production`.

## Migrate the existing site safely

See [the release record](../../docs/iglo-production-release.md) before cutover. The previous site uses a
separate architecture and database. Its users cannot be replaced with the local demonstration seed.

Use the current password login with `AUTH_MODE=password`, a stable random signing secret, HTTPS issuer,
and explicit audience. The backend accepts verified legacy bcrypt records only with the explicit
`legacy-bcrypt` salt marker; an importer must preserve IDs/status/roles. This does not migrate identities
automatically. Password recovery requires Mailgun configuration. OIDC remains an alternative API mode
for separately integrated identity clients.

On the existing host, first back up and restore-test the legacy data and preserve all secret storage.
Then stage the new services alongside the old site:

```bash
./infra/hostinger/stage.sh
```

This builds and starts the new private stack on loopback ports. It does not start Nginx, outbound
workers, change DNS, or remove the old stack. Import and verify preserved identities and Iglo data,
then configure the existing host proxy and TLS using its actual inventory. Keep the old release for
rollback. Do not run `setup.sh`/standalone Certbot against occupied production ports.

For subsequent updates where the new stack owns its Nginx service:

```bash
./infra/hostinger/deploy.sh
```

The update script builds first, requires a successful private backup, updates without removing
unrelated containers and checks API readiness plus landing/login. It refuses implicit first-time
legacy takeover. If the host continues to use native Nginx, retain that proxy and use a host-specific
verified update procedure instead.

## Start a fresh v2 database (R1, September 2026)

v1 migrations were squashed into `services/business-core/drizzle/0000_v2_baseline.sql`, so an existing
`wodana_release` history no longer matches the journal. The current `wodana_release` holds dummy UAT
data only, and the owner approved replacing it. Run these steps only with that approval, in a
maintenance window:

1. Take and restore-test a final backup (`backup.native-host.sh`) and keep the previous release
   directory for rollback.
2. Stop Business Core and the intelligence worker so nothing writes during the swap.
3. Recreate the database and the app-role grants, which are per database:

   ```bash
   sudo -u postgres dropdb --if-exists wodana_release
   sudo -u postgres createdb wodana_release   # owned by postgres, which applies migrations
   sudo -u postgres env POSTGRES_USER=postgres POSTGRES_DB=wodana_release \
     POSTGRES_APP_USER=wodana_app POSTGRES_APP_PASSWORD='<existing app password>' \
     sh infra/postgres/001-create-app-role.sh
   sudo -u postgres psql -d wodana_release -v ON_ERROR_STOP=1 -c \
     'CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);'
   ```

4. Deploy with `APPLY_PENDING_MIGRATIONS=1`. The deploy script rehearses the baseline and every later
   migration in a rolled-back transaction, then applies them and compares the history with the journal.
5. Provision the Palm Living tenant through the operator portal and send the owner invitation.
   Do not restore UAT rows into the new database.

Rollback: restore the step 1 backup into `wodana_release` and restart the previous release.

## UAT delivery guard

While a host holds UAT data, put the same `DELIVERY_ALLOWLIST` (exact emails, `*@domain`, E.164
numbers) and `ENVIRONMENT=uat` in both `core.env` and `intelligence.env`. Email, WhatsApp and push
then reach only listed recipients; the rest are recorded as suppressed with `not_allowlisted`.
Remove both at go-live: with `ENVIRONMENT=production`, Business Core and the worker refuse to start
while the list is set.

## Operations

Install the systemd units only on the server. The backup timer captures PostgreSQL, Redis provider
state, and the local object volume every six hours. Copy backups to encrypted off-site storage; local
retention alone is not disaster recovery. The certificate timer adds active tenant slugs as SANs and
reloads Nginx after a valid certificate is issued.

```bash
sudo cp infra/hostinger/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wodana-backup.timer wodana-certificates.timer
```

Inspect without changing state:

```bash
docker compose --env-file .env.production -f infra/hostinger/compose.production.yaml ps
curl -fsS https://api.DOMAIN/api/v1/health/ready
```

`checks.worker` in that response is the intelligence worker's heartbeat (`ok`, `stale (Ns)`,
`not-reporting`). A stale or silent worker keeps the API ready but is listed under `degraded`:
nothing is being delivered and no timer runs until the worker is back.
