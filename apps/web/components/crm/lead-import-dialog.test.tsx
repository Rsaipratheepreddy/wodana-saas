import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { leadsPageFixture } from "@/lib/crm/leads";
import { LeadImportDialog } from "./lead-import-dialog";

afterEach(() => vi.unstubAllGlobals());

it("imports mapped CSV values through the common intake with automatic assignment", async () => {
  const user = userEvent.setup();
  const data = structuredClone(leadsPageFixture);
  data.leadOptions = {
    sources: [{ id: "company", label: "Company" }],
    channels: { company: [{ id: "website", label: "Website" }] },
    enquiryTypes: [{ id: "design", label: "Design" }],
    emirates: [{ id: "dubai", label: "Dubai" }], areas: { dubai: [{ id: "marina", label: "Dubai Marina" }] },
    budgetRanges: [], customerTypes: [],
  };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ready", reference: "E-0042" }) });
  vi.stubGlobal("fetch", fetchMock);
  const onImported = vi.fn().mockResolvedValue(undefined);
  render(<DesignSystemProvider><LeadImportDialog initialData={data} onClose={vi.fn()} onImported={onImported} /></DesignSystemProvider>);
  const file = new File(["Customer name,Mobile,Emirate,Enquiry type,Area\nAsha Rao,+971501234567,Dubai,Design,Dubai Marina"], "leads.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => "Customer name,Mobile,Emirate,Enquiry type,Area\nAsha Rao,+971501234567,Dubai,Design,Dubai Marina" });
  fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } });
  expect(await screen.findByText(/leads.csv · 1 row/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Default source/ }));
  await user.click(screen.getByRole("option", { name: "Company" }));
  await user.click(screen.getByRole("button", { name: "Import enquiries" }));
  await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body).toMatchObject({ workspaceId: data.workspaceId, source: "company", channel: "website", serviceType: "design", party: { displayName: "Asha Rao", mobile: "+971501234567" }, details: { emirate: "dubai", area: "marina" } });
  expect(screen.getByText(/1 created · 0 failed/)).toBeInTheDocument();
});
