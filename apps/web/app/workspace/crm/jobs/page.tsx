import { JobsPage } from "@/components/jobs";
import { jobsRead } from "@/lib/jobs/jobs.server";

export default async function JobsEntryPage() {
  const { data, loadError } = await jobsRead();
  return <JobsPage items={data.items} loadError={loadError} total={data.total} />;
}
