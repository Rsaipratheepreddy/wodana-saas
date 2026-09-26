import { PreProjectListPage } from "@/components/pre-project/pre-project-list-page";
import { getPreProjects } from "@/lib/pre-project/server";
import { caseHref, caseRoute, listSearch, PRE_PROJECT_ROOT } from "@/lib/pre-project/types";
import { redirect } from "next/navigation";
import { ProjectsBoard } from "@/components/projects/projects-board";
import { loadProjectsBoard } from "@/lib/projects/board.server";

export default async function PlanningEntryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
  const selected = listSearch(query);
  const record = query.get("record");
  const section = selected.get("section") ?? "requirements";
  if (record && caseRoute(`${PRE_PROJECT_ROOT}/cases/${record}/${section}`)) redirect(caseHref(record, selected, section));
  if (!selected.size) return <ProjectsBoard mode="planning" {...await loadProjectsBoard()} />;
  const search = selected.toString();
  return <PreProjectListPage initialData={await getPreProjects(selected)} search={search} />;
}
