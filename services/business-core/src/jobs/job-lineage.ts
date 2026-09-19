/**
 * Read-only source-identity reconciliation for the future Job registry.
 * Never infer that two enquiries are one Job because they share a party.
 */
export type JobLineageRecordType =
  | "enquiry"
  | "lead"
  | "opportunity"
  | "case"
  | "quote"
  | "project";

export type JobLineageRows = {
  enquiries: { id: string; workspaceId: string; partyId: string }[];
  leads: { id: string; workspaceId: string; enquiryId: string; partyId: string }[];
  opportunities: {
    id: string;
    workspaceId: string;
    partyId: string;
    leadId: string | null;
  }[];
  cases: { id: string; workspaceId: string; opportunityId: string }[];
  quotes: { id: string; workspaceId: string; caseId: string }[];
  projects: { id: string; workspaceId: string; caseId: string }[];
  projectLinks: { id: string; workspaceId: string; opportunityId: string; projectId: string; mode: string }[];
};

export type JobLineageLink = {
  type: JobLineageRecordType;
  id: string;
  /** A quotation ID is scoped to the commercial case's JSON document. */
  caseId?: string;
};

export type JobCandidate = {
  root: { type: "enquiry" | "opportunity"; id: string };
  partyId: string;
  links: JobLineageLink[];
};

export type JobLineageIssue = {
  code:
    | "cross_workspace"
    | "duplicate_source"
    | "missing_parent"
    | "party_mismatch"
    | "ambiguous_child"
    | "project_link_disagreement";
  type: JobLineageRecordType | "project_link";
  id: string;
  parentId?: string;
};

export type JobLineageReport = {
  workspaceId: string;
  candidates: JobCandidate[];
  issues: JobLineageIssue[];
};

type SourceRow = { id: string; workspaceId: string };

function acceptedRows<T extends SourceRow>(
  workspaceId: string,
  type: JobLineageIssue["type"],
  rows: T[],
  issues: JobLineageIssue[],
  key: (row: T) => string = (row) => row.id,
  parent: (row: T) => string | undefined = () => undefined,
): T[] {
  const seen = new Set<string>();
  const accepted: T[] = [];
  for (const row of rows) {
    if (row.workspaceId !== workspaceId) {
      issues.push({ code: "cross_workspace", type, id: row.id, parentId: parent(row) });
    } else if (seen.has(key(row))) {
      issues.push({ code: "duplicate_source", type, id: row.id, parentId: parent(row) });
    } else {
      seen.add(key(row));
      accepted.push(row);
    }
  }
  return accepted;
}

function childrenByParent<T>(rows: T[], parent: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = parent(row);
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  return groups;
}

/**
 * Produce candidate links only where every source edge is unambiguous.
 * A caller must review `issues` before using candidates for a registry backfill.
 */
export function analyzeJobLineage(
  workspaceId: string,
  rows: JobLineageRows,
): JobLineageReport {
  const issues: JobLineageIssue[] = [];
  const enquiries = acceptedRows(workspaceId, "enquiry", rows.enquiries, issues);
  const leads = acceptedRows(workspaceId, "lead", rows.leads, issues);
  const opportunities = acceptedRows(
    workspaceId,
    "opportunity",
    rows.opportunities,
    issues,
  );
  const cases = acceptedRows(workspaceId, "case", rows.cases, issues);
  const quotes = acceptedRows(
    workspaceId,
    "quote",
    rows.quotes,
    issues,
    (row) => `${row.caseId}:${row.id}`,
    (row) => row.caseId,
  );
  const projects = acceptedRows(workspaceId, "project", rows.projects, issues);
  const projectLinks = acceptedRows(workspaceId, "project_link", rows.projectLinks, issues);
  const enquiryById = new Map(enquiries.map((row) => [row.id, row]));
  const leadById = new Map(leads.map((row) => [row.id, row]));
  const opportunityById = new Map(opportunities.map((row) => [row.id, row]));
  const caseById = new Map(cases.map((row) => [row.id, row]));
  const projectsById = new Map(projects.map((row) => [row.id, row]));
  const casesByOpportunity = childrenByParent(cases, (row) => row.opportunityId);

  // CRM handoff links are advisory. Only the case → delivery project chain is
  // authoritative; a promoted link must agree with it before registry backfill.
  for (const link of projectLinks) {
    const linkedProject = projectsById.get(link.projectId);
    const matchingCase = (casesByOpportunity.get(link.opportunityId) ?? []).some(
      (row) => row.id === linkedProject?.caseId,
    );
    if ((linkedProject && !matchingCase) || (link.mode === "delivery" && !linkedProject)) {
      issues.push({
        code: "project_link_disagreement",
        type: "project_link",
        id: link.projectId,
        parentId: link.opportunityId,
      });
    }
  }

  for (const lead of leads) {
    const parent = enquiryById.get(lead.enquiryId);
    if (!parent)
      issues.push({ code: "missing_parent", type: "lead", id: lead.id, parentId: lead.enquiryId });
    else if (parent.partyId !== lead.partyId)
      issues.push({ code: "party_mismatch", type: "lead", id: lead.id, parentId: parent.id });
  }
  for (const opportunity of opportunities) {
    if (!opportunity.leadId) continue;
    const parent = leadById.get(opportunity.leadId);
    if (!parent)
      issues.push({ code: "missing_parent", type: "opportunity", id: opportunity.id, parentId: opportunity.leadId });
    else if (parent.partyId !== opportunity.partyId)
      issues.push({ code: "party_mismatch", type: "opportunity", id: opportunity.id, parentId: parent.id });
  }
  for (const item of cases) {
    if (!opportunityById.has(item.opportunityId))
      issues.push({ code: "missing_parent", type: "case", id: item.id, parentId: item.opportunityId });
  }
  for (const item of quotes) {
    if (!caseById.has(item.caseId))
      issues.push({ code: "missing_parent", type: "quote", id: item.id, parentId: item.caseId });
  }
  for (const item of projects) {
    if (!caseById.has(item.caseId))
      issues.push({ code: "missing_parent", type: "project", id: item.id, parentId: item.caseId });
  }

  const leadsByEnquiry = childrenByParent(leads, (row) => row.enquiryId);
  const opportunitiesByLead = childrenByParent(
    opportunities.filter((row) => row.leadId),
    (row) => row.leadId!,
  );
  const projectsByCase = childrenByParent(projects, (row) => row.caseId);
  const quotesByCase = childrenByParent(quotes, (row) => row.caseId);
  const candidates: JobCandidate[] = [];

  const candidate = (root: JobCandidate["root"], partyId: string) => {
    if (issues.some((issue) => issue.type === root.type && issue.id === root.id)) return;
    const links: JobLineageLink[] = [{ type: root.type, id: root.id }];
    const one = <T extends { id: string }>(
      type: JobLineageRecordType,
      parentId: string,
      children: T[] | undefined,
    ): T | undefined | null => {
      if (!children?.length) return undefined;
      if (children.length > 1) {
        issues.push({ code: "ambiguous_child", type, id: parentId, parentId });
        return null;
      }
      const child = children[0];
      if (issues.some((issue) => issue.type === type && issue.id === child.id)) return null;
      links.push({ type, id: child.id });
      return child;
    };
    let opportunityId: string | undefined;
    if (root.type === "enquiry") {
      const lead = one("lead", root.id, leadsByEnquiry.get(root.id));
      if (lead === null) return;
      if (lead) {
        const opportunity = one("opportunity", lead.id, opportunitiesByLead.get(lead.id));
        if (opportunity === null) return;
        opportunityId = opportunity?.id;
      }
    } else opportunityId = root.id;

    if (opportunityId) {
      const caseRow = one("case", opportunityId, casesByOpportunity.get(opportunityId));
      if (caseRow === null) return;
      if (caseRow) {
        const caseQuotes = quotesByCase.get(caseRow.id) ?? [];
        if (
          issues.some(
            (issue) =>
              issue.type === "quote" &&
              issue.parentId === caseRow.id &&
              caseQuotes.some((quote) => quote.id === issue.id),
          )
        ) return;
        const quoteIds = new Set<string>();
        for (const quote of caseQuotes) {
          if (quoteIds.has(quote.id)) {
            issues.push({ code: "duplicate_source", type: "quote", id: quote.id, parentId: caseRow.id });
            return;
          }
          quoteIds.add(quote.id);
          links.push({ type: "quote", id: quote.id, caseId: caseRow.id });
        }
        if (one("project", caseRow.id, projectsByCase.get(caseRow.id)) === null) return;
      }
    }
    candidates.push({ root, partyId, links });
  };

  for (const enquiry of enquiries)
    candidate({ type: "enquiry", id: enquiry.id }, enquiry.partyId);
  for (const opportunity of opportunities.filter((row) => !row.leadId))
    candidate({ type: "opportunity", id: opportunity.id }, opportunity.partyId);
  return { workspaceId, candidates, issues };
}
