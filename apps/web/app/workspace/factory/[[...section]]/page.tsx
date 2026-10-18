import { notFound, redirect } from "next/navigation";
import { FactoryPage } from "@/components/factory/factory-page";
import { FACTORY_SECTIONS, type FactorySection } from "@/lib/factory/sections";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Factory: To make (default) and Work orders. */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const requested = section?.[0] ?? "to-make";
  if ((section?.length ?? 0) > 1 || !FACTORY_SECTIONS.includes(requested as FactorySection)) notFound();
  return <FactoryPage workspaceId={membership.workspaceId} section={requested as FactorySection} />;
}
