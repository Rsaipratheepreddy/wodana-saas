import { JobsPage } from "@/components/jobs/jobs-page";
import { jobsOverviewRead } from "@/lib/jobs/jobs.server";

/** §0.3: every job, where each one is now (its chapter and step), its progress, value and target date. */
export default async function Page() {
  const { items, total } = await jobsOverviewRead();
  return <JobsPage items={items} total={total} />;
}
