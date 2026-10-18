import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { Questionnaire } from "@/lib/setup/questionnaires";
import { QuestionnaireEditor } from "./questionnaire-editor";

const view = (patch: Partial<Questionnaire> = {}): Questionnaire => ({
  purpose: "kickoff", name: "Kick-off meeting", step: "Recorded with the kick-off", revision: 3, version: 1, draftChanged: false, problems: [],
  draft: [{ key: "attendees", label: "Who attended the meeting?", kind: "text", required: false }],
  versions: [{ number: 1, note: "", publishedAt: "2026-10-17T08:00:00Z", by: "Owner", questions: 1 }],
  kit: [], jobTypes: [{ id: "fit_out", label: "Full Fit-Out" }], ...patch,
});

function mount() {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    const reply = method === "PUT" ? view({ revision: 4, draft: body.questions, draftChanged: true })
      : method === "POST" ? view({ revision: 5, version: 2, draftChanged: false }) : view();
    return { ok: true, status: 200, json: async () => reply };
  });
  vi.stubGlobal("fetch", fetcher);
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("Setup → Questionnaires (§0.3 P3)", () => {
  it("adds a required question to the draft, then publishes it after a review with the health check", async () => {
    const calls = mount();
    render(<DesignSystemProvider><QuestionnaireEditor workspaceId="w" purpose="kickoff" /></DesignSystemProvider>);
    expect(await screen.findByText("Version 1 is live")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    const dialog = await screen.findByRole("dialog", { name: "New question" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Question/ }), "Is the budget confirmed?");
    await userEvent.click(within(dialog).getByRole("switch", { name: "Required before the step completes" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ revision: 3, questions: [
      { key: "attendees", label: "Who attended the meeting?", kind: "text", required: false },
      { key: "", label: "Is the budget confirmed?", kind: "text", required: true },
    ] }));
    expect(await screen.findByText("Unpublished changes")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    const review = await screen.findByRole("dialog", { name: "Publish version 2" });
    expect(within(review).getByText("Every question is ready")).toBeInTheDocument();
    await userEvent.click(within(review).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ method: "POST", url: expect.stringContaining("/questionnaires/kickoff/publish"), body: { revision: 4, note: null } }));
    expect(await screen.findByText("Version 2 is live.")).toBeInTheDocument();
  });
});
