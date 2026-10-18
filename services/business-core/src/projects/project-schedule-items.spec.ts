import { describe, expect, it } from "vitest";
import { emptyProject } from "./execution.domain";
import { projectScheduleItems } from "./project-schedule-items";

describe("project schedule information items", () => {
  it("combines milestones, delivery, inspection and tenant project dates without inventing bookings", () => {
    const data = emptyProject();
    data.controls = { ...data.controls!, targetCompletion: "2026-09-20", nextAction: "Client review", nextActionDate: "2026-09-18" };
    data.milestones = [{ id: "m1", title: "Design sign-off", dueDate: "2026-09-17", baselineDate: "2026-09-17", ownerId: "owner", taskIds: [], visibleToClient: true, evidence: "" }];
    data.dispatches = [{ id: "d1", title: "Wardrobe delivery", taskId: "", destination: "Site", quantity: 1, unit: "lot", dueDate: "2026-09-19", carrier: "", reference: "", status: "ready", preparedBy: "owner", accepted: 0, rejected: 0, receiptEvidence: "" }];
    data.commissioning = [{ id: "i1", title: "Lighting inspection", taskId: "", area: "Villa", system: "Lighting", ownerId: "owner", dueDate: "2026-09-21", readings: [], status: "draft", evidence: "", note: "", authorId: "owner" }];
    const items = projectScheduleItems({ id: "project", name: "Villa", dealReference: "DEAL-1", clientName: "Client", data }, [], "2026-09-17", "2026-09-20");
    expect(items.map((item) => item.kind)).toEqual(["milestone", "next_action", "delivery", "target_completion"]);
    expect(items[0].title).toBe("DEAL-1 · Client · Design sign-off");
  });
});
