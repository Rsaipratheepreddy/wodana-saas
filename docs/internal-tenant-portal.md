# Internal tenant portal

`/internal` is Wodana's control-plane UI for tenant provisioning, access, and subscription management. It is intentionally separate from each tenant's workspace.

## Access

- The user must be signed in and have an active row in `platform_administrators`.
- The browser never receives `BUSINESS_CORE_INTERNAL_TOKEN`; Next.js adds it only on server-side proxy requests.
- Suspended workspaces cannot start new sessions or use existing sessions against workspace APIs.
- The internal portal has no link to or from a customer workspace; a denied user sees an internal access message, not a workspace redirect.
- **Current authentication gap:** operator sign-in still uses the tenant-branded login and requires an active workspace membership. A standalone Wodana operator identity/session is planned as CP00.5; navigation separation alone is not full authentication isolation.

For a production bootstrap, grant the first administrator after that user exists:

```sql
INSERT INTO platform_administrators (user_id)
SELECT id FROM users WHERE primary_email = 'platform-owner@example.com'
ON CONFLICT (user_id) DO UPDATE SET status = 'active';
```

## Billing authority

`workspace_subscriptions` is the shared source of truth. The internal portal writes plan, subscription state, cycle, price, renewal, seat limit, and project limit. `/workspace/billing` reads that same record for the tenant. QuickBooks and Zoho Books remain customer-accounting integrations; they do not replace the Wodana subscription.

## Tenant workflow

1. Add a tenant and its owner from the tenant list.
2. Copy the one-time owner activation link.
3. Open a tenant from the list only when its details are needed.
4. Change access or subscription terms and save.
5. Share the owner activation link through an approved channel; the operator portal does not navigate into a tenant session.

All management updates use record versions to prevent stale overwrites and write an audit event.
