export type ProviderCapabilityCode =
  | "calendar.read"
  | "calendar.write"
  | "email.send"
  | "message.send"
  | "message.delivery_receipt"
  | "lead.ingest"
  | "accounting.read"
  | "invoice.create"
  | "payment.link.read"
  | "payment.receipt.read"
  | "signature.send"
  | "signature.status"
  | "storage.read"
  | "storage.write"
  | "ai.suggest";

export type ProviderCapabilityDefinition = {
  code: ProviderCapabilityCode;
  label: string;
  access: "read" | "write";
  verification: "operation" | "delivery_receipt" | "not_applicable";
};

export type ProviderAdapterDefinition = {
  id: string;
  provider?: "google_workspace" | "quickbooks" | "zoho_books" | "whatsapp";
  label: string;
  source: string;
  href: string | null;
  category: "productivity" | "finance" | "communication" | "developer";
  description: string;
  implementation: "available" | "planned" | "requires_specification";
  setupMode: "tenant_connection" | "platform_managed";
  capabilities: ProviderCapabilityDefinition[];
  operationEvidence: string[];
  deliveryEvidence: string[];
};

const capability = (
  code: ProviderCapabilityCode,
  label: string,
  access: "read" | "write",
  verification: ProviderCapabilityDefinition["verification"] = "operation",
): ProviderCapabilityDefinition => ({ code, label, access, verification });

export const PROVIDER_ADAPTERS: ProviderAdapterDefinition[] = [
  {
    id: "google_workspace",
    provider: "google_workspace",
    label: "Google Workspace",
    source: "workspace.google.com",
    href: "https://workspace.google.com/",
    category: "productivity",
    description: "Calendars, Gmail messages and controlled Drive documents.",
    implementation: "available",
    setupMode: "tenant_connection",
    capabilities: [
      capability("calendar.read", "Read selected calendars", "read"),
      capability("calendar.write", "Create calendar events", "write"),
      capability("email.send", "Send Gmail messages", "write"),
      capability("storage.write", "Create Drive documents", "write"),
    ],
    operationEvidence: ["calendar.event_created", "calendar.event_updated", "email.send", "document.create", "integration.provider_read_succeeded"],
    deliveryEvidence: [],
  },
  {
    id: "quickbooks",
    provider: "quickbooks",
    label: "QuickBooks",
    source: "quickbooks.intuit.com",
    href: "https://quickbooks.intuit.com/",
    category: "finance",
    description: "Accounting records, invoices, payment links and recorded payments.",
    implementation: "available",
    setupMode: "tenant_connection",
    capabilities: [
      capability("accounting.read", "Read accounting records", "read"),
      capability("invoice.create", "Create invoices", "write"),
      capability("payment.link.read", "Read online payment links", "read"),
      capability("payment.receipt.read", "Read recorded payments", "read"),
    ],
    operationEvidence: ["invoice.create", "accounting.invoice_refreshed", "integration.provider_read_succeeded"],
    deliveryEvidence: [],
  },
  {
    id: "zoho_books",
    provider: "zoho_books",
    label: "Zoho Books",
    source: "zoho.com/books",
    href: "https://www.zoho.com/books/",
    category: "finance",
    description: "Accounting records, invoices, payment links, bills and expenses.",
    implementation: "available",
    setupMode: "tenant_connection",
    capabilities: [
      capability("accounting.read", "Read accounting records", "read"),
      capability("invoice.create", "Create invoices", "write"),
      capability("payment.link.read", "Read online payment links", "read"),
      capability("payment.receipt.read", "Read recorded payments", "read"),
    ],
    operationEvidence: ["invoice.create", "accounting.invoice_refreshed", "integration.provider_read_succeeded"],
    deliveryEvidence: [],
  },
  {
    id: "whatsapp",
    provider: "whatsapp",
    label: "WhatsApp Business",
    source: "business.whatsapp.com",
    href: "https://business.whatsapp.com/",
    category: "communication",
    description: "Approved business messages, replies and provider delivery receipts.",
    implementation: "available",
    setupMode: "tenant_connection",
    capabilities: [
      capability("message.send", "Send approved messages", "write"),
      capability("message.delivery_receipt", "Receive delivery and read receipts", "read", "delivery_receipt"),
    ],
    operationEvidence: ["message.send"],
    deliveryEvidence: ["provider.webhook_received"],
  },
  {
    id: "wodana_ai",
    label: "Wodana AI review",
    source: "Platform managed",
    href: null,
    category: "developer",
    description: "Evidence-linked suggestions that always require staff review before applying.",
    implementation: "available",
    setupMode: "platform_managed",
    capabilities: [capability("ai.suggest", "Draft reviewable suggestions", "write", "not_applicable")],
    operationEvidence: [],
    deliveryEvidence: [],
  },
  {
    id: "meta_lead_ads",
    label: "Meta Lead Ads",
    source: "Meta Business",
    href: "https://www.facebook.com/business/ads/ad-objectives/lead-generation",
    category: "communication",
    description: "Facebook and Instagram lead forms require tenant Business, Page and form authorization.",
    implementation: "requires_specification",
    setupMode: "tenant_connection",
    capabilities: [capability("lead.ingest", "Receive attributed lead forms", "write", "delivery_receipt")],
    operationEvidence: [],
    deliveryEvidence: [],
  },
  {
    id: "plyleads",
    label: "PlyLeads",
    source: "Provider specification required",
    href: null,
    category: "communication",
    description: "Automatic intake remains unavailable until an API or webhook contract and credentials are supplied.",
    implementation: "requires_specification",
    setupMode: "tenant_connection",
    capabilities: [capability("lead.ingest", "Receive attributed enquiries", "write", "delivery_receipt")],
    operationEvidence: [],
    deliveryEvidence: [],
  },
  {
    id: "payment",
    label: "Payment gateway",
    source: "Provider selection required",
    href: null,
    category: "finance",
    description: "Collect payments and receive independently verified transaction status.",
    implementation: "planned",
    setupMode: "tenant_connection",
    capabilities: [
      capability("payment.link.read", "Create or read payment links", "write"),
      capability("payment.receipt.read", "Receive payment confirmation", "read", "delivery_receipt"),
    ],
    operationEvidence: [],
    deliveryEvidence: [],
  },
  {
    id: "docusign",
    label: "Docusign",
    source: "docusign.com",
    href: "https://www.docusign.com/solutions/industries/construction",
    category: "productivity",
    description: "Send and track agreements, change orders and formal signatures.",
    implementation: "planned",
    setupMode: "tenant_connection",
    capabilities: [
      capability("signature.send", "Send signature envelopes", "write"),
      capability("signature.status", "Receive signature status", "read", "delivery_receipt"),
    ],
    operationEvidence: [],
    deliveryEvidence: [],
  },
  {
    id: "dropbox",
    label: "Dropbox",
    source: "dropbox.com",
    href: "https://www.dropbox.com/",
    category: "productivity",
    description: "Controlled shared project files and document storage.",
    implementation: "planned",
    setupMode: "tenant_connection",
    capabilities: [
      capability("storage.read", "Read selected files", "read"),
      capability("storage.write", "Write selected files", "write"),
    ],
    operationEvidence: [],
    deliveryEvidence: [],
  },
  {
    id: "microsoft_365",
    label: "Microsoft 365",
    source: "microsoft.com/microsoft-365",
    href: "https://www.microsoft.com/microsoft-365/",
    category: "productivity",
    description: "Outlook, calendars, OneDrive and Teams collaboration.",
    implementation: "planned",
    setupMode: "tenant_connection",
    capabilities: [
      capability("calendar.read", "Read selected calendars", "read"),
      capability("calendar.write", "Create calendar events", "write"),
      capability("email.send", "Send Outlook messages", "write"),
      capability("storage.read", "Read selected OneDrive files", "read"),
      capability("storage.write", "Write selected OneDrive files", "write"),
    ],
    operationEvidence: [],
    deliveryEvidence: [],
  },
  {
    id: "autodesk_construction_cloud",
    label: "Autodesk Construction Cloud",
    source: "construction.autodesk.com",
    href: "https://construction.autodesk.com/",
    category: "productivity",
    description: "Design files, project issues, reviews and handover records.",
    implementation: "planned",
    setupMode: "tenant_connection",
    capabilities: [
      capability("storage.read", "Read selected project files", "read"),
      capability("storage.write", "Write controlled project files", "write"),
    ],
    operationEvidence: [],
    deliveryEvidence: [],
  },
];

export type CapabilityConnection = {
  id: string;
  provider: string;
  status: "draft" | "pending" | "connected" | "degraded" | "revoked";
  displayName: string;
  updatedAt: string | Date;
};

export type CapabilityEvidence = {
  connectionId: string;
  action: string;
  occurredAt: string | Date;
};

export function providerCapabilityView(
  connections: CapabilityConnection[],
  evidence: CapabilityEvidence[],
) {
  return PROVIDER_ADAPTERS.map((adapter) => {
    const { operationEvidence, deliveryEvidence, ...publicAdapter } = adapter;
    const connection = adapter.provider
      ? connections
          .filter((item) => item.provider === adapter.provider && item.status !== "revoked")
          .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0]
      : undefined;
    const connectionEvidence = connection
      ? evidence
          .filter((item) => item.connectionId === connection.id)
          .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
      : [];
    const delivery = connectionEvidence.find((item) => deliveryEvidence.includes(item.action));
    const operation = connectionEvidence.find((item) => operationEvidence.includes(item.action));
    const failure = connectionEvidence.find((item) => item.action === "integration.provider_read_failed");
    const newestSuccess = delivery ?? operation;
    const failureIsLatest = failure && (!newestSuccess || new Date(failure.occurredAt) > new Date(newestSuccess.occurredAt));
    const configurationState = adapter.setupMode === "platform_managed"
      ? "platform_managed"
      : adapter.implementation !== "available"
        ? "unavailable"
        : !connection
          ? "not_configured"
          : connection.status === "connected"
            ? "connected"
            : connection.status === "degraded"
              ? "needs_attention"
              : "configured";
    const verificationState = adapter.setupMode === "platform_managed"
      ? "not_applicable"
      : failureIsLatest
        ? "failed"
        : delivery
          ? "delivery_verified"
          : operation
            ? "operation_confirmed"
            : "not_tested";
    return {
      ...publicAdapter,
      configurationState,
      verificationState,
      verifiedAt: newestSuccess ? new Date(newestSuccess.occurredAt).toISOString() : null,
      connection: connection
        ? { id: connection.id, displayName: connection.displayName, status: connection.status }
        : null,
    };
  });
}
