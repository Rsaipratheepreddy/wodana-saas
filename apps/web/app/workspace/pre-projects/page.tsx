import { PreProjectListPage } from "@/components/pre-project/pre-project-list-page";
import { getPreProjects } from "@/lib/pre-project/server";
import { caseHref, caseRoute, listSearch, PRE_PROJECT_ROOT } from "@/lib/pre-project/types";
import { redirect } from "next/navigation";
import { PlanningList } from "@/components/pre-project/planning-list";
import { loadProjectsBoard } from "@/lib/projects/board.server";

export default async function PlanningEntryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
  const selected = listSearch(query);
  const record = query.get("record");
  const section = selected.get("section") ?? "requirements";
  if (record && caseRoute(`${PRE_PROJECT_ROOT}/cases/${record}/${section}`)) redirect(caseHref(record, selected, section));
  const stage = query.get("stage");
  const initialGroup = stage === "ready" || stage === "before_deal" || stage === "in_design" ? stage : undefined;
  if (!selected.size) return <PlanningList initialGroup={initialGroup} {...await loadProjectsBoard()} />;
  const search = selected.toString();
  return <PreProjectListPage initialData={await getPreProjects(selected)} search={search} />;
}
