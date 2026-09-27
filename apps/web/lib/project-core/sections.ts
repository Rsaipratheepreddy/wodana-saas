/** The tabs of a project page, one thing each. */
export const PROJECT_SECTIONS = ["overview", "scope", "plan", "site", "updates"] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];
