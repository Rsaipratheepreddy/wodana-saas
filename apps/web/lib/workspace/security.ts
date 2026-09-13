export type SecuritySession = {
  familyId: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  current: boolean;
};

export type SecurityPolicy = {
  accessTokenMinutes: number;
  refreshSessionDays: number;
  maxFailedAttempts: number;
  lockMinutes: number;
  minimumPasswordLength: number;
  maxActiveDevices: number | null;
};

export type SecurityPageData = {
  authenticationMethod: string;
  currentUserEmail: string;
  currentUserName: string;
  passwordChangedAt: string | null;
  policy: SecurityPolicy;
  referenceTime: string;
  sessions: SecuritySession[];
  workspaceId: string;
};

export const securityPageFixture: SecurityPageData = {
  authenticationMethod: "local",
  currentUserEmail: "admin@igloarchitects.com",
  currentUserName: "Iglo Administrator",
  passwordChangedAt: "2026-08-28T06:00:00.000Z",
  policy: {
    accessTokenMinutes: 15,
    refreshSessionDays: 30,
    maxFailedAttempts: 5,
    lockMinutes: 15,
    minimumPasswordLength: 10,
    maxActiveDevices: 2,
  },
  referenceTime: "2026-09-06T06:00:00.000Z",
  sessions: [
    {
      familyId: "81000000-0000-4000-8000-000000000001",
      createdAt: "2026-09-06T03:30:00.000Z",
      lastActiveAt: "2026-09-06T05:58:00.000Z",
      expiresAt: "2026-10-06T05:58:00.000Z",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
      ipAddress: "127.0.0.1",
      current: true,
    },
    {
      familyId: "81000000-0000-4000-8000-000000000002",
      createdAt: "2026-09-05T12:00:00.000Z",
      lastActiveAt: "2026-09-05T12:35:00.000Z",
      expiresAt: "2026-10-05T12:35:00.000Z",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
      ipAddress: "192.0.2.24",
      current: false,
    },
    {
      familyId: "81000000-0000-4000-8000-000000000003",
      createdAt: "2026-09-02T07:20:00.000Z",
      lastActiveAt: "2026-09-04T09:15:00.000Z",
      expiresAt: "2026-10-04T09:15:00.000Z",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/140.0",
      ipAddress: "198.51.100.18",
      current: false,
    },
  ],
  workspaceId: "00000000-0000-4000-8000-000000000002",
};
