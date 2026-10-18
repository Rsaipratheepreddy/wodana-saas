import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { SignDocument } from "./sign-document";
import { SigningPage } from "./signing-page";

const view = {
  state: "open" as const,
  brand: { name: "Studio Interiors", logo: null, primaryColor: "#0F5C4A" },
  document: { title: "Kitchen", reference: "STU-Q-001-DXB", amount: "7000", currency: "AED", sha256: "a".repeat(64) },
  signer: { name: "Maya Client", email: "maya@example.com", phone: null },
  expiresAt: "2026-10-20T00:00:00.000Z",
  signed: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("signing a document by link (R8)", () => {
  it("signs only with a signature and consent, and sends the typed name", async () => {
    const onSign = vi.fn(async () => undefined);
    render(<DesignSystemProvider><SignDocument signer={view.signer} busy={false} onSign={onSign} /></DesignSystemProvider>);
    const sign = screen.getByRole("button", { name: "Sign" });
    expect(sign).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Type your name to sign" }), "Maya Client");
    expect(sign).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /agree to sign it electronically/ }));
    expect(sign).toBeEnabled();
    await userEvent.click(sign);
    await waitFor(() => expect(onSign).toHaveBeenCalledWith({ name: "Maya Client", email: "maya@example.com", phone: "", consent: true, signature: { kind: "typed", text: "Maya Client" } }));
  });

  it("offers a drawing pad as the other way to sign", async () => {
    render(<DesignSystemProvider><SignDocument signer={view.signer} busy={false} onSign={vi.fn()} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("radio", { name: "Draw" }));
    expect(screen.getByRole("img", { name: "Signature pad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("shows the exact document with its fingerprint, and signs with that fingerprint", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      const signed = calls.some((call) => call.url.endsWith("/sign"));
      return new Response(JSON.stringify(url.endsWith("/sign") ? { state: "signed", replayed: false, signedAt: "2026-10-06T10:00:00.000Z", signedSha256: "b".repeat(64) }
        : signed ? { ...view, state: "signed", signed: { at: "2026-10-06T10:00:00.000Z", name: "Maya Client", sha256: "b".repeat(64) } } : view), { status: 200 });
    }));
    render(<DesignSystemProvider><SigningPage token={"t".repeat(43)} /></DesignSystemProvider>);
    expect(await screen.findByRole("heading", { name: "Sign STU-Q-001-DXB" })).toBeInTheDocument();
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read the document" })).toHaveAttribute("href", `/api/esign/${"t".repeat(43)}/document`);
    await userEvent.type(screen.getByRole("textbox", { name: "Type your name to sign" }), "Maya Client");
    await userEvent.click(screen.getByRole("checkbox", { name: /agree to sign it electronically/ }));
    await userEvent.click(screen.getByRole("button", { name: "Sign" }));
    expect(await screen.findByRole("heading", { name: "Signed" })).toBeInTheDocument();
    expect(JSON.parse(calls.find((call) => call.url.endsWith("/sign"))!.body!)).toMatchObject({ documentSha256: "a".repeat(64), consent: true, signature: { kind: "typed", text: "Maya Client" } });
    expect(screen.getByRole("link", { name: "Download your signed copy" })).toHaveAttribute("href", `/api/esign/${"t".repeat(43)}/document?copy=signed`);
  });

  it("says an expired link can't be signed, and who to ask", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...view, state: "expired" }), { status: 200 })));
    render(<DesignSystemProvider><SigningPage token={"t".repeat(43)} /></DesignSystemProvider>);
    expect(await screen.findByText("This signing link has expired")).toBeInTheDocument();
    expect(screen.getByText("Ask Studio Interiors for a new link.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign" })).not.toBeInTheDocument();
  });
});
