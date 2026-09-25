import { PreProjectListPage } from "@/components/pre-project/pre-project-list-page";
import { getPreProjects } from "@/lib/pre-project/server";
import { caseHref, caseRoute, listSearch, PRE_PROJECT_ROOT } from "@/lib/pre-project/types";
import { redirect } from "next/navigation";

export default async function PlanningEntryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
  const selected = listSearch(query);
  const record = query.get("record");
  const section = selected.get("section") ?? "requirements";
  if (record && caseRoute(`${PRE_PROJECT_ROOT}/cases/${record}/${section}`)) redirect(caseHref(record, selected, section));
  if (!selected.size) redirect("/workspace/projects");
  const search = selected.toString();
  return <PreProjectListPage initialData={await getPreProjects(selected)} search={search} />;
}
