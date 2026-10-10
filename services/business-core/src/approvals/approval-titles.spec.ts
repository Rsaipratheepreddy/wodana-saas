import { describe, expect, it } from "vitest";
import { FINANCE_REQUEST_KIND_NAME, LEDGER_CHANGE_TITLE, LIVE_TITLE_BY_KIND, LIVE_TITLE_SQL, PROPOSAL_KIND_TITLE } from "./approval-titles";
import { APPROVAL_SUBJECT_KINDS } from "./approval-policy";

describe("approval titles read from the record (Home › Approvals never shows a renamed record's old title)", () => {
  it("names the kinds whose title carries a client, opportunity or case name, each as a known subject kind", () => {
    expect(Object.keys(LIVE_TITLE_BY_KIND).sort()).toEqual(["deal_file", "ledger_change", "opportunity_value", "payable_request", "refund"]);
    for (const kind of Object.keys(LIVE_TITLE_BY_KIND)) expect(APPROVAL_SUBJECT_KINDS).toContain(kind);
  });

  it("builds one expression over the request row that falls back to the stored title and keeps its length", () => {
    expect(LIVE_TITLE_SQL.startsWith("left(coalesce(CASE request.subject_kind WHEN 'deal_file' THEN (") || LIVE_TITLE_SQL.startsWith("left(coalesce(CASE request.subject_kind WHEN 'opportunity_value' THEN (")).toBe(true);
    expect(LIVE_TITLE_SQL.endsWith("END, request.title), 300)")).toBe(true);
    for (const sql of Object.values(LIVE_TITLE_BY_KIND)) {
      expect(sql).toContain("request.workspace_id");
      expect(sql).toContain("request.subject_id");
    }
  });

  it("uses the words the modules compose their titles from", () => {
    expect(LIVE_TITLE_BY_KIND.opportunity_value).toContain(`'${PROPOSAL_KIND_TITLE.design}'`);
    expect(LIVE_TITLE_BY_KIND.opportunity_value).toContain(`'${PROPOSAL_KIND_TITLE.main}'`);
    expect(LIVE_TITLE_BY_KIND.ledger_change).toContain(`'${LEDGER_CHANGE_TITLE}'`);
    expect(LIVE_TITLE_BY_KIND.refund).toContain(`'${FINANCE_REQUEST_KIND_NAME.refund}'`);
    // The Deal File's title is read through the commercial view, the only reader of the split commercial document.
    expect(LIVE_TITLE_BY_KIND.deal_file).toContain("FROM commercial_cases_view");
  });
});
