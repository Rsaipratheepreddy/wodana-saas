import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { jobHome } from "@/lib/jobs/jobs";
import { jobRead } from "@/lib/jobs/jobs.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Old links to a job (search results, notices) open the record the work lives on today. */
export default async function JobEntryPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!UUID.test(jobId)) notFound();
  let destination = "/workspace";
  try {
    destination = jobHome((await jobRead(jobId)).data.links) ?? destination;
  } catch (error) {
    unstable_rethrow(error);
  }
  redirect(destination);
}
