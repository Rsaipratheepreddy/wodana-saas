import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { READ_TIMEOUT_MS } from "@/lib/workspace/read-within";
import { AccessPointsEditor } from "./fit-check-panel";

const workspaceId = "a01f8d25-3678-4631-a7bb-7d665785d521";
const caseId = "ef3a85d0-371f-4c39-9efe-6dfaa37327d8";
const point = { id: "p1", version: 1, route: "Main", position: 0, kind: "door", label: "Front door", unit: "cm", width: "90", height: "210", turnWidth: null, cabinWidth: null, cabinDepth: null, cabinHeight: null };
const answer = (body: () => unknown, ok = true) => vi.fn(async (): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({ ok, status: ok ? 200 : 500, json: async () => body() }));
const mount = (onLoaded = vi.fn()) => { render(<DesignSystemProvider><AccessPointsEditor workspaceId={workspaceId} caseId={caseId} canEdit onLoaded={onLoaded} /></DesignSystemProvider>); return onLoaded; };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Site › Access card (D9): content, empty with the next action, error with Retry, never an endless skeleton", () => {
  it("lists the measured access points", async () => {
    vi.stubGlobal("fetch", answer(() => ({ points: [point], defaultUnit: "cm" })));
    const loaded = mount();
    expect(await screen.findByText("Front door")).toBeInTheDocument();
    expect(loaded).toHaveBeenCalledWith([point], "cm");
  });

  it("says nothing is measured yet and offers to add the first access point", async () => {
    vi.stubGlobal("fetch", answer(() => ({ points: [], defaultUnit: "cm" })));
    mount();
    expect(await screen.findByText("No access measured yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add access point" })).toBeInTheDocument();
  });

  it("shows an error with Retry when the read fails, and recovers", async () => {
    const fetcher = answer(() => ({ message: "" }), false);
    vi.stubGlobal("fetch", fetcher);
    mount();
    const retry = await screen.findByRole("button", { name: "Try again" });
    fetcher.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ points: [], defaultUnit: "in" }) }));
    await userEvent.click(retry);
    expect(await screen.findByText("No access measured yet")).toBeInTheDocument();
  });

  it("treats an answer without the list as a failed load", async () => {
    vi.stubGlobal("fetch", answer(() => ({ items: [] })));
    mount();
    expect(await screen.findByText("The access points could not be loaded.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("gives up on a read that never answers and offers Retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    mount();
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    expect(await screen.findByText("This is taking too long. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
