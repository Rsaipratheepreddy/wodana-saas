import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { isCrmFirstWorkspace, type DeferredModule } from "@/lib/workspace/module-rollout";
import styles from "./page.module.css";

const labels: Record<DeferredModule, string> = {
  "pre-project": "Pre-execution",
  projects: "Projects",
};

export default async function ComingSoonPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const profile = await getAuthenticatedProfile();
  const module = (await searchParams).module;
  if (!isCrmFirstWorkspace(profile.memberships[0]?.workspaceSlug ?? "") || (module !== "pre-project" && module !== "projects")) redirect("/workspace");
  return <main className={styles.page}>
    <p className={styles.eyebrow}>In progress</p>
    <h1>{labels[module]} is being prepared for your team.</h1>
    <p>We’ll make it available here when it’s ready.</p>
    <Link href="/workspace/crm">Back to CRM</Link>
  </main>;
}
