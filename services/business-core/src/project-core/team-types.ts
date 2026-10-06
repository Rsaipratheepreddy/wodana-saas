/** One of the workspace's roles on a job (PLM-100 / PLM-089), as people read it: who holds it, or "not applicable". */
export type TeamRoleView = { role: string; label: string; member: { membershipId: string; name: string; email: string | null } | null; notApplicable: boolean };
