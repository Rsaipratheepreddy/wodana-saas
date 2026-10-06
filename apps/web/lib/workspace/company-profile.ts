export type CompanyAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
};

export type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  status: string;
  defaultCurrency: string;
  defaultLocale: string;
  defaultTimezone: string;
  unitSystem: string;
  weekStartsOn: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type LegalEntityRecord = {
  id: string;
  workspaceId: string;
  code: string;
  displayName: string;
  registeredName: string;
  countryCode: string;
  baseCurrency: string;
  locale: string;
  timezone: string;
  taxRegistrationNumber: string | null;
  registrationNumber: string | null;
  address: CompanyAddress;
  /** What the business's documents print (PLM-112). */
  phone?: string | null;
  email?: string | null;
  letterheadFooter?: string | null;
  logoUrl?: string | null;
  letterheadUrl?: string | null;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type BusinessUnitRecord = {
  id: string;
  legalEntityId: string;
  parentBusinessUnitId: string | null;
  code: string;
  name: string;
  type: string;
  timezone: string;
  status: string;
  version: number;
};

export type WorkspaceTerminologyItem = {
  key: string;
  defaultVisibleName: string;
  defaultVisibleNamePlural: string;
  visibleName: string;
  visibleNamePlural: string;
  overridden: boolean;
  version: number;
  updatedAt: string | null;
};

export type WorkspaceTerminologyData = {
  items: WorkspaceTerminologyItem[];
  map: Record<string, { visibleName: string; visibleNamePlural: string }>;
};

export type WorkspaceConfigurationChange = {
  path: string;
  before?: unknown;
  after?: unknown;
};

export type WorkspaceConfigurationRevision = {
  id: string;
  resourceType: string;
  resourceId: string;
  revisionNumber: number;
  sourceVersion: number;
  action: "baseline" | "created" | "saved" | "archived" | "restored_default" | "rolled_back";
  snapshot: Record<string, unknown>;
  sourceRevisionId: string | null;
  createdBy: string | null;
  createdAt: string;
  changes: WorkspaceConfigurationChange[];
};

export type CompanyProfileData = {
  workspace: WorkspaceRecord;
  legalEntities: LegalEntityRecord[];
  businessUnits: BusinessUnitRecord[];
  branding: {
    logoAssetId: string | null;
    logoUrl: string | null;
    logoUpdatedAt: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
    headingFont: string | null;
    bodyFont: string | null;
  };
  terminology: Record<string, { visibleName: string; visibleNamePlural: string }>;
};

export type CompanyProfileUpdate = {
  workspace: WorkspaceRecord;
  legalEntity: LegalEntityRecord;
};

export const companyProfileFixture: CompanyProfileData = {
  workspace: {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Iglo Architects",
    slug: "iglo-architects",
    status: "active",
    defaultCurrency: "AED",
    defaultLocale: "en-AE",
    defaultTimezone: "Asia/Dubai",
    unitSystem: "metric",
    weekStartsOn: 1,
    version: 1,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
  },
  legalEntities: [{
    id: "00000000-0000-4000-8000-000000000003",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    code: "IGLO",
    displayName: "Iglo Architects",
    registeredName: "Iglo Architects LLC",
    countryCode: "AE",
    baseCurrency: "AED",
    locale: "en-AE",
    timezone: "Asia/Dubai",
    taxRegistrationNumber: "100000000000003",
    registrationNumber: "CN-47291",
    address: {
      line1: "Dubai Design District",
      city: "Dubai",
      region: "Dubai",
      postalCode: "00000",
    },
    status: "active",
    version: 1,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
  }],
  businessUnits: [],
  branding: {
    logoAssetId: null,
    logoUrl: null,
    logoUpdatedAt: null,
    primaryColor: null,
    secondaryColor: null,
    headingFont: null,
    bodyFont: null,
  },
  terminology: {
    workspace: { visibleName: "Workspace", visibleNamePlural: "Workspaces" },
    crm: { visibleName: "CRM", visibleNamePlural: "CRM" },
    lead: { visibleName: "Lead", visibleNamePlural: "Leads" },
    opportunity: { visibleName: "Deal", visibleNamePlural: "Deals" },
    client: { visibleName: "Client", visibleNamePlural: "Clients" },
    pre_execution: { visibleName: "Planning", visibleNamePlural: "Planning" },
    quotation: { visibleName: "Quotation", visibleNamePlural: "Quotations" },
    catalog: { visibleName: "Catalog", visibleNamePlural: "Catalogs" },
    vendor: { visibleName: "Vendor", visibleNamePlural: "Vendors" },
    procurement: { visibleName: "Procurement", visibleNamePlural: "Procurement" },
    project: { visibleName: "Project", visibleNamePlural: "Projects" },
    business_unit: { visibleName: "Business unit", visibleNamePlural: "Business units" },
    team: { visibleName: "Team", visibleNamePlural: "Teams" },
    resource: { visibleName: "Resource", visibleNamePlural: "Resources" },
    schedule: { visibleName: "Schedule", visibleNamePlural: "Schedules" },
    file: { visibleName: "File", visibleNamePlural: "Files" },
  },
};
