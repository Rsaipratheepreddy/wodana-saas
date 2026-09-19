import { redirect } from "next/navigation";

export default async function JobCompatibilityPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  redirect(`/workspace/crm/jobs/${jobId}`);
}
