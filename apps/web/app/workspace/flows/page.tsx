import { FlowsListPage } from "@/components/flows/flows-list-page";
import { getFlowsPageData } from "@/lib/flows/flows.server";

/** Flows (plan §5a): the firm's flows and which enquiry type follows which. */
export default async function Page() {
  const data = await getFlowsPageData();
  return <FlowsListPage canManage={data.canManage} flows={data.flows} workspaceId={data.workspaceId} />;
}
