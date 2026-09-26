import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DesignPackagesSettings } from "@/components/crm/design-packages-settings";
import { ACCESS_COOKIE, businessApiUrl, getAuthenticatedProfile } from "@/lib/auth/server";

const MANAGERS = new Set(["owner", "administrator", "sales_manager", "sales_admin", "ops_admin"]);

/** Settings → Design packages: the design fee, its deposit and journey timings (used from Sales to Planning). */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const workspace = token ? await fetch(businessApiUrl(`/workspaces/${membership.workspaceId}`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null) : null;
  return <DesignPackagesSettings workspaceId={membership.workspaceId} currency={workspace?.workspace?.defaultCurrency ?? ""} locale={workspace?.workspace?.defaultLocale} canManage={membership.roles.some((role) => MANAGERS.has(role))} />;
}
