/** The tabs of a project page, one thing each. */
export const PROJECT_SECTIONS = ["overview", "scope", "plan", "money", "site", "petty-cash", "handover", "warranty", "updates"] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];
