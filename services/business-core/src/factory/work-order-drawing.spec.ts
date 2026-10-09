import { describe, expect, it } from "vitest";
import { decideWorkOrderDrawing } from "./work-order-drawing";

const approved = { number: 1, status: "approved", decidedOn: "2026-10-01", decidedByName: "Maya Client" };
const needed = { needed: true, catalogDrawingUrl: null };

describe("the drawing a work order is made to", () => {
  it("is the project's drawings once the client approved their latest revision, with nothing recorded on the work order", () => {
    expect(decideWorkOrderDrawing({ recorded: false, newer: null, project: approved, line: needed })).toEqual({ source: "project", approved: true, project: approved });
  });

  it("waits while the latest revision is with the client, or a newer one was started", () => {
    for (const status of ["uploaded", "checked", "sent", "changes_requested"])
      expect(decideWorkOrderDrawing({ recorded: false, newer: null, project: { ...approved, number: 2, status }, line: needed }))
        .toMatchObject({ source: null, approved: false });
    expect(decideWorkOrderDrawing({ recorded: false, newer: null, project: null, line: needed })).toEqual({ source: null, approved: false, project: null });
  });

  it("keeps the drawing recorded on the work order first, until a newer revision of that design exists", () => {
    expect(decideWorkOrderDrawing({ recorded: true, newer: null, project: null, line: needed })).toMatchObject({ source: "work_order", approved: true });
    expect(decideWorkOrderDrawing({ recorded: true, newer: 2, project: approved, line: needed })).toMatchObject({ source: "work_order", approved: false });
  });

  it("reads a standard piece's catalogue drawing when it needs no technical drawings", () => {
    expect(decideWorkOrderDrawing({ recorded: false, newer: null, project: null, line: { needed: false, catalogDrawingUrl: "https://example.com/sofa.pdf" } }))
      .toMatchObject({ source: "catalogue", approved: true });
    expect(decideWorkOrderDrawing({ recorded: false, newer: null, project: null, line: { needed: false, catalogDrawingUrl: null } })).toMatchObject({ source: null, approved: false });
  });
});
