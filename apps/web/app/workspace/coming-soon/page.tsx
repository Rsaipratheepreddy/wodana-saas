import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { isCrmFirstWorkspace, type DeferredModule } from "@/lib/workspace/module-rollout";
import { EmptyState, PageShell } from "@/design-system";
import { getServerT } from "@/lib/i18n/server";
import { tKey } from "@/lib/i18n/keys";

const labels: Record<DeferredModule, string> = {
  "pre-project": tKey("Planning"),
  projects: tKey("Projects"),
};

export default async function ComingSoonPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const profile = await getAuthenticatedProfile();
  const t = await getServerT();
  const requested = (await searchParams).module;
  if (!isCrmFirstWorkspace(profile.memberships[0]?.workspaceSlug ?? "") || (requested !== "pre-project" && requested !== "projects")) redirect("/workspace");
  const name = t(labels[requested] as never);
  return <PageShell title={name}>
    <EmptyState title={t("{module} is being prepared for your team.", { module: name })} description={t("We’ll make it available here when it’s ready.")}
      action={<Link className="wd-button" href="/workspace/crm">{t("Back to CRM")}</Link>} />
  </PageShell>;
}
