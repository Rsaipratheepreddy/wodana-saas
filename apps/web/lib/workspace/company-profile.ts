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

export type CompanyProfileData = {
  workspace: WorkspaceRecord;
  legalEntities: LegalEntityRecord[];
  businessUnits: BusinessUnitRecord[];
  branding: {
    logoAssetId: string | null;
    logoUrl: string | null;
    logoUpdatedAt: string | null;
  };
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
  },
};
