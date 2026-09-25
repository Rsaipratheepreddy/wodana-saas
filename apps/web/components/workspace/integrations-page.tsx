"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { ExternalLink, Building2, Mail, Globe2, Tag } from "lucide-react";
import { ProviderMark } from "@/components/brand/provider-mark";
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

function markOnboardingConnection() {
  document.cookie = "wodana_onboarding_connect=1; Path=/; Max-Age=1800; SameSite=Lax";
}



export function IntegrationsPage({
  initialData,
  oauthResult,
  embedded = false,
  onboarding = false,
  connectProvider,
  onlyIds,
}: {
  initialData: IntegrationsPageData;
  embedded?: boolean;
  onboarding?: boolean;
  oauthResult?: { code?: string; result?: string };
  connectProvider?: IntegrationProvider;
  onlyIds?: ProviderCapabilityState["id"][];
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [connections, setConnections] = useState(initialData.connections);
  const [query, setQuery] = useState("");
  const [purpose, setPurpose] = useState("all");
  const [editor, setEditor] = useState<{ provider: IntegrationProvider; connection?: IntegrationConnection } | null>(connectProvider === "google_workspace" && initialData.canManage ? { provider: "google_workspace" } : null);
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
  const providerCatalog = initialData.providerCapabilities.providers.filter(provider => onlyIds ? onlyIds.includes(provider.id) : provider.implementation === "available");

  const visibleCatalog = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return providerCatalog.filter((item) =>
      (purpose === "all" || item.category === purpose) && (!normalized || `${item.label} ${item.source} ${item.description} ${item.category} ${item.capabilities.map((capability) => capability.label).join(" ")}`.toLowerCase().includes(normalized)),
    );
  }, [providerCatalog, query, purpose]);
  const availableCatalog = visibleCatalog.filter((item) => item.implementation === "available" && item.setupMode === "tenant_connection");
  const includedCatalog = visibleCatalog.filter((item) => item.implementation === "available" && item.setupMode === "platform_managed");
  const plannedCatalog = visibleCatalog.filter((item) => item.implementation === "planned");
  const unavailableCatalog = visibleCatalog.filter((item) => item.implementation === "requires_specification");
  const availableProviders = new Set(providerCatalog.filter((item) => item.implementation === "available").map((item) => item.provider));
  const activeConnections = connections.filter((connection) => connection.status !== "revoked" && availableProviders.has(connection.provider));
  const filteredConnections = activeConnections.filter(connection => visibleCatalog.some(provider => provider.provider === connection.provider));
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
    if (onboarding) markOnboardingConnection();
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

  return <DesignSystemProvider className={[styles.provider, embedded ? styles.embedded : ""].join(" ")} portalContainer={portalContainer} ref={setPortalContainer}>
    <section aria-label={embedded ? "Connect your tools" : undefined} aria-labelledby={embedded ? undefined : "integrations-heading"} className={[styles.page, embedded ? styles.embedded : ""].join(" ")}>
      {!embedded && <><header className={styles.pageHeading}>
        <h1 id="integrations-heading">Connections</h1>
        <p>Connect calendars, messaging and accounting to your workspace.</p>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.summary}>
          <span><strong>{initialData.loadError ? "—" : connectedCount}</strong> connected</span>
          <span><strong>{initialData.loadError ? "—" : activeConnections.length}</strong> configured</span>
          {attentionCount ? <span data-attention><strong>{attentionCount}</strong> need attention</span> : null}
        </div>
        <div className={styles.searchField}><SearchInput label="Search integrations" onChange={setQuery} placeholder="Search apps" value={query} /></div>
      </div>

      <div className={styles.purposes} role="group" aria-label="Connection purpose">{[
        ['all', 'All apps'], ['communication', 'Talk to clients'], ['finance', 'Invoices & payments'], ['productivity', 'Calendar & files'],
      ].map(([id, label]) => <button key={id} aria-pressed={purpose === id} onClick={() => setPurpose(id)}>{label}</button>)}</div>
      </>}
      {initialData.loadError && <Callout title="Connections unavailable" tone="warning">{initialData.loadError} <Button size="compact" onPress={() => window.location.reload()}>Reload connections</Button></Callout>}

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
                <Badge tone={connection ? statusTone(connection.status) : "neutral"}>{initialData.loadError ? "Status unavailable" : connection ? STATUS_LABELS[connection.status] : "Not connected"}</Badge>
              </div>
              <p>{item.description}</p>
              {connection ? <small className={styles.connectionName}>{connection.displayName}{connection.legalEntityName ? ` · ${connection.legalEntityName}` : ""}</small> : null}
              {connection ? <small className={styles.capabilityTruth}>{connection?.id === item.connection?.id ? verificationLabel(item.verificationState) : "Not tested"}</small> : null}
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

      {!embedded && includedCatalog.length ? <section aria-labelledby="included-apps-heading" className={styles.catalogSection}>
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
      {!embedded && filteredConnections.length ? <section aria-label="Configured accounts" className={styles.accounts}>
        <div className={styles.sectionHeading}><h2>Configured accounts</h2><span>{filteredConnections.length} account{filteredConnections.length === 1 ? "" : "s"}</span></div>
        <DataGrid appearance="flush" ariaLabel="Configured accounts" columns={accountColumns} data={filteredConnections} getRowId={(connection) => connection.id} pinFirstColumn={false} rowNumbers={false} selectable={false} showToolbar={false} />
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

export function IntegrationDialog({ initialData, item, onClose, onSaved }: { initialData: IntegrationsPageData; item: { provider: IntegrationProvider; connection?: IntegrationConnection } | null; onClose: () => void; onSaved: (connection: IntegrationConnection, shouldConnect: boolean) => void }) {
  const connection = item?.connection;
  const provider = item?.provider ?? "google_workspace";
  const catalogItem = initialData.providerCapabilities.providers.find((entry) => entry.provider === provider) ?? { label: provider.replaceAll("_", " ") };
  const [displayName, setDisplayName] = useState(connection?.displayName ?? `${catalogItem.label} connection`);
  const [legalEntityId, setLegalEntityId] = useState(connection?.legalEntityId ?? (initialData.legalEntities.length === 1 ? initialData.legalEntities[0].id : "none"));
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
      <div className={styles.setupIdentity}><span className={styles.providerIcon}><ProviderMark provider={provider} /></span><div><strong>{catalogItem.label}</strong><small>Choose the account your team will use.</small></div></div>
      {failure ? <Callout title="Could not save connection" tone="danger">{failure}</Callout> : null}
      {connection ? <div className={styles.dialogStatus}><Badge tone={statusTone(connection.status)}>{STATUS_LABELS[connection.status]}</Badge><span>{connection.displayName}</span></div> : null}
      <TextInput prefix={<Tag size={16} aria-hidden="true" />} isRequired label="Connection name" onChange={setDisplayName} value={displayName} />
      <SelectField prefix={<Building2 size={16} aria-hidden="true" />} items={[{ id: "none", label: "Choose organization" }, ...initialData.legalEntities.map((entity) => ({ id: entity.id, label: entity.displayName }))]} label="Organization" onSelectionChange={(key) => key && setLegalEntityId(String(key))} selectedKey={legalEntityId} />
      {provider === "google_workspace" || provider === "custom" ? <TextInput prefix={<Globe2 size={16} aria-hidden="true" />} description={provider === "google_workspace" ? "Verified company domain, without https://" : "Optional external domain"} isRequired={provider === "google_workspace" && !accountEmail} label="Domain" onChange={setExternalDomain} placeholder="igloarchitects.com" value={externalDomain} /> : null}
      {provider === "google_workspace" ? <>
        <TextInput prefix={<Mail size={16} aria-hidden="true" />} label="Google account email" description="For a personal Gmail account, enter its exact address. Domain can be left empty." type="email" value={accountEmail} onChange={setAccountEmail} />
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
