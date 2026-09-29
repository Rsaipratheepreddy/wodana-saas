import { describe, expect, it, vi } from "vitest";
import { decisionEvidenceFile, decisionRecorder } from "./quote-decision-access";

const ids = { workspaceId: "w", caseId: "c", userId: "u" };
const holding = (...codes: string[]) => async (code: string) => codes.includes(code);

describe("who records a client's decision (Q-24)", () => {
  it("an approver, as before", async () => {
    const db = { query: vi.fn() };
    await expect(decisionRecorder(db, holding("commercial.approve"), ids)).resolves.toBe("approver");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("Sales holding commercial.record_decision", async () => {
    await expect(decisionRecorder({ query: vi.fn() }, holding("commercial.record_decision", "pre_projects.edit"), ids)).resolves.toBe("sales");
  });

  it("the case's (or its opportunity's) owner who can edit it, and nobody else", async () => {
    const owner = { query: vi.fn(async () => ({ rows: [{}], rowCount: 1 })) };
    await expect(decisionRecorder(owner, holding("pre_projects.edit"), ids)).resolves.toBe("sales");
    expect(owner.query.mock.calls[0][1]).toEqual(["w", "c", "u"]);
    const stranger = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    await expect(decisionRecorder(stranger, holding("pre_projects.edit"), ids)).resolves.toBeNull();
    await expect(decisionRecorder(owner, holding("pre_projects.view"), ids)).resolves.toBeNull();
  });

  it("takes evidence only from this case's own files", async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ id: "11111111-1111-4111-8111-111111111111", name: "signed.pdf", mimeType: "application/pdf", byteSize: "2048", hasPreview: false }], rowCount: 1 })) };
    await expect(decisionEvidenceFile(db, "w", "c", "not-a-file")).resolves.toBeNull();
    await expect(decisionEvidenceFile(db, "w", "c", "11111111-1111-4111-8111-111111111111")).resolves.toMatchObject({ name: "signed.pdf", byteSize: 2048 });
  });
});
