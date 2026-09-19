"use client";

import { AppShell, Container, DataGrid, DesignSystemProvider, Heading, Skeleton, Surface } from "@/design-system";
import type { ManagedTenant } from "@/lib/internal/types";
import { useWorkspaceTheme } from "@/lib/use-workspace-theme";
import { tenantColumns } from "./portal";
import styles from "./portal.module.css";

export default function InternalLoading() {
  const { theme } = useWorkspaceTheme();
  return <DesignSystemProvider theme={theme === "dark" ? "dark" : "light"} locale="en-AE" currency="AED" timeZone="Asia/Dubai">
    <AppShell title="Wodana Control">
      <Container as="main" className={styles.content} size="full">
        <div className={styles.pageHeader}><div><Heading as="h1" size="lg">Tenants</Heading><p>Customer accounts and their organizations.</p></div></div>
        <Surface aria-label="Tenant summary loading" className={styles.metrics}>
          <div><Skeleton lines={2} /></div><div><Skeleton lines={2} /></div><div><Skeleton lines={2} /></div>
        </Surface>
        <DataGrid<ManagedTenant> ariaLabel="Customer organizations" columns={tenantColumns} data={[]} getRowId={(tenant) => tenant.externalTenantId} isLoading selectable={false} showFooter={false} showToolbar={false} />
      </Container>
    </AppShell>
  </DesignSystemProvider>;
}
