import type { Metadata } from "next";
import { InternalPortal } from "./portal";
import { getInternalPortalData } from "@/lib/internal/server";

export const metadata: Metadata = {
  title: "Tenants · Wodana Control",
  description: "Manage Wodana tenants and their subscriptions.",
};

export default async function InternalPage() {
  const { operator, tenants } = await getInternalPortalData();
  return <InternalPortal initialTenants={tenants} user={{
    email: operator.email,
    name: operator.displayName,
    role: operator.role,
    permissions: operator.permissions,
  }} />;
}
