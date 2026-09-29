import { tKey } from "@/lib/i18n/keys";
import { companyProfileFixture, type LegalEntityRecord } from "./company-profile";

export type IntegrationProvider = "google_workspace" | "quickbooks" | "zoho_books" | "whatsapp" | "payment" | "custom";
export type IntegrationCatalogId = IntegrationProvider | "zoho_books" | "autodesk_construction_cloud" | "microsoft_365" | "docusign" | "dropbox" | "meta_lead_ads" | "plyleads";
export type IntegrationStatus = "draft" | "pending" | "connected" | "degraded" | "revoked";

export type IntegrationConnection = {
  id: string;
  legalEntityId: string | null;
  legalEntityName?: string | null;
  legalEntityCurrency?: string | null;
  workspaceCurrency?: string | null;
  healthIssues?: string[];
  provider: IntegrationProvider;
  displayName: string;
  externalAccountId?: string | null;
  externalDomain: string | null;
  status: IntegrationStatus;
  grantedScopes?: string[];
  lastSyncedAt?: string | null;
  lastErrorCode?: string | null;
  configuration?: Record<string, unknown>;
  version: number;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type IntegrationsPageData = {
  loadError?: string;
  canManage: boolean;
  connections: IntegrationConnection[];
  legalEntities: LegalEntityRecord[];
  providerCapabilities: ProviderCapabilitiesResponse;
  workspaceId: string;
  /**
   * Whether Wodana's own app for each provider is set up (Wodana Control), so firms can connect it.
   * Missing when that couldn't be checked: Connect then stays available and the provider answers.
   */
  platformReadiness?: Partial<Record<IntegrationProvider, boolean>>;
};

export type ProviderCapability = {
  code: "calendar.read" | "calendar.write" | "email.send" | "message.send" | "message.delivery_receipt" | "lead.ingest" | "accounting.read" | "invoice.create" | "payment.link.read" | "payment.receipt.read" | "signature.send" | "signature.status" | "storage.read" | "storage.write" | "ai.suggest";
  label: string;
  access: "read" | "write";
  verification: "operation" | "delivery_receipt" | "not_applicable";
};

export type ProviderCapabilityState = {
  id: IntegrationCatalogId | "wodana_ai";
  provider?: IntegrationProvider;
  label: string;
  source: string;
  href: string | null;
  category: IntegrationCategory;
  description: string;
  implementation: "available" | "planned" | "requires_specification";
  setupMode: "tenant_connection" | "platform_managed";
  capabilities: ProviderCapability[];
  configurationState: "not_configured" | "configured" | "connected" | "needs_attention" | "unavailable" | "platform_managed";
  verificationState: "not_applicable" | "not_tested" | "operation_confirmed" | "delivery_verified" | "failed";
  verifiedAt: string | null;
  connection: { id: string; displayName: string; status: IntegrationStatus } | null;
};

export type ProviderCapabilitiesResponse = {
  generatedAt: string;
  providers: ProviderCapabilityState[];
};

export type IntegrationCategory = "productivity" | "finance" | "communication" | "developer";

export const integrationCatalog: Array<{
  id: IntegrationCatalogId;
  provider?: IntegrationProvider;
  label: string;
  source: string;
  href: string | null;
  category: IntegrationCategory;
  description: string;
  availability: "available" | "coming_soon" | "not_connected";
}> = [
  { id: "google_workspace", provider: "google_workspace", label: "Google Workspace", source: "workspace.google.com", href: "https://workspace.google.com/", category: "productivity", description: tKey("Connect Google accounts for calendars, Gmail messages, and project documents."), availability: "available" },
  { id: "quickbooks", provider: "quickbooks", label: "QuickBooks", source: "quickbooks.intuit.com", href: "https://quickbooks.intuit.com/", category: "finance", description: tKey("Link accounting records, create invoices, and retrieve available online invoice payment links."), availability: "available" },
  { id: "whatsapp", provider: "whatsapp", label: "WhatsApp Business", source: "business.whatsapp.com", href: "https://business.whatsapp.com/", category: "communication", description: tKey("Connect your own business number for approved messages, replies, and delivery updates."), availability: "available" },
  { id: "zoho_books", provider: "zoho_books", label: "Zoho Books", source: "zoho.com/ae/books", href: "https://www.zoho.com/ae/books/", category: "finance", description: tKey("Connect accounting, invoices, payment pages, bills, expenses, and project financials."), availability: "available" },
  { id: "autodesk_construction_cloud", label: "Autodesk Construction Cloud", source: "construction.autodesk.com", href: "https://construction.autodesk.com/", category: "productivity", description: tKey("Connect design files, project issues, reviews, and construction handover data."), availability: "coming_soon" },
  { id: "microsoft_365", label: "Microsoft 365", source: "microsoft.com/microsoft-365", href: "https://www.microsoft.com/microsoft-365/", category: "productivity", description: tKey("Connect Outlook, calendars, OneDrive, Teams, and secure document collaboration."), availability: "coming_soon" },
  { id: "docusign", label: "Docusign", source: "docusign.com", href: "https://www.docusign.com/solutions/industries/construction", category: "productivity", description: tKey("Send and track client agreements, change orders, and project approvals."), availability: "coming_soon" },
  { id: "payment", provider: "payment", label: tKey("Payment gateway"), source: tKey("Provider connection"), href: null, category: "finance", description: tKey("Collect payments and receive verified transaction status updates."), availability: "coming_soon" },
  { id: "dropbox", label: "Dropbox", source: "dropbox.com", href: "https://www.dropbox.com/", category: "productivity", description: tKey("Link shared project files and controlled document storage."), availability: "coming_soon" },
  { id: "meta_lead_ads", label: "Meta Lead Ads", source: "Meta Business", href: "https://www.facebook.com/business/ads/ad-objectives/lead-generation", category: "communication", description: tKey("Native Facebook and Instagram lead-form intake needs the tenant’s Meta business, page and lead-form authorization."), availability: "not_connected" },
  { id: "plyleads", label: "PlyLeads", source: tKey("Provider specification required"), href: null, category: "communication", description: tKey("Automatic intake remains unavailable until the provider supplies an API or webhook specification and credentials."), availability: "not_connected" },
];

const capabilitiesByProvider: Partial<Record<ProviderCapabilityState["id"], ProviderCapability[]>> = {
  google_workspace: [
    { code: "calendar.read", label: tKey("Read selected calendars"), access: "read", verification: "operation" },
    { code: "calendar.write", label: tKey("Create calendar events"), access: "write", verification: "operation" },
    { code: "email.send", label: tKey("Send Gmail messages"), access: "write", verification: "operation" },
    { code: "storage.write", label: tKey("Create Drive documents"), access: "write", verification: "operation" },
  ],
  quickbooks: [{ code: "accounting.read", label: tKey("Read accounting records"), access: "read", verification: "operation" }],
  zoho_books: [{ code: "accounting.read", label: tKey("Read accounting records"), access: "read", verification: "operation" }],
  whatsapp: [
    { code: "message.send", label: tKey("Send approved messages"), access: "write", verification: "operation" },
    { code: "message.delivery_receipt", label: tKey("Receive delivery and read receipts"), access: "read", verification: "delivery_receipt" },
  ],
  meta_lead_ads: [{ code: "lead.ingest", label: tKey("Receive attributed lead forms"), access: "write", verification: "delivery_receipt" }],
  plyleads: [{ code: "lead.ingest", label: tKey("Receive attributed enquiries"), access: "write", verification: "delivery_receipt" }],
};

export const providerCapabilitiesFixture: ProviderCapabilitiesResponse = {
  generatedAt: "2026-09-18T08:00:00.000Z",
  providers: [
    ...integrationCatalog.map((item): ProviderCapabilityState => {
      const available = item.availability === "available";
      const connected = item.id === "google_workspace";
      return {
        id: item.id,
        provider: item.provider,
        label: item.label,
        source: item.source,
        href: item.href,
        category: item.category,
        description: item.description,
        implementation: available ? "available" : item.availability === "coming_soon" ? "planned" : "requires_specification",
        setupMode: "tenant_connection",
        capabilities: capabilitiesByProvider[item.id] ?? [],
        configurationState: connected ? "connected" : available ? "not_configured" : "unavailable",
        verificationState: connected ? "operation_confirmed" : "not_tested",
        verifiedAt: connected ? "2026-09-18T07:45:00.000Z" : null,
        connection: connected ? { id: "40000000-0000-4000-8000-000000000001", displayName: "Iglo Google Workspace", status: "connected" } : null,
      };
    }),
    {
      id: "wodana_ai",
      label: tKey("Wodana AI review"),
      source: tKey("Platform managed"),
      href: null,
      category: "developer",
      description: tKey("Evidence-linked suggestions that require staff review before applying."),
      implementation: "available",
      setupMode: "platform_managed",
      capabilities: [{ code: "ai.suggest", label: tKey("Draft reviewable suggestions"), access: "write", verification: "not_applicable" }],
      configurationState: "platform_managed",
      verificationState: "not_applicable",
      verifiedAt: null,
      connection: null,
    },
  ],
};

export const integrationsPageFixture: IntegrationsPageData = {
  canManage: true,
  workspaceId: companyProfileFixture.workspace.id,
  legalEntities: companyProfileFixture.legalEntities,
  providerCapabilities: providerCapabilitiesFixture,
  platformReadiness: { google_workspace: true, quickbooks: true, zoho_books: true, whatsapp: true },
  connections: [{
    id: "40000000-0000-4000-8000-000000000001",
    legalEntityId: companyProfileFixture.legalEntities[0].id,
    legalEntityName: companyProfileFixture.legalEntities[0].displayName,
    provider: "google_workspace",
    displayName: "Iglo Google Workspace",
    externalDomain: "igloarchitects.com",
    status: "connected",
    grantedScopes: ["directory.read", "calendar.read"],
    lastSyncedAt: "2026-09-06T04:15:00.000Z",
    configuration: {},
    version: 1,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-06T04:15:00.000Z",
  }],
};
