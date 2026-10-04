import { notFound } from "next/navigation";
import { FlowBuilder } from "@/components/flows/flow-builder";
import { getFlowBuilderData } from "@/lib/flows/flows.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Flows › a flow (plan §5a, F3): the builder. */
export default async function Page({ params }: { params: Promise<{ flowId: string }> }) {
  const { flowId } = await params;
  if (!UUID.test(flowId)) notFound();
  const data = await getFlowBuilderData(flowId);
  return <FlowBuilder {...data} />;
}
