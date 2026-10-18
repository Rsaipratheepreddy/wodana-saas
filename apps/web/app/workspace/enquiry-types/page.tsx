import { EnquiryTypesPage } from "@/components/flows/enquiry-types-page";
import { getEnquiryTypesPageData } from "@/lib/flows/flows.server";

/** Enquiry types (plan §5a): one card per type, each with its own steps. */
export default async function Page() {
  const data = await getEnquiryTypesPageData();
  return <EnquiryTypesPage canManage={data.canManage} loadError={data.loadError} types={data.types} workspaceId={data.workspaceId} />;
}
