export type HomeOverviewItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  date: string | null;
};

export type HomeOverview = {
  sections: { sales: boolean; planning: boolean; projects: boolean };
  metrics: {
    myFollowUps: number | null;
    planningCases: number | null;
    activeProjects: number | null;
    myProjectTasks: number | null;
  };
  sales: HomeOverviewItem[];
  planning: HomeOverviewItem[];
  projects: HomeOverviewItem[];
  tasks: HomeOverviewItem[];
};
