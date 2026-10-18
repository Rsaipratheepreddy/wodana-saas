import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { leadsPageFixture } from "@/lib/crm/leads";
import { crmRequest } from "@/lib/crm/client";
import { CrmAttachments } from "./crm-attachments";
vi.mock("@/lib/crm/client", () => ({ crmRequest: vi.fn() }));
it("loads only the chosen enquiry and links files to the authenticated asset route", async () => {
  vi.mocked(crmRequest).mockResolvedValue({ items: [{ id:"note-1",title:"Brief",assets:[{id:"file-1",name:"Plan.pdf",mimeType:"application/pdf",byteSize:1024}] }] });
  render(<CrmAttachments initialData={leadsPageFixture} />);
  expect(crmRequest).not.toHaveBeenCalled();
  const lead = leadsPageFixture.items[0];
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Choose enquiry/ }));
  await user.click(screen.getByRole("option", { name: new RegExp(lead.title) }));
  await waitFor(() => expect(screen.getByRole("link",{name:"Plan.pdf"})).toHaveAttribute("href",expect.stringContaining(`/lead/${lead.id}/note-1/assets/file-1`)));
});
