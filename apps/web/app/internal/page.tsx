import type { Metadata } from "next";
import { InternalPortal } from "./portal";
import { getInternalPortalData } from "@/lib/internal/server";

export const metadata: Metadata = {
  title: "Tenants · Wodana Control",
  description: "Manage Wodana tenants and their subscriptions.",
};

export default async function InternalPage() {
  const { profile, tenants } = await getInternalPortalData();
  return <InternalPortal initialTenants={tenants} user={{ email: profile.primaryEmail, name: profile.displayName }} />;
}
