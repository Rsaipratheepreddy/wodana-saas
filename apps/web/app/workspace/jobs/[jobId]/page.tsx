import { notFound } from "next/navigation";
import { JobJourneyPage } from "@/components/jobs/job-journey-page";
import { costsRead, documentsRead, journeyRead, moneyRead, threadRead } from "@/lib/jobs/jobs.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** §0.3 P2: one job, from enquiry to warranty: its facts, the step now and the map. */
export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!UUID.test(jobId)) notFound();
  const [{ data, workspaceId }, documents, money, costs, { thread }] = await Promise.all([journeyRead(jobId), documentsRead(jobId), moneyRead(jobId), costsRead(jobId), threadRead(jobId)]);
  return <JobJourneyPage view={data} documents={documents} money={money} costs={costs} thread={thread} workspaceId={workspaceId} jobId={jobId} />;
}
