import { notFound } from "next/navigation";
import { JobProfile } from "@/components/jobs";
import { jobRead } from "@/lib/jobs/jobs.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function JobEntryPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!UUID.test(jobId)) notFound();
  const { data } = await jobRead(jobId);
  return <JobProfile job={data} />;
}
