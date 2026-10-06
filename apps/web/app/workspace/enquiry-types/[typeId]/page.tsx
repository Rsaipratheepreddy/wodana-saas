import { notFound } from "next/navigation";
import { FlowBuilder } from "@/components/flows/flow-builder";
import { StepsTableEditor } from "@/components/flows/steps-table";
import { getFlowBuilderData } from "@/lib/flows/flows.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Enquiry types › a type (plan §5a, §6.9a): its steps, as CeCe's table (stages × paths) or on the canvas. Both edit
 * the same flow definition and publish a new version the same way.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ typeId: string }>; searchParams: Promise<{ view?: string }> }) {
  const { typeId } = await params;
  const { view } = await searchParams;
  if (!UUID.test(typeId)) notFound();
  const data = await getFlowBuilderData(typeId);
  return view === "canvas" ? <FlowBuilder {...data} tableHref={`/workspace/enquiry-types/${typeId}`} /> : <StepsTableEditor {...data} />;
}
