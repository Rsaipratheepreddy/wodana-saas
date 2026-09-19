"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { Braces, CreditCard, ExternalLink } from "lucide-react";
import { siAutodesk, siDropbox, siQuickbooks, siWhatsapp, siZoho, type SimpleIcon } from "simple-icons";
import {
  Badge,
  Button,
  Callout,
  ConfirmationDialog,
  ControlledModalDialog,
  DataGrid,
  DesignSystemProvider,
  EmptyState,
  IconMenuButton,
  SearchInput,
  SelectField,
  Surface,
  Switch,
  TextInput,
  type DataGridColumn,
} from "@/design-system";
import {
  type IntegrationConnection,
  type IntegrationProvider,
  type IntegrationsPageData,
  type ProviderCapabilityState,
} from "@/lib/workspace/integrations";
import { WhatsAppSignup, isWhatsAppSetup, type WhatsAppSetup } from "./whatsapp-signup";
import { IntegrationTools } from "./integration-tools";
import styles from "./integrations-page.module.css";

const STATUS_LABELS = {
  draft: "Draft",
  pending: "Connecting",
  connected: "Connected",
  degraded: "Needs attention",
  revoked: "Revoked",
} as const;

function statusTone(status: IntegrationConnection["status"]) {
  if (status === "connected") return "success" as const;
  if (status === "degraded") return "warning" as const;
  if (status === "pending") return "info" as const;
  if (status === "revoked") return "danger" as const;
  return "neutral" as const;
}

function verificationLabel(status: ProviderCapabilityState["verificationState"]) {
  if (status === "delivery_verified") return "Delivery verified";
  if (status === "operation_confirmed") return "Provider operation confirmed";
  if (status === "failed") return "Latest check failed";
  if (status === "not_applicable") return "Built in";
  return "Not tested";
}

function responseMessage(response: Response, fallback: string) {
  return response.json()
    .then((payload: { message?: string } | null) => payload?.message ?? fallback)
    .catch(() => fallback);
}

function newestActiveConnection(connections: IntegrationConnection[], provider: IntegrationProvider) {
  return connections
    .filter((connection) => connection.provider === provider && connection.status !== "revoked")
    .sort((left, right) => Date.parse(right.updatedAt ?? right.createdAt) - Date.parse(left.updatedAt ?? left.createdAt))[0];
}

function isAuthorizationStart(payload: unknown): payload is { authorizationUrl: string } {
  return Boolean(payload && typeof payload === "object" && typeof (payload as { authorizationUrl?: unknown }).authorizationUrl === "string");
}

function SimpleBrandMark({ color, icon }: { color?: string; icon: SimpleIcon }) {
  return <svg aria-hidden="true" fill={color ?? `#${icon.hex}`} role="img" viewBox="0 0 24 24"><path d={icon.path} /></svg>;
}

function GoogleWorkspaceMark() {
  return <svg aria-hidden="true" role="img" viewBox="0 0 24 24">
    <path d="M21.6 12.227c0-.709-.064-1.39-.182-2.045H12v3.868h5.382a4.6 4.6 0 0 1-1.995 3.018v2.51h3.229c1.89-1.74 2.984-4.305 2.984-7.35Z" fill="#4285F4" />
    <path d="M12 22c2.7 0 4.964-.896 6.616-2.423l-3.229-2.51c-.895.6-2.04.956-3.387.956-2.605 0-4.81-1.76-5.6-4.123H3.064v2.59A9.997 9.997 0 0 0 12 22Z" fill="#34A853" />
    <path d="M6.4 13.9A6.01 6.01 0 0 1 6.086 12c0-.66.114-1.3.314-1.9V7.51H3.064A9.997 9.997 0 0 0 2 12c0 1.614.386 3.14 1.064 4.49L6.4 13.9Z" fill="#FBBC05" />
    <path d="M12 5.977c1.468 0 2.786.505 3.823 1.496l2.864-2.864C16.959 2.995 14.696 2 12 2a9.997 9.997 0 0 0-8.936 5.51L6.4 10.1C7.19 7.736 9.395 5.977 12 5.977Z" fill="#EA4335" />
  </svg>;
}

function MicrosoftMark() {
  return <svg aria-hidden="true" role="img" viewBox="0 0 23 23">
    <path d="M0 0h11v11H0z" fill="#f35325" />
    <path d="M12 0h11v11H12z" fill="#81bc06" />
    <path d="M0 12h11v11H0z" fill="#05a6f0" />
    <path d="M12 12h11v11H12z" fill="#ffba08" />
  </svg>;
}

function DocusignMark() {
  return <svg aria-hidden="true" role="img" viewBox="0 0 194 194">
    <path d="M139.5 139.5V189c0 2.6-2.1 4.7-4.7 4.7H4.7A4.7 4.7 0 0 1 0 189V59c0-2.6 2.1-4.7 4.7-4.7h49.4v80.5c0 2.6 2.1 4.7 4.7 4.7h80.7Z" fill="#4c00ff" />
    <path d="M193.7 69.7c0 41.6-24.3 69.7-54.2 69.8V87.1c0-1.5-.6-3-1.7-4l-27.2-27.2a5.6 5.6 0 0 0-4-1.7H54.2V4.8C54.2 2.2 56.3.1 59 .1h73.3c34.7-.1 61.4 27.9 61.4 69.6Z" fill="#ff5252" />
    <path d="M137.8 83c1.1 1.1 1.7 2.5 1.7 4v52.4H58.9a4.7 4.7 0 0 1-4.7-4.7V54.2h52.4c1.5 0 3 .6 4 1.7L137.8 83Z" fill="#171319" />
  </svg>;
}

function ProviderMark({ provider }: { provider: ProviderCapabilityState["id"] }) {
  if (provider === "google_workspace") return <GoogleWorkspaceMark />;
  if (provider === "quickbooks") return <SimpleBrandMark icon={siQuickbooks} />;
  if (provider === "whatsapp") return <SimpleBrandMark icon={siWhatsapp} />;
  if (provider === "zoho_books") return <SimpleBrandMark icon={siZoho} />;
  if (provider === "autodesk_construction_cloud") return <SimpleBrandMark color="currentColor" icon={siAutodesk} />;
  if (provider === "microsoft_365") return <MicrosoftMark />;
  if (provider === "docusign") return <DocusignMark />;
  if (provider === "dropbox") return <SimpleBrandMark icon={siDropbox} />;
  if (provider === "payment") return <CreditCard aria-hidden="true" size={24} strokeWidth={1.7} />;
  return <Braces aria-hidden="true" size={24} strokeWidth={1.7} />;
}

export function IntegrationsPage({
  initialData,
  oauthResult,
}: {
  initialData: IntegrationsPageData;
  oauthResult?: { code?: string; result?: string };
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [connections, setConnections] = useState(initialData.connections);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ provider: IntegrationProvider; connection?: IntegrationConnection } | null>(null);
  const [revoking, setRevoking] = useState<IntegrationConnection | null>(null);
  const [toolConnection, setToolConnection] = useState<IntegrationConnection | null>(null);
  const [whatsappSetup, setWhatsappSetup] = useState<WhatsAppSetup | null>(null);
  const [connectingId, setConnectingId] = useState("");
  const [revokingId, setRevokingId] = useState("");
  const [failure, setFailure] = useState(oauthResult?.result === "error"
    ? oauthResult.code === "oauth_denied"
      ? "Provider authorization was cancelled."
      : "The provider could not be connected. Check its setup and try again."
    : "");
  const [status, setStatus] = useState(oauthResult?.result === "connected"
    ? "The account was connected successfully."
    : "");
  const providerCatalog = initialData.providerCapabilities.providers;

  const visibleCatalog = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return providerCatalog.filter((item) =>
      !normalized || `${item.label} ${item.source} ${item.description} ${item.category} ${item.capabilities.map((capability) => capability.label).join(" ")}`.toLowerCase().includes(normalized),
    );
  }, [providerCatalog, query]);
  const availableCatalog = visibleCatalog.filter((item) => item.implementation === "available" && item.setupMode === "tenant_connection");
  const includedCatalog = visibleCatalog.filter((item) => item.implementation === "available" && item.setupMode === "platform_managed");
  const plannedCatalog = visibleCatalog.filter((item) => item.implementation === "planned");
  const unavailableCatalog = visibleCatalog.filter((item) => item.implementation === "requires_specification");
  const availableProviders = new Set(providerCatalog.filter((item) => item.implementation === "available").map((item) => item.provider));
  const activeConnections = connections.filter((connection) => connection.status !== "revoked" && availableProviders.has(connection.provider));
  const connectedCount = activeConnections.filter((connection) => connection.status === "connected").length;
  const attentionCount = activeConnections.filter((connection) => connection.status === "degraded").length;

  const mergeConnection = (connection: IntegrationConnection) => {
    setConnections((current) => current.some((item) => item.id === connection.id)
      ? current.map((item) => item.id === connection.id ? connection : item)
      : [connection, ...current]);
  };

  const updateConnectionHealth = useCallback((connectionId: string, nextStatus: "connected" | "degraded", errorCode?: string) => {
    const update = (connection: IntegrationConnection) => connection.id === connectionId
      ? { ...connection, status: nextStatus, lastErrorCode: errorCode ?? null, lastSyncedAt: nextStatus === "connected" ? new Date().toISOString() : connection.lastSyncedAt }
      : connection;
    setConnections((current) => current.map(update));
    setToolConnection((current) => current ? update(current) : null);
  }, []);

  const connect = async (connection: IntegrationConnection) => {
    setConnectingId(connection.id);
    setFailure("");
    try {
      const response = await fetch(`/api/workspace/integration-connections/${connection.id}/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: initialData.workspaceId, provider: connection.provider, version: connection.version, ...(connection.provider === "google_workspace" ? { gmailSend: connection.configuration?.gmailSend === true, driveFiles: connection.configuration?.driveFiles === true } : {}) }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The connection could not be started."));
      const payload = await response.json() as unknown;
      if (isWhatsAppSetup(payload)) {
        setWhatsappSetup({ ...payload, connectionId: connection.id });
        return;
      }
      if (isAuthorizationStart(payload)) {
        const authorizationUrl = new URL(payload.authorizationUrl);
        if (authorizationUrl.protocol !== "https:" || !["accounts.google.com", "appcenter.intuit.com", "accounts.zoho.com", "accounts.zoho.in", "accounts.zoho.eu", "accounts.zoho.com.au", "accounts.zohocloud.ca", "accounts.zoho.jp", "accounts.zoho.sa"].includes(authorizationUrl.hostname)) {
          throw new Error("The provider returned an invalid authorization address.");
        }
        setStatus("Opening provider authorization…");
        window.location.assign(authorizationUrl.toString());
        return;
      }
      const saved = payload as IntegrationConnection;
      mergeConnection(saved);
      setStatus(`${saved.displayName} is connecting.`);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The connection could not be started.");
    } finally {
      setConnectingId("");
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setRevokingId(revoking.id);
    setFailure("");
    try {
      const response = await fetch(`/api/workspace/integration-connections/${revoking.id}?workspaceId=${initialData.workspaceId}&version=${revoking.version}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseMessage(response, "The connection could not be revoked."));
      const saved = await response.json() as IntegrationConnection;
      mergeConnection(saved);
      setStatus(`${saved.displayName} was disconnected.`);
      setRevoking(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The connection could not be revoked.");
      setRevoking(null);
    } finally {
      setRevokingId("");
    }
  };

  const accountColumns: DataGridColumn<IntegrationConnection>[] = [
    {
      accessorKey: "displayName",
      header: "Account",
      size: 200,
      cell: ({ row }) => <span className={styles.accountIdentity}>
        <strong title={row.original.displayName}>{row.original.displayName}</strong>
        <small>{row.original.externalAccountId ?? row.original.externalDomain ?? "Account details pending"}</small>
        <small className={styles.accountMobileStatus}>{STATUS_LABELS[row.original.status]}</small>
      </span>,
    },
    {
      id: "providerName",
      accessorFn: (connection) => providerCatalog.find((item) => item.provider === connection.provider)?.label ?? connection.provider,
      header: "App",
      size: 165,
      meta: { mobileHidden: true },
    },
    {
      id: "legalEntityName",
      accessorFn: (connection) => connection.legalEntityName ?? "Not assigned",
      header: "Organization",
      size: 180,
      meta: { mobileHidden: true },
    },
    {
      accessorKey: "status",
      header: "Status",
      size: 150,
      meta: { mobileHidden: true },
      cell: ({ row }) => <Badge tone={statusTone(row.original.status)}>{STATUS_LABELS[row.original.status]}</Badge>,
    },
    {
      id: "actions",
      header: "Actions",
      size: 150,
      enableSorting: false,
      meta: {
        align: "end",
        renderCell: (connection) => <span className={styles.accountActions}>
          {connection.status === "connected" || connection.status === "degraded"
            ? <Button onPress={() => setToolConnection(connection)} size="compact">Open tools</Button>
            : <Button isDisabled={!initialData.canManage || connection.status === "pending"} isLoading={connectingId === connection.id} onPress={() => void connect(connection)} size="compact">{connection.status === "pending" ? "Connecting" : "Connect"}</Button>}
          <IconMenuButton
            ariaLabel={`Actions for ${connection.displayName}`}
            items={[
              { id: "manage", label: "Manage settings" },
              ...(connection.status === "degraded" ? [{ id: "reconnect", label: "Reconnect" }] : []),
              { id: "disconnect", label: "Disconnect", isDisabled: !initialData.canManage, tone: "danger" },
            ]}
            onAction={(action) => {
              if (action === "manage") setEditor({ provider: connection.provider, connection });
              if (action === "reconnect") void connect(connection);
              if (action === "disconnect") setRevoking(connection);
            }}
          />
        </span>,
      },
    },
  ];

  return <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
    <section aria-labelledby="integrations-heading" className={styles.page}>
      <header className={styles.pageHeading}>
        <h1 id="integrations-heading">Connected apps</h1>
        <p>Connect calendars, messaging and accounting to your workspace.</p>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.summary}>
          <span><strong>{connectedCount}</strong> connected</span>
          <span><strong>{activeConnections.length}</strong> configured</span>
          {attentionCount ? <span data-attention><strong>{attentionCount}</strong> need attention</span> : null}
        </div>
        <div className={styles.searchField}><SearchInput label="Search integrations" onChange={setQuery} placeholder="Search apps" value={query} /></div>
      </div>

      {status ? <p aria-live="polite" className={styles.liveStatus}>{status}</p> : null}
      {failure ? <Callout title="Integration action failed" tone="danger">{failure}</Callout> : null}

      {availableCatalog.length ? <section aria-labelledby="available-apps-heading" className={styles.catalogSection}>
        <div className={styles.sectionHeading}><h2 id="available-apps-heading">Available</h2><span>{availableCatalog.length} app{availableCatalog.length === 1 ? "" : "s"}</span></div>
        <div className={styles.catalogGrid}>{availableCatalog.map((item) => {
          const connection = item.provider ? newestActiveConnection(connections, item.provider) : undefined;
          if (!item.provider) return null;
          return <Surface as="article" aria-label={`${item.label} integration`} className={styles.integrationCard} key={item.id} tone="raised">
            <div className={styles.cardBody}>
              <div className={styles.cardHeader}>
                <span className={styles.providerIcon}><ProviderMark provider={item.id} /></span>
                <div className={styles.cardIdentity}>
                  <strong>{item.label}</strong>
                  {item.href ? <a href={item.href} rel="noreferrer" target="_blank">{item.source}<ExternalLink aria-hidden="true" size={10} /></a> : <small>{item.source}</small>}
                </div>
                <Badge tone={connection ? statusTone(connection.status) : "neutral"}>{connection ? STATUS_LABELS[connection.status] : "Not connected"}</Badge>
              </div>
              <p>{item.description}</p>
              {connection ? <small className={styles.connectionName}>{connection.displayName}{connection.legalEntityName ? ` · ${connection.legalEntityName}` : ""}</small> : null}
              <small className={styles.capabilityTruth}>Setup: {connection ? "Configured" : "Not configured"} · Evidence: {connection?.id === item.connection?.id ? verificationLabel(item.verificationState) : "Not tested"}</small>
              {connection?.healthIssues?.length ? <small className={styles.healthIssue}>{connection.healthIssues[0]}</small> : null}
            </div>
            <div className={styles.cardFooter}>
              {!connection
                ? <Button isDisabled={!initialData.canManage} onPress={() => setEditor({ provider: item.provider! })} size="compact" variant="primary">Connect</Button>
                : connection.status === "draft"
                  ? <Button isDisabled={!initialData.canManage} isLoading={connectingId === connection.id} onPress={() => void connect(connection)} size="compact" variant="primary">Connect</Button>
                  : <Button onPress={() => setEditor({ provider: item.provider!, connection })} size="compact">Manage</Button>}
              {connection?.status === "draft" ? <Button onPress={() => setEditor({ provider: item.provider!, connection })} size="compact" variant="quiet">Settings</Button> : null}
              {connection && ["connected", "degraded"].includes(connection.status) ? <Button isDisabled={!initialData.canManage} onPress={() => setEditor({ provider: item.provider! })} size="compact" variant="quiet">Add account</Button> : null}
            </div>
          </Surface>;
        })}</div>
      </section> : null}

      {includedCatalog.length ? <section aria-labelledby="included-apps-heading" className={styles.catalogSection}>
        <div className={styles.sectionHeading}><h2 id="included-apps-heading">Built into Wodana</h2><span>{includedCatalog.length} capability</span></div>
        <div className={styles.plannedGrid}>{includedCatalog.map((item) => <Surface as="article" aria-label={`${item.label} integration`} className={styles.plannedCard} key={item.id}>
          <span className={styles.plannedIcon}><ProviderMark provider={item.id} /></span>
          <span className={styles.plannedIdentity}><strong>{item.label}</strong><small>{item.description}</small></span>
          <Badge tone="info">Included</Badge>
        </Surface>)}</div>
      </section> : null}

      {plannedCatalog.length ? <section aria-labelledby="planned-apps-heading" className={styles.catalogSection}>
        <div className={styles.sectionHeading}><h2 id="planned-apps-heading">Planned</h2><span>{plannedCatalog.length} app{plannedCatalog.length === 1 ? "" : "s"}</span></div>
        <div className={styles.plannedGrid}>{plannedCatalog.map((item) => <Surface as="article" aria-label={`${item.label} integration`} className={styles.plannedCard} key={item.id}>
          <span className={styles.plannedIcon}><ProviderMark provider={item.id} /></span>
          <span className={styles.plannedIdentity}><strong>{item.label}</strong><small>{item.source}</small></span>
          <Badge>Planned</Badge>
        </Surface>)}</div>
      </section> : null}

      {unavailableCatalog.length ? <section aria-labelledby="unavailable-apps-heading" className={styles.catalogSection}>
        <div className={styles.sectionHeading}><div><h2 id="unavailable-apps-heading">External lead capture</h2><p>Shared enquiry links and QR codes work now. These native sources need provider access before they can be enabled.</p></div><span>{unavailableCatalog.length} source{unavailableCatalog.length === 1 ? "" : "s"}</span></div>
        <div className={styles.plannedGrid}>{unavailableCatalog.map((item) => <Surface as="article" aria-label={`${item.label} integration`} className={styles.plannedCard} key={item.id}>
          <span className={styles.plannedIcon}><ProviderMark provider={item.id} /></span>
          <span className={styles.plannedIdentity}><strong>{item.label}</strong><small>{item.description}</small></span>
          <Badge tone="warning">Details required</Badge>
        </Surface>)}</div>
      </section> : null}

      {!visibleCatalog.length ? <EmptyState title="No integrations found" description="Try another search term." /> : null}
      {activeConnections.length ? <section aria-label="Configured accounts" className={styles.accounts}>
        <div className={styles.sectionHeading}><h2>Configured accounts</h2><span>{activeConnections.length} account{activeConnections.length === 1 ? "" : "s"}</span></div>
        <DataGrid appearance="flush" ariaLabel="Configured accounts" columns={accountColumns} data={activeConnections} getRowId={(connection) => connection.id} pinFirstColumn={false} rowNumbers={false} selectable={false} showToolbar={false} />
      </section> : null}
    </section>

    <IntegrationTools connection={toolConnection} workspaceId={initialData.workspaceId} canManage={initialData.canManage} onClose={() => setToolConnection(null)} onHealthChange={updateConnectionHealth} />
    <WhatsAppSignup setup={whatsappSetup} workspaceId={initialData.workspaceId} onClose={() => { setWhatsappSetup(null); window.location.reload(); }} />
    <IntegrationDialog
      initialData={initialData}
      item={editor}
      key={editor?.connection?.id ?? editor?.provider ?? "closed"}
      onClose={() => setEditor(null)}
      onSaved={(connection, shouldConnect) => {
        mergeConnection(connection);
        setEditor(null);
        if (shouldConnect) void connect(connection);
        else setStatus(
          connection.status === "draft"
            ? `${connection.displayName} was saved as a draft.`
            : `${connection.displayName} settings were saved.`,
        );
      }}
    />
    <ConfirmationDialog body={revoking ? <>Disconnect <strong>{revoking.displayName}</strong>? Syncing will stop and the connection must be configured again.</> : null} confirmLabel={revokingId ? "Disconnecting…" : "Disconnect"} isOpen={Boolean(revoking)} onConfirm={() => void revoke()} onOpenChange={(open) => { if (!open && !revokingId) setRevoking(null); }} title="Disconnect integration?" />
  </DesignSystemProvider>;
}

function IntegrationDialog({ initialData, item, onClose, onSaved }: { initialData: IntegrationsPageData; item: { provider: IntegrationProvider; connection?: IntegrationConnection } | null; onClose: () => void; onSaved: (connection: IntegrationConnection, shouldConnect: boolean) => void }) {
  const connection = item?.connection;
  const provider = item?.provider ?? "google_workspace";
  const catalogItem = initialData.providerCapabilities.providers.find((entry) => entry.provider === provider) ?? { label: provider.replaceAll("_", " ") };
  const [displayName, setDisplayName] = useState(connection?.displayName ?? `${catalogItem.label} connection`);
  const [legalEntityId, setLegalEntityId] = useState(connection?.legalEntityId ?? "none");
  const [accountEmail, setAccountEmail] = useState(String(connection?.configuration?.accountEmail ?? ""));
  const [region, setRegion] = useState(String(connection?.configuration?.region ?? "us"));
  const [organizationId, setOrganizationId] = useState(String(connection?.configuration?.organizationId ?? ""));
  const [gmailSend, setGmailSend] = useState(connection?.configuration?.gmailSend === true);
  const [driveFiles, setDriveFiles] = useState(connection?.configuration?.driveFiles === true);
  const [externalDomain, setExternalDomain] = useState(connection?.externalDomain ?? "");
  const [endpointUrl, setEndpointUrl] = useState(String(connection?.configuration?.endpointUrl ?? ""));
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  const formId = `integration-${connection?.id ?? provider}`;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const shouldConnect = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "connect";
    if (provider === "google_workspace" && (legalEntityId === "none" || (!externalDomain.trim() && !accountEmail.trim()))) {
      setFailure("Google requires an organization and a domain or exact Gmail address.");
      return;
    }
    if (["quickbooks", "zoho_books", "whatsapp"].includes(provider) && legalEntityId === "none") {
      setFailure("Select the organization that owns this account.");
      return;
    }
    setSaving(true);
    setFailure("");
    try {
      const response = await fetch(connection ? `/api/workspace/integration-connections/${connection.id}` : "/api/workspace/integration-connections", {
        method: connection ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: initialData.workspaceId,
          ...(connection ? { version: connection.version } : { provider }),
          displayName,
          legalEntityId: legalEntityId === "none" ? (connection ? null : undefined) : legalEntityId,
          externalDomain: (provider === "google_workspace" && accountEmail.trim() ? accountEmail.trim().toLowerCase().split("@")[1] : externalDomain.trim()) || (connection ? null : undefined),
          configuration: provider === "google_workspace" ? { ...(connection?.configuration ?? {}), ...(accountEmail ? { accountEmail: accountEmail.trim().toLowerCase() } : {}), ...(gmailSend || connection?.configuration?.gmailSend !== undefined ? { gmailSend } : {}), ...(driveFiles || connection?.configuration?.driveFiles !== undefined ? { driveFiles } : {}) } : provider === "zoho_books" ? { ...(connection?.configuration ?? {}), region, ...(organizationId ? { organizationId } : {}) } : provider === "custom" ? { ...(connection?.configuration ?? {}), endpointUrl: endpointUrl.trim() || undefined } : (connection?.configuration ?? {}),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "The integration connection could not be saved."));
      onSaved(await response.json() as IntegrationConnection, shouldConnect);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The integration connection could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return <ControlledModalDialog description="Choose an organization and account. Credentials are never stored in this form." footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>Cancel</Button>{connection ? <Button form={formId} isDisabled={!initialData.canManage} isLoading={saving} type="submit" variant="primary">Save changes</Button> : <><Button form={formId} isDisabled={!initialData.canManage || saving} name="intent" type="submit" value="draft">Save draft</Button><Button form={formId} isDisabled={!initialData.canManage} isLoading={saving} name="intent" type="submit" value="connect" variant="primary">Save and connect</Button></>}</div>} isDismissable={!saving} isOpen={Boolean(item)} onOpenChange={(open) => { if (!open && !saving) onClose(); }} title={connection ? `Manage ${catalogItem.label}` : `Connect ${catalogItem.label}`}>
    <form className={styles.form} id={formId} onSubmit={save}>
      {failure ? <Callout title="Could not save connection" tone="danger">{failure}</Callout> : null}
      {connection ? <div className={styles.dialogStatus}><Badge tone={statusTone(connection.status)}>{STATUS_LABELS[connection.status]}</Badge><span>Version {connection.version}</span></div> : null}
      <TextInput isRequired label="Connection name" onChange={setDisplayName} value={displayName} />
      <SelectField items={[{ id: "none", label: "No organization" }, ...initialData.legalEntities.map((entity) => ({ id: entity.id, label: entity.displayName }))]} label="Organization" onSelectionChange={(key) => key && setLegalEntityId(String(key))} selectedKey={legalEntityId} />
      {provider === "google_workspace" || provider === "custom" ? <TextInput description={provider === "google_workspace" ? "Verified company domain, without https://" : "Optional external domain"} isRequired={provider === "google_workspace" && !accountEmail} label="Domain" onChange={setExternalDomain} placeholder="igloarchitects.com" value={externalDomain} /> : null}
      {provider === "google_workspace" ? <>
        <TextInput label="Google account email" description="For a personal Gmail account, enter its exact address. Domain can be left empty." type="email" value={accountEmail} onChange={setAccountEmail} />
        <Switch isSelected={gmailSend} onChange={setGmailSend}>Send email with Gmail</Switch>
        <Switch isSelected={driveFiles} onChange={setDriveFiles}>Create project documents in Drive</Switch>
      </> : null}
      {provider === "zoho_books" ? <>
        <SelectField label="Zoho data center" selectedKey={region} onSelectionChange={(key) => key && setRegion(String(key))} items={[{ id: "us", label: "United States / Global (.com)" }, { id: "in", label: "India (.in)" }, { id: "eu", label: "Europe (.eu)" }, { id: "au", label: "Australia" }, { id: "ca", label: "Canada" }, { id: "jp", label: "Japan" }, { id: "sa", label: "Saudi Arabia" }]} />
        <TextInput label="Zoho organization ID" description="Required if your Zoho account has multiple organizations." value={organizationId} onChange={setOrganizationId} />
      </> : null}
      {provider === "whatsapp" ? <p>Connect the organization’s own WhatsApp Business account and phone number through Meta. Wodana’s number is not shared between tenants.</p> : null}
      {provider === "quickbooks" ? <p>Online payment links depend on the connected company’s QuickBooks Payments eligibility and activation.</p> : null}
      {provider === "custom" ? <TextInput description="Public endpoint only. Credentials and secret tokens are never stored in this form." label="Endpoint URL" onChange={setEndpointUrl} placeholder="https://api.example.com/events" value={endpointUrl} /> : null}
    </form>
  </ControlledModalDialog>;
}
