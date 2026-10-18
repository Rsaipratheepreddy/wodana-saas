/** The tabs of a project page, one thing each, in the order work happens. */
export const PROJECT_SECTIONS = ["overview", "scope", "plan", "money", "site", "handover", "updates"] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

/** Older addresses that now live inside a tab: petty cash is a view of Money, warranty a view of Handover. */
export const SECTION_ALIASES: Record<string, { section: ProjectSection; view: string }> = {
  "petty-cash": { section: "money", view: "petty-cash" },
  warranty: { section: "handover", view: "warranty" },
};
