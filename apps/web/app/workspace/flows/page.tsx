import { FlowsListPage } from "@/components/flows/flows-list-page";
import { getFlowsPageData } from "@/lib/flows/flows.server";

/** Flows (plan §5a): one card per flow, with the enquiry types it is used for. */
export default async function Page() {
  const data = await getFlowsPageData();
  return <FlowsListPage canManage={data.canManage} flows={data.flows} loadError={data.loadError} workspaceId={data.workspaceId} />;
}
