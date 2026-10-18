import { ProjectPortfolioCalendar, type PortfolioCalendarData } from "@/components/projects/project-portfolio-calendar";
import { projectRead } from "@/lib/projects/server";

export default async function ProjectPortfolioCalendarPage() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 4, 0)).toISOString().slice(0, 10);
  const { data } = await projectRead<PortfolioCalendarData>(`calendar?from=${from}&to=${to}&bookingStatus=active`);
  return <ProjectPortfolioCalendar data={data} />;
}
