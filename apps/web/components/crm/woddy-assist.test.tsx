import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WoddyAssist } from "./woddy-assist";

const suggestion = {
  id: "8b87894d-f8ea-42ea-9c69-58733e04d2b3",
  title: "Enquiry review · Villa",
  suggestionText: "Assign an owner and schedule a follow-up.",
  editedText: null,
  evidence: [{ label: "Ownership", value: "Unassigned", source: "CRM assignment" }],
  proposedDiff: [{ field: "ownerMembershipId", label: "Sales owner", before: "Unassigned", after: "Choose an eligible owner" }],
  uncertainty: ["Woddy does not choose a person automatically."],
  provenance: { mode: "rules", provider: "wodana_rules", model: "crm_checklist_v1" },
  status: "pending",
  version: 1,
};

afterEach(() => vi.unstubAllGlobals());

describe("WoddyAssist", () => {
  it("shows evidence, diff and uncertainty, then records an edited decision", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => String(input).includes("/decision") ? { ...suggestion, suggestionText: suggestion.suggestionText, editedText: "Call the client tomorrow.", status: "edited", version: 2 } : suggestion,
    }));
    vi.stubGlobal("fetch", fetcher);
    render(<WoddyAssist leadId="ecdf2b57-c501-4f2f-bfa8-2fa369687b0f" workspaceId="f81e8362-8d08-440a-89dd-06ec7a8b46e7" />);

    await user.click(screen.getByRole("button", { name: "Review enquiry" }));
    expect(await screen.findByRole("region", { name: "Enquiry review · Villa" })).toHaveTextContent("Evidence used");
    expect(screen.getByText("CRM assignment")).toBeInTheDocument();
    expect(screen.getByText("Choose an eligible owner")).toBeInTheDocument();
    expect(screen.getByText("Woddy does not choose a person automatically.")).toBeInTheDocument();

    const editor = screen.getByRole("textbox", { name: "Suggestion" });
    await user.clear(editor);
    await user.type(editor, "Call the client tomorrow.");
    await user.click(screen.getByRole("button", { name: "Accept edit" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("/decision"))).toBe(true));
    const request = fetcher.mock.calls.find(([url]) => String(url).includes("/decision"))?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({ action: "edited", editedText: "Call the client tomorrow.", version: 1 });
    expect(await screen.findByText("Review recorded. No source record was changed.")).toBeInTheDocument();
  });
});
