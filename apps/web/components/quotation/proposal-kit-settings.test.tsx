import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ProposalKit } from "@/lib/commercial/types";
import { ProposalKitSettings } from "./proposal-kit-settings";

const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const pixel = "data:image/png;base64,iVBORw0KGgo=";
const kit: ProposalKit = { introduction: "We design calm homes.", letterNote: "", defaultTerms: "TERMS\nOne.", defaultExclusions: "", contactDetails: "hello@studio.test", website: "studio.test",
  introductionImage: pixel, closingImage: null, monogramImage: null, termsImages: [], version: 4 };

function serve(canManage: boolean, saved?: (body: Record<string, unknown>) => ProposalKit) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") return new Response(JSON.stringify(saved!(JSON.parse(String(init.body)))), { status: 200 });
    return new Response(JSON.stringify({ kit, canManage }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const mount = () => render(<DesignSystemProvider><ProposalKitSettings workspaceId={WORKSPACE} /></DesignSystemProvider>);

afterEach(() => vi.unstubAllGlobals());

describe("proposal kit settings", () => {
  it("shows the firm's words and pictures read-only to someone who can't manage settings", async () => {
    serve(false);
    mount();
    expect(await screen.findByDisplayValue("We design calm homes.")).toHaveAttribute("readonly");
    expect(screen.getByRole("img", { name: "Introduction picture" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upload|Replace/ })).not.toBeInTheDocument();
  });

  it("saves only the changed words, with the version it read", async () => {
    const fetchMock = serve(true, (body) => ({ ...kit, ...body, version: 5 } as ProposalKit));
    mount();
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Letter note" }), { target: { value: "Lead time is six weeks." } });
    fireEvent.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/quotation/proposal-kit?"), expect.objectContaining({ method: "PUT" })));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ letterNote: "Lead time is six weeks.", version: 4 });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("removes a picture on its own, leaving unsaved words alone", async () => {
    const fetchMock = serve(true, (body) => ({ ...kit, ...body, version: 5 } as ProposalKit));
    mount();
    fireEvent.change(await screen.findByRole("textbox", { name: "Website" }), { target: { value: "studio.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "Introduction picture" })).not.toBeInTheDocument());
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ introductionImage: null, version: 4 });
    expect(screen.getByRole("textbox", { name: "Website" })).toHaveValue("studio.example");
  });
});
