import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { ShareQuote, whatsappLink } from "./share-quote";

const share = {
  portalUrl: "https://portal.example.test/portal?project=c1&open=decisions",
  contacts: [{ id: "g1", name: "Aisha Khan", phone: "15551234567", decides: true }],
  message: "Hello Aisha, Studio has sent you Kitchen (Q-2).",
  canResend: true,
};

describe("sharing a sent quote (Q-9)", () => {
  it("builds a WhatsApp link with the message written", () => {
    expect(whatsappLink("+1 555 123 4567", "Hi & bye")).toBe("https://wa.me/15551234567?text=Hi%20%26%20bye");
  });

  it("offers the portal link, WhatsApp to each contact and sending it again", async () => {
    const api = { share: vi.fn(async () => share), resend: vi.fn(async () => ({ channel: "email" as const, emailed: ["Aisha Khan"], reason: null })) };
    const onNotice = vi.fn();
    render(<DesignSystemProvider><ShareQuote api={api} onNotice={onNotice} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByRole("textbox", { name: "Portal link" })).toHaveValue(share.portalUrl);
    expect(screen.getByRole("link", { name: "WhatsApp Aisha Khan" })).toHaveAttribute("href", whatsappLink("15551234567", share.message));
    await userEvent.click(screen.getByRole("button", { name: "Send again" }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith({ tone: "success", message: "Sent again · email to Aisha Khan" }));
  });

  it("says so when it can't load, with a retry", async () => {
    const api = { share: vi.fn().mockRejectedValueOnce(new Error("Only a quote waiting for the client's decision can be shared.")).mockResolvedValueOnce(share), resend: vi.fn() };
    render(<DesignSystemProvider><ShareQuote api={api} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByText("Only a quote waiting for the client's decision can be shared.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("textbox", { name: "Portal link" })).toBeInTheDocument();
  });
});
