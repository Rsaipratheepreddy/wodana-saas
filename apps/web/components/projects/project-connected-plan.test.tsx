import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProjectState } from "@/lib/projects/execution";
import { ProjectConnectedPlan } from "./project-connected-plan";

const state = (): ProjectState => ({
  workspaceId: "workspace-1",
  id: "project-1",
  caseId: "case-1",
  name: "Villa",
  customer: "Client",
  memberId: "manager",
  canManage: true,
  canReview: true,
  canReport: true,
  canBuy: true,
  commercialReady: true,
  members: [{ id: "manager", name: "Project manager" }],
  resources: [],
  bookings: [],
  pulse: {
    health: "watch",
    counts: { packages: 1, readyPackages: 0, activePackages: 0, blockedPackages: 0, overdueTasks: 0, awaitingInspection: 0 },
    nextActions: [],
  },
  connectedPlan: {
    promise: { statement: "Handover by the agreed date.", targetCompletion: "2026-09-30", handoverDate: "2026-10-02" },
    packages: [{
      id: "package-1",
      title: "Wardrobe",
      area: "Primary bedroom",
      status: "planning",
      ownerId: "manager",
      priority: "high",
      risk: "watch",
      plannedStart: "2026-09-20",
      plannedEnd: "2026-09-25",
      predecessorPackageIds: [],
      nextAction: "Confirm factory slot",
      nextActionOwnerId: "manager",
      nextActionDate: "2026-09-19",
      recoveryPlan: "Use the alternate approved slot.",
      supplierCommitments: [{
        orderId: "order-1",
        number: "PO-001",
        vendor: "Joinery partner",
        status: "acknowledged",
        promisedDate: "2026-09-19",
        leadTimeDays: 14,
        taskId: "task-1",
      }],
      capacityCommitments: [{
        taskId: "task-1",
        resourceId: "factory-1",
        resourceName: "Main factory",
        resourceKind: "factory",
        bookingStatus: "confirmed",
        start: "2026-09-20",
        end: "2026-09-25",
      }],
      issues: [{ code: "supplier", detail: "Review the supplier promise." }],
    }],
  },
  data: {
    revision: 1,
    phase: "active",
    scope: null,
    workPackages: [{
      id: "package-1", scopeLineIds: ["line-1"], title: "Wardrobe", area: "Primary bedroom",
      deliveryRoute: "factory", status: "planning", ownerId: "manager",
      plannedStart: "2026-09-20", plannedEnd: "2026-09-25", blocker: "",
      createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z",
    }],
    tasks: [], reports: [], materials: [], orders: [], documents: [], snags: [], handovers: [],
    comments: [], audit: [], processed: [], budget: 0, forecast: 0, financeClosed: false, financeEvidence: "",
  },
});

describe("connected project plan", () => {
  it("shows package accountability, supplier lead time and aggregate booking truth", async () => {
    const onEdit = vi.fn();
    render(<ProjectConnectedPlan state={state()} onEdit={onEdit} />);

    expect(screen.getByRole("heading", { name: "Packages, promises and capacity" })).toBeVisible();
    expect(screen.getByText("Joinery partner · 2026-09-19 · 14d")).toBeVisible();
    expect(screen.getByText("Main factory · Confirmed")).toBeVisible();
    expect(screen.getByText("Confirm factory slot")).toBeVisible();
    expect(screen.queryByText(/leave|employee/i)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "package-1" }));
  });
});
