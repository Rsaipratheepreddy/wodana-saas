import { describe, expect, it } from "vitest";
import { analyzeJobLineage, type JobLineageRows } from "./job-lineage";

const workspaceId = "workspace-a";
const empty = (): JobLineageRows => ({
  enquiries: [],
  leads: [],
  opportunities: [],
  cases: [],
  quotes: [],
  projects: [],
  projectLinks: [],
});

describe("read-only Job source reconciliation", () => {
  it("keeps repeat enquiries for the same customer as separate Job candidates", () => {
    const rows = empty();
    rows.enquiries.push(
      { id: "enquiry-1", workspaceId, partyId: "customer-1" },
      { id: "enquiry-2", workspaceId, partyId: "customer-1" },
    );
    rows.leads.push({ id: "lead-1", workspaceId, enquiryId: "enquiry-1", partyId: "customer-1" });
    rows.opportunities.push({ id: "opportunity-1", workspaceId, partyId: "customer-1", leadId: "lead-1" });
    rows.cases.push({ id: "case-1", workspaceId, opportunityId: "opportunity-1" });
    rows.quotes.push({ id: "quote-1", workspaceId, caseId: "case-1" });
    rows.projects.push({ id: "project-1", workspaceId, caseId: "case-1" });

    const report = analyzeJobLineage(workspaceId, rows);
    expect(report.issues).toEqual([]);
    expect(report.candidates).toHaveLength(2);
    expect(report.candidates[0]).toEqual({
      root: { type: "enquiry", id: "enquiry-1" },
      partyId: "customer-1",
      links: [
        { type: "enquiry", id: "enquiry-1" },
        { type: "lead", id: "lead-1" },
        { type: "opportunity", id: "opportunity-1" },
        { type: "case", id: "case-1" },
        { type: "quote", id: "quote-1", caseId: "case-1" },
        { type: "project", id: "project-1" },
      ],
    });
    expect(report.candidates[1].links).toEqual([{ type: "enquiry", id: "enquiry-2" }]);
  });

  it("gives direct opportunities their own root even for an existing customer", () => {
    const rows = empty();
    rows.enquiries.push({ id: "enquiry-1", workspaceId, partyId: "customer-1" });
    rows.opportunities.push({ id: "direct-1", workspaceId, partyId: "customer-1", leadId: null });
    expect(analyzeJobLineage(workspaceId, rows).candidates.map((item) => item.root)).toEqual([
      { type: "enquiry", id: "enquiry-1" },
      { type: "opportunity", id: "direct-1" },
    ]);
  });

  it("never attaches a cross-workspace source or its foreign descendants", () => {
    const rows = empty();
    rows.enquiries.push({ id: "foreign-enquiry", workspaceId: "workspace-b", partyId: "customer-b" });
    rows.leads.push({ id: "lead-a", workspaceId, enquiryId: "foreign-enquiry", partyId: "customer-b" });
    const report = analyzeJobLineage(workspaceId, rows);
    expect(report.candidates).toEqual([]);
    expect(report.issues).toEqual(expect.arrayContaining([
      { code: "cross_workspace", type: "enquiry", id: "foreign-enquiry", parentId: undefined },
      { code: "missing_parent", type: "lead", id: "lead-a", parentId: "foreign-enquiry" },
    ]));
  });

  it("reports orphans without inventing a new Job or leaking a foreign parent", () => {
    const rows = empty();
    rows.opportunities.push({ id: "qualified-orphan", workspaceId, partyId: "customer-a", leadId: "missing-lead" });
    rows.cases.push({ id: "orphan-case", workspaceId, opportunityId: "missing-opportunity" });
    rows.projects.push({ id: "orphan-project", workspaceId, caseId: "orphan-case" });
    const report = analyzeJobLineage(workspaceId, rows);
    expect(report.candidates).toEqual([]);
    expect(report.issues).toEqual(expect.arrayContaining([
      { code: "missing_parent", type: "opportunity", id: "qualified-orphan", parentId: "missing-lead" },
      { code: "missing_parent", type: "case", id: "orphan-case", parentId: "missing-opportunity" },
    ]));
  });

  it("rejects ambiguous child lineage rather than picking the first record", () => {
    const rows = empty();
    rows.enquiries.push({ id: "enquiry", workspaceId, partyId: "customer" });
    rows.leads.push(
      { id: "lead-a", workspaceId, enquiryId: "enquiry", partyId: "customer" },
      { id: "lead-b", workspaceId, enquiryId: "enquiry", partyId: "customer" },
    );
    const report = analyzeJobLineage(workspaceId, rows);
    expect(report.candidates).toEqual([]);
    expect(report.issues).toContainEqual({
      code: "ambiguous_child", type: "lead", id: "enquiry", parentId: "enquiry",
    });
  });

  it("scopes quote IDs to a case, allowing the same JSON quote ID in different cases", () => {
    const rows = empty();
    rows.opportunities.push(
      { id: "direct-1", workspaceId, partyId: "customer", leadId: null },
      { id: "direct-2", workspaceId, partyId: "customer", leadId: null },
    );
    rows.cases.push(
      { id: "case-1", workspaceId, opportunityId: "direct-1" },
      { id: "case-2", workspaceId, opportunityId: "direct-2" },
    );
    rows.quotes.push(
      { id: "local-quote", workspaceId, caseId: "case-1" },
      { id: "local-quote", workspaceId, caseId: "case-2" },
    );
    const report = analyzeJobLineage(workspaceId, rows);
    expect(report.issues).toEqual([]);
    expect(report.candidates).toHaveLength(2);
    expect(report.candidates[0].links.at(-1)).toEqual({ type: "quote", id: "local-quote", caseId: "case-1" });
    expect(report.candidates[1].links.at(-1)).toEqual({ type: "quote", id: "local-quote", caseId: "case-2" });
  });

  it("rejects a mismatched party and a duplicated quote within one case", () => {
    const rows = empty();
    rows.enquiries.push({ id: "enquiry", workspaceId, partyId: "customer-a" });
    rows.leads.push({ id: "lead", workspaceId, enquiryId: "enquiry", partyId: "customer-b" });
    rows.opportunities.push({ id: "direct", workspaceId, partyId: "customer-b", leadId: null });
    rows.cases.push({ id: "case", workspaceId, opportunityId: "direct" });
    rows.quotes.push(
      { id: "quote", workspaceId, caseId: "case" },
      { id: "quote", workspaceId, caseId: "case" },
    );
    const report = analyzeJobLineage(workspaceId, rows);
    expect(report.candidates).toEqual([]);
    expect(report.issues).toEqual(expect.arrayContaining([
      { code: "party_mismatch", type: "lead", id: "lead", parentId: "enquiry" },
      { code: "duplicate_source", type: "quote", id: "quote", parentId: "case" },
    ]));
  });

  it("flags a promoted CRM project link that disagrees with the released case chain", () => {
    const rows = empty();
    rows.opportunities.push(
      { id: "direct-1", workspaceId, partyId: "customer", leadId: null },
      { id: "direct-2", workspaceId, partyId: "customer", leadId: null },
    );
    rows.cases.push(
      { id: "case-1", workspaceId, opportunityId: "direct-1" },
      { id: "case-2", workspaceId, opportunityId: "direct-2" },
    );
    rows.projects.push({ id: "project-2", workspaceId, caseId: "case-2" });
    rows.projectLinks.push({ id: "link-1", workspaceId, opportunityId: "direct-1", projectId: "project-2", mode: "delivery" });

    const report = analyzeJobLineage(workspaceId, rows);
    expect(report.issues).toContainEqual({
      code: "project_link_disagreement", type: "project_link", id: "project-2", parentId: "direct-1",
    });
    expect(report.candidates).toHaveLength(2);
    expect(report.candidates[0].links).not.toContainEqual({ type: "project", id: "project-2" });
  });

  it("does not treat an unreleased pre-sales link as a delivered project", () => {
    const rows = empty();
    rows.opportunities.push({ id: "direct", workspaceId, partyId: "customer", leadId: null });
    rows.projectLinks.push({ id: "link", workspaceId, opportunityId: "direct", projectId: "planned-id", mode: "pre_sales" });
    expect(analyzeJobLineage(workspaceId, rows).issues).toEqual([]);
  });
});
