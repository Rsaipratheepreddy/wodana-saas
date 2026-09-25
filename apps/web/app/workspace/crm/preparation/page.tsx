import { PreProjectListPage } from "@/components/pre-project/pre-project-list-page";
import { getPreProjects } from "@/lib/pre-project/server";
import { listSearch } from "@/lib/pre-project/types";

export default async function SalesPreparationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
  const search = listSearch(query);
  const data = await getPreProjects(search, true);
  return <PreProjectListPage initialData={data} search={search.toString()} basePath="/workspace/crm/preparation" salesPreparation />;
}
