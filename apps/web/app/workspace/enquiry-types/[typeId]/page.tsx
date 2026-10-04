import { notFound } from "next/navigation";
import { FlowBuilder } from "@/components/flows/flow-builder";
import { getFlowBuilderData } from "@/lib/flows/flows.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Enquiry types › a type (plan §5a, F3): the builder for its steps. */
export default async function Page({ params }: { params: Promise<{ typeId: string }> }) {
  const { typeId } = await params;
  if (!UUID.test(typeId)) notFound();
  const data = await getFlowBuilderData(typeId);
  return <FlowBuilder {...data} />;
}
