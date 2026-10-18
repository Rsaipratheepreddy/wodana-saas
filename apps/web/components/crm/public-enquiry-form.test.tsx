import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PublicEnquiryForm } from "@/lib/crm/lead-forms";
import { PublicEnquiryFormView } from "./public-enquiry-form";

const form: PublicEnquiryForm = {
  title: "Tell us about your project",
  description: "Share the essentials.",
  revision: "revision-one",
  consentLabel: "I agree to be contacted about this enquiry.",
  questions: [
    { id: "name", title: "Your name", description: "", type: "text", required: true, options: [] },
    { id: "type", title: "What can we help with?", description: "", type: "radio", required: true, options: [{ id: "renovation_fit_out", label: "Renovation / Fit-Out" }] },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("PublicEnquiryFormView", () => {
  it("blocks an unconsented submission", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const interaction = userEvent.setup();
    render(<DesignSystemProvider><PublicEnquiryFormView form={form} token="token" /></DesignSystemProvider>);
    await interaction.type(screen.getByRole("textbox", { name: "Your name" }), "Noor Al Mansoori");
    await interaction.click(screen.getByRole("radio", { name: "Renovation / Fit-Out" }));
    // Until the consent is ticked, Submit is disabled and says why.
    const submit = screen.getByRole("button", { name: "Submit enquiry" });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription("Tick the box to submit");
    await interaction.click(submit);
    expect(request).not.toHaveBeenCalled();
    await interaction.click(screen.getByRole("checkbox", { name: form.consentLabel }));
    expect(submit).toBeEnabled();
    expect(screen.queryByText("Tick the box to submit")).not.toBeInTheDocument();
  });

  it("asks one question per screen with progress, then consent", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ received: true }) });
    vi.stubGlobal("fetch", request);
    const interaction = userEvent.setup();
    render(<DesignSystemProvider><PublicEnquiryFormView form={form} token="token" layout="steps" /></DesignSystemProvider>);
    expect(screen.getByRole("progressbar", { name: "Form progress" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.queryByRole("radio", { name: "Renovation / Fit-Out" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: form.consentLabel })).not.toBeInTheDocument();
    // A required question must be answered before the next one.
    await interaction.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("textbox", { name: "Your name" })).toBeInvalid();
    await interaction.type(screen.getByRole("textbox", { name: "Your name" }), "Noor Al Mansoori{Enter}");
    expect(screen.getByRole("progressbar", { name: "Form progress" })).toHaveAttribute("aria-valuenow", "1");
    await interaction.click(screen.getByRole("radio", { name: "Renovation / Fit-Out" }));
    await interaction.click(screen.getByRole("button", { name: "Next" }));
    await interaction.click(screen.getByRole("checkbox", { name: form.consentLabel }));
    await interaction.click(screen.getByRole("button", { name: "Submit enquiry" }));
    expect(await screen.findByRole("heading", { name: "Thank you for your enquiry" })).toBeInTheDocument();
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ serviceConsent: true, answers: { name: "Noor Al Mansoori", type: "renovation_fit_out" } });
  });

  it("submits explicit consent with the original answer identifiers", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ received: true }) });
    vi.stubGlobal("fetch", request);
    const interaction = userEvent.setup();
    render(<DesignSystemProvider><PublicEnquiryFormView form={form} token="token" /></DesignSystemProvider>);
    await interaction.type(screen.getByRole("textbox", { name: "Your name" }), "Noor Al Mansoori");
    await interaction.click(screen.getByRole("radio", { name: "Renovation / Fit-Out" }));
    await interaction.click(screen.getByRole("checkbox", { name: form.consentLabel }));
    await interaction.click(screen.getByRole("button", { name: "Submit enquiry" }));
    expect(await screen.findByRole("heading", { name: "Thank you for your enquiry" })).toBeInTheDocument();
    expect(request).toHaveBeenCalledOnce();
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
      revision: "revision-one",
      serviceConsent: true,
      answers: { name: "Noor Al Mansoori", type: "renovation_fit_out" },
      // Junk checks (S-13): how long the form was open; the hidden field stays empty for a person.
      elapsedMs: expect.any(Number),
    });
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).not.toHaveProperty("website");
  });

  it("submits the country selected for a customer phone question", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ received: true }) });
    vi.stubGlobal("fetch", request);
    const interaction = userEvent.setup();
    render(<DesignSystemProvider><PublicEnquiryFormView form={{ ...form, defaultCountryCode: "AE", questions: [...form.questions, { id: "mobile", title: "Mobile number", description: "", type: "tel", required: true, options: [] }] }} token="token" /></DesignSystemProvider>);
    await interaction.type(screen.getByRole("textbox", { name: "Your name" }), "Noor Al Mansoori");
    await interaction.click(screen.getByRole("radio", { name: "Renovation / Fit-Out" }));
    await interaction.type(screen.getByRole("textbox", { name: "Mobile number" }), "050 123 4567");
    await interaction.click(screen.getByRole("checkbox", { name: form.consentLabel }));
    await interaction.click(screen.getByRole("button", { name: "Submit enquiry" }));
    expect(await screen.findByRole("heading", { name: "Thank you for your enquiry" })).toBeInTheDocument();
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ phoneCountryCodes: { mobile: "AE" }, answers: { mobile: "501234567" } });
  });

  it("asks for the place as text when the region is Other", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ received: true }) });
    vi.stubGlobal("fetch", request);
    const interaction = userEvent.setup();
    const internationalForm: PublicEnquiryForm = { ...form, questions: [
      ...form.questions,
      { id: "emirate", field: "emirate", title: "Emirate", description: "", type: "dropdown", required: true, options: [{ id: "dubai", label: "Dubai" }, { id: "other", label: "Other" }] },
      { id: "area", field: "area", title: "Area", description: "", type: "dropdown", required: false, options: [] },
    ], areas: { dubai: [{ id: "marina", label: "Dubai Marina" }] } };
    render(<DesignSystemProvider><PublicEnquiryFormView form={internationalForm} token="token" /></DesignSystemProvider>);
    await interaction.type(screen.getByRole("textbox", { name: "Your name" }), "Noor Al Mansoori");
    await interaction.click(screen.getByRole("radio", { name: "Renovation / Fit-Out" }));
    await interaction.click(screen.getByRole("button", { name: /Emirate/ }));
    await interaction.click(screen.getByRole("option", { name: "Other" }));
    expect(screen.queryByRole("button", { name: "Area" })).not.toBeInTheDocument();
    await interaction.type(screen.getByRole("textbox", { name: "Area" }), "Muscat, Oman");
    await interaction.click(screen.getByRole("checkbox", { name: form.consentLabel }));
    await interaction.click(screen.getByRole("button", { name: "Submit enquiry" }));
    expect(await screen.findByRole("heading", { name: "Thank you for your enquiry" })).toBeInTheDocument();
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).answers).toMatchObject({ emirate: "other", area: "Muscat, Oman" });
  });
});
