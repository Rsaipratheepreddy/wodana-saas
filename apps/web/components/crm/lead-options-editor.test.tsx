import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { LeadOptions } from "@/lib/crm/lead-options";
import { LeadOptionsEditor } from "./lead-options-editor";

const workspaceId = "e56299c6-3da3-402a-a9ac-3995bb37b9d4";
const kitchen = "55555555-5555-4555-8555-555555555555";
const options = { enquiryTypes: [{ id: "not_sure", label: "Not sure yet" }, { id: "kitchen", label: "Kitchen" }, { id: "option_new", label: "Garden" }] } as unknown as LeadOptions;

afterEach(() => vi.unstubAllGlobals());

describe("Enquiry options › enquiry types", () => {
  it("links each saved type to its own steps, with no flow to pick", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ taxonomies: [{ id: "t", code: "enquiry_type", version: 3, status: "active",
      options: [{ id: "n", code: "not_sure" }, { id: kitchen, code: "kitchen" }] }] }) })));
    render(<DesignSystemProvider locale="en-US" timeZone="UTC"><LeadOptionsEditor initialOptions={options} lists={["enquiry_type"]} onSaved={() => undefined} workspaceId={workspaceId} /></DesignSystemProvider>);
    const links = await screen.findAllByRole("link", { name: "Edit steps" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([`/workspace/enquiry-types/${kitchen}`]);
    expect(within(screen.getByRole("region", { name: "Enquiry options" })).queryByText("Flow")).toBeNull();
  });
});
