import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { factoryApi } from "@/lib/factory/client";
import type { SampleRequest, SamplesState } from "@/lib/factory/types";
import { SampleRequests } from "./samples";

const sample = (patch: Partial<SampleRequest> = {}): SampleRequest => ({
  id: "s1", number: 1, caseId: "c1", caseReference: "O-12", clientName: "Maya Client", projectId: null, projectReference: null, title: "Veneer control sample · Walnut", note: "",
  dueOn: "2099-10-13", status: "requested", requestedBy: "u1", requestedByName: "Dana Designer", requestedAt: "2099-10-01T09:00:00Z", readyNote: "", readyByName: null, readyAt: null,
  cancelReason: "", version: 1, appointmentOn: "2099-10-14", ...patch,
});

describe("sample requests on a case (PLM-061)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the factory for a sample, needed before the material selection, and withdraws one with why", async () => {
    let state: SamplesState = { samples: [], today: "2099-10-10", appointmentOn: "2099-10-14", suggestedDueOn: "2099-10-13", me: "u1", canRequest: true, canMake: false, canWithdrawAny: false };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      if (body && url.includes("/samples?")) state = { ...state, samples: [sample({ id: body.id, title: body.title, note: body.note, dueOn: body.dueOn })] };
      if (body?.action === "cancel") state = { ...state, samples: [sample({ status: "cancelled", cancelReason: body.reason, version: 2 })] };
      return { ok: true, status: 200, json: async () => state };
    });
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><SampleRequests api={factoryApi("w")} caseId="c1" /></DesignSystemProvider>);
    expect(await screen.findByText("No samples asked for yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Request a sample" }));
    const dialog = await screen.findByRole("dialog", { name: "Request a sample" });
    // Due the day before the appointment by default; the appointment shows under the date.
    expect(within(dialog).getByText("Material selection Oct 14, 2099")).toBeInTheDocument();
    const request = within(dialog).getByRole("button", { name: "Request" });
    expect(request).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Sample" }), "Veneer control sample · Walnut");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Note" }), "Two panels");
    await userEvent.click(request);
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => [String(url), JSON.parse(String(init!.body))]))
      .toEqual([[expect.stringContaining("/api/factory/samples?workspaceId=w"), { id: expect.any(String), caseId: "c1", title: "Veneer control sample · Walnut", note: "Two panels", dueOn: "2099-10-13" }]]));
    const list = await screen.findByRole("region", { name: "Samples" });
    expect(within(list).getByText("SR-0001 · Veneer control sample · Walnut")).toBeInTheDocument();
    expect(within(list).getByText("Requested")).toBeInTheDocument();

    // The person who asked withdraws it, saying why.
    await userEvent.click(within(list).getByRole("button", { name: "Withdraw" }));
    const withdraw = await screen.findByRole("dialog", { name: "Withdraw SR-0001" });
    expect(within(withdraw).getByRole("button", { name: "Withdraw" })).toBeDisabled();
    await userEvent.type(within(withdraw).getByRole("textbox", { name: "Why" }), "Client chose oak");
    await userEvent.click(within(withdraw).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body))).toEqual({ action: "cancel", reason: "Client chose oak", version: 1, caseId: "c1" }));
    expect(await within(screen.getByRole("region", { name: "Samples" })).findByText("Withdrawn")).toBeInTheDocument();
  });

  it("stays out of the way when nothing was asked and the person can't ask", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ samples: [], today: "2099-10-10", appointmentOn: null, suggestedDueOn: "2099-10-17", me: "u1",
      canRequest: false, canMake: false, canWithdrawAny: false }) })));
    const { container } = render(<DesignSystemProvider><SampleRequests api={factoryApi("w")} caseId="c1" /></DesignSystemProvider>);
    await waitFor(() => expect(container.querySelector("[aria-busy], .wd-skeleton")).toBeNull());
    expect(screen.queryByRole("region", { name: "Samples" })).toBeNull();
  });
});
