import { companyProfileFixture, type LegalEntityRecord } from "./company-profile";

export type IntegrationProvider = "google_workspace" | "quickbooks" | "zoho_books" | "whatsapp" | "payment" | "custom";
export type IntegrationCatalogId = IntegrationProvider | "zoho_books" | "autodesk_construction_cloud" | "microsoft_365" | "docusign" | "dropbox";
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
  canManage: boolean;
  connections: IntegrationConnection[];
  legalEntities: LegalEntityRecord[];
  workspaceId: string;
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
  availability: "available" | "coming_soon";
}> = [
  { id: "google_workspace", provider: "google_workspace", label: "Google Workspace", source: "workspace.google.com", href: "https://workspace.google.com/", category: "productivity", description: "Connect Google accounts for calendars, Gmail messages, and project documents.", availability: "available" },
  { id: "quickbooks", provider: "quickbooks", label: "QuickBooks", source: "quickbooks.intuit.com", href: "https://quickbooks.intuit.com/", category: "finance", description: "Link accounting records, create invoices, and retrieve available online invoice payment links.", availability: "available" },
  { id: "whatsapp", provider: "whatsapp", label: "WhatsApp Business", source: "business.whatsapp.com", href: "https://business.whatsapp.com/", category: "communication", description: "Connect your own business number for approved messages, replies, and delivery updates.", availability: "available" },
  { id: "zoho_books", provider: "zoho_books", label: "Zoho Books", source: "zoho.com/ae/books", href: "https://www.zoho.com/ae/books/", category: "finance", description: "Connect accounting, invoices, payment pages, bills, expenses, and project financials.", availability: "available" },
  { id: "autodesk_construction_cloud", label: "Autodesk Construction Cloud", source: "construction.autodesk.com", href: "https://construction.autodesk.com/", category: "productivity", description: "Connect design files, project issues, reviews, and construction handover data.", availability: "coming_soon" },
  { id: "microsoft_365", label: "Microsoft 365", source: "microsoft.com/microsoft-365", href: "https://www.microsoft.com/microsoft-365/", category: "productivity", description: "Connect Outlook, calendars, OneDrive, Teams, and secure document collaboration.", availability: "coming_soon" },
  { id: "docusign", label: "Docusign", source: "docusign.com", href: "https://www.docusign.com/solutions/industries/construction", category: "productivity", description: "Send and track client agreements, change orders, and project approvals.", availability: "coming_soon" },
  { id: "payment", provider: "payment", label: "Payment gateway", source: "Provider connection", href: null, category: "finance", description: "Collect payments and receive verified transaction status updates.", availability: "coming_soon" },
  { id: "dropbox", label: "Dropbox", source: "dropbox.com", href: "https://www.dropbox.com/", category: "productivity", description: "Link shared project files and controlled document storage.", availability: "coming_soon" },
];

export const integrationsPageFixture: IntegrationsPageData = {
  canManage: true,
  workspaceId: companyProfileFixture.workspace.id,
  legalEntities: companyProfileFixture.legalEntities,
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
