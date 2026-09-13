"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { Braces, CreditCard, ExternalLink, Search, Unplug } from "lucide-react";
import { siAutodesk, siDropbox, siQuickbooks, siWhatsapp, siZoho, type SimpleIcon } from "simple-icons";
import {
  Badge,
  Button,
  Callout,
  ConfirmationDialog,
  ControlledModalDialog,
  DesignSystemProvider,
  SelectField,
  Switch,
  TextInput,
} from "@/design-system";
import {
  integrationCatalog,
  type IntegrationCatalogId,
  type IntegrationConnection,
  type IntegrationProvider,
  type IntegrationsPageData,
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

function ProviderMark({ provider }: { provider: IntegrationCatalogId }) {
  if (provider === "google_workspace") return <GoogleWorkspaceMark />;
  if (provider === "quickbooks") return <SimpleBrandMark icon={siQuickbooks} />;
  if (provider === "whatsapp") return <SimpleBrandMark icon={siWhatsapp} />;
  if (provider === "zoho_books") return <SimpleBrandMark icon={siZoho} />;
  if (provider === "autodesk_construction_cloud") return <SimpleBrandMark icon={siAutodesk} />;
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
  const [editor, setEditor] = useState<{ provider: IntegrationProvider; connection?: IntegrationConnection; startAfterSave?: boolean } | null>(null);
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

  const visibleCatalog = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return integrationCatalog.filter((item) =>
      !normalized || `${item.label} ${item.source} ${item.description} ${item.category}`.toLowerCase().includes(normalized),
    );
  }, [query]);
  const availableProviders = new Set(integrationCatalog.filter((item) => item.availability === "available").map((item) => item.provider));
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

  return <DesignSystemProvider className={styles.provider} portalContainer={portalContainer} ref={setPortalContainer}>
    <section aria-labelledby="integrations-heading" className={styles.page}>
      <header className={styles.pageHeading}>
        <h1 id="integrations-heading">Integrations &amp; connected apps</h1>
        <p>Connect the tools used across your organization.</p>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.summary}>
          <span><strong>{connectedCount}</strong> connected</span>
          <span><strong>{activeConnections.length}</strong> configured</span>
          <span data-attention={attentionCount ? true : undefined}><strong>{attentionCount}</strong> need attention</span>
        </div>
      </div>

      {status ? <p aria-live="polite" className={styles.liveStatus}>{status}</p> : null}
      {failure ? <Callout title="Integration action failed" tone="danger">{failure}</Callout> : null}

      <div className={styles.catalogTools}>
        <label className={styles.searchField}>
          <Search aria-hidden="true" size={15} />
          <input aria-label="Search integrations" onChange={(event) => setQuery(event.target.value)} placeholder="Search" type="search" value={query} />
        </label>
      </div>

      {visibleCatalog.length ? <div className={styles.catalogGrid}>
        {visibleCatalog.map((item) => {
          const connection = item.provider ? newestActiveConnection(connections, item.provider) : undefined;
          const selected = Boolean(connection && ["pending", "connected", "degraded"].includes(connection.status));
          const isAvailable = item.availability === "available" && Boolean(item.provider);
          return <article aria-label={`${item.label} integration`} className={styles.integrationCard} data-provider={item.id} key={item.id}>
            <div className={styles.cardBody}>
              <header>
                <div>
                  <strong>{item.label}</strong>
                  {item.href ? <a href={item.href} rel="noreferrer" target="_blank">{item.source}<ExternalLink aria-hidden="true" size={10} /></a> : <small>{item.source}</small>}
                </div>
                <span className={styles.providerIcon}><ProviderMark provider={item.id} /></span>
              </header>
              <p>{item.description}</p>
              {isAvailable && connection ? <small className={styles.connectionName}>{connection.displayName}{connection.legalEntityName ? ` · ${connection.legalEntityName}` : ""}{connection.legalEntityCurrency ? ` · ${connection.legalEntityCurrency}` : ""}</small> : null}
              {connection?.healthIssues?.length ? <small className={styles.healthIssue}>{connection.healthIssues[0]}</small> : null}
            </div>
            <footer>
              <span className={styles.cardActions}>
                {isAvailable && item.provider
                  ? <Button onPress={() => setEditor({ provider: item.provider!, connection })} size="compact">View integration</Button>
                  : <Button isDisabled size="compact">View integration</Button>}
                {connection && ["connected", "degraded"].includes(connection.status)
                  ? <Button isDisabled={!initialData.canManage} onPress={() => setEditor({ provider: connection.provider, startAfterSave: true })} size="compact" variant="quiet">Connect another</Button>
                  : null}
              </span>
              <span className={styles.connectionControl}>
                {!isAvailable ? <Badge>Coming soon</Badge> : connection ? <Badge tone={statusTone(connection.status)}>{STATUS_LABELS[connection.status]}</Badge> : <Badge>Not connected</Badge>}
                <Switch
                  aria-label={isAvailable ? `${selected ? "Disconnect" : "Connect"} ${item.label}` : `${item.label} is coming soon`}
                  isDisabled={!isAvailable || !initialData.canManage || connection?.status === "pending" || connectingId === connection?.id}
                  isSelected={isAvailable && selected}
                  onChange={(enabled) => {
                    if (!item.provider) return;
                    if (!connection) setEditor({ provider: item.provider, startAfterSave: true });
                    else if (enabled) void connect(connection);
                    else setRevoking(connection);
                  }}
                />
              </span>
            </footer>
          </article>;
        })}
      </div> : <div className={styles.noResults}><Unplug aria-hidden="true" size={20} /><strong>No integrations found</strong><span>Try a different category or search.</span></div>}
      {activeConnections.length ? <section aria-label="Configured accounts" className={styles.accounts}>
        <h2>Configured accounts</h2>
        {activeConnections.map((connection) => <div className={styles.accountRow} key={connection.id}>
          <div><strong>{connection.displayName}</strong><p>{connection.externalAccountId ?? connection.externalDomain ?? connection.provider} · {connection.legalEntityName ?? "Organization not mapped"}{connection.legalEntityCurrency ? ` · ${connection.legalEntityCurrency}` : ""}</p>{connection.healthIssues?.map((issue) => <small className={styles.healthIssue} key={issue}>{issue}</small>)}</div>
          <Badge tone={statusTone(connection.status)}>{STATUS_LABELS[connection.status]}</Badge>
          {connection.status === "connected" ? <Button onPress={() => setToolConnection(connection)}>Open tools</Button> : <Button isDisabled={!initialData.canManage} onPress={() => void connect(connection)}>Connect</Button>}
          {["connected", "degraded"].includes(connection.status) ? <Button isDisabled={!initialData.canManage} onPress={() => setEditor({ provider: connection.provider, startAfterSave: true })}>Connect another</Button> : null}
          <Button isDisabled={!initialData.canManage} onPress={() => setRevoking(connection)}>Disconnect</Button>
        </div>)}
        {initialData.canManage ? <div className={styles.accountRow}>{integrationCatalog.filter((item) => item.availability === "available").map((item) => <Button key={item.id} onPress={() => setEditor({ provider: item.provider! })}>Add {item.label} account</Button>)}</div> : null}
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

function IntegrationDialog({ initialData, item, onClose, onSaved }: { initialData: IntegrationsPageData; item: { provider: IntegrationProvider; connection?: IntegrationConnection; startAfterSave?: boolean } | null; onClose: () => void; onSaved: (connection: IntegrationConnection, shouldConnect: boolean) => void }) {
  const connection = item?.connection;
  const provider = item?.provider ?? "google_workspace";
  const catalogItem = integrationCatalog.find((entry) => entry.provider === provider)!;
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

  const save = async (event: FormEvent) => {
    event.preventDefault();
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
      onSaved(await response.json() as IntegrationConnection, Boolean(item?.startAfterSave));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The integration connection could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return <ControlledModalDialog description="Configure the connection first. Enabling it starts provider authorization; credentials are never stored in this form." footer={<div className="wd-dialog-actions"><Button isDisabled={saving} onPress={onClose}>Cancel</Button><Button form={formId} isDisabled={!initialData.canManage} isLoading={saving} type="submit" variant="primary">{connection ? "Save changes" : item?.startAfterSave ? "Save and connect" : "Save draft"}</Button></div>} isDismissable={!saving} isOpen={Boolean(item)} onOpenChange={(open) => { if (!open && !saving) onClose(); }} title={connection ? `Manage ${catalogItem.label}` : `Connect ${catalogItem.label}`}>
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
