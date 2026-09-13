import {projectRead} from "@/lib/projects/server";
import { notFound, redirect } from "next/navigation";
import { ProjectSectionPage } from "@/components/projects/project-section-page";
import { PlanTeamsPage } from "@/components/projects/plan-teams-page";
import { DEMO_PROJECT, demoProjectSection } from "@/lib/projects/demo";

export default async function DemoProjectPage({ params, searchParams }: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { section } = await params;
  const portfolio=await projectRead<{id:string;name:string}[]>("portfolio");
  const linkedDemo=portfolio.data.find(p=>p.name==="Jumeirah villa · Delivery demo");
  if(linkedDemo)redirect(`/workspace/projects/${linkedDemo.id}/${section?.join("/")||"overview"}`);
  if (!section?.length) redirect(`${DEMO_PROJECT.root}/overview`);
  if (section.join("/") === "installation") redirect(`${DEMO_PROJECT.root}/site-work`);
  const selected = demoProjectSection(`${DEMO_PROJECT.root}/${section.join("/")}`);
  if (!selected) notFound();
  if (selected === "plan-teams") return <PlanTeamsPage />;
  const { view } = await searchParams;
  return <ProjectSectionPage section={selected} changeRequests={view === "change-requests"} />;
}
