import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { isCrmFirstWorkspace, type DeferredModule } from "@/lib/workspace/module-rollout";
import styles from "./page.module.css";
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
  return <main className={styles.page}>
    <p className={styles.eyebrow}>{t("In progress")}</p>
    <h1>{t("{module} is being prepared for your team.", { module: t(labels[requested] as never) })}</h1>
    <p>{t("We’ll make it available here when it’s ready.")}</p>
    <Link href="/workspace/crm">{t("Back to CRM")}</Link>
  </main>;
}
