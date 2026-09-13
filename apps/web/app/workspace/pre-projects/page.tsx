import { PreProjectListPage } from "@/components/pre-project/pre-project-list-page";
import { getPreProjects } from "@/lib/pre-project/server";
import { listSearch } from "@/lib/pre-project/types";

export default async function PreProjects({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
  const search = listSearch(query).toString();
  return <PreProjectListPage initialData={await getPreProjects(new URLSearchParams(search))} search={search} />;
}
