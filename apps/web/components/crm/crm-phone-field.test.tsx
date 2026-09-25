import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { CrmPhoneField } from "./crm-phone-field";

function Example({ initial = "", initialCountry = "AE" }: { initial?: string; initialCountry?: string }) {
  const [country, setCountry] = useState(initialCountry);
  const [value, setValue] = useState(initial);
  return <DesignSystemProvider><CrmPhoneField label="Mobile" value={value} onChange={setValue} countryCode={country} onCountryChange={setCountry} /></DesignSystemProvider>;
}

describe("CRM phone country picker", () => {
  it("keeps the selected control compact while showing names beside codes in search results", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Mobile country code" });
    expect(trigger).toHaveTextContent("+971");
    expect(trigger).not.toHaveTextContent("United Arab Emirates");
    await user.click(trigger);
    await user.type(screen.getByRole("searchbox", { name: "Search country or code" }), "India");
    const option = screen.getByRole("option", { name: /India.*\+91|\+91.*India/ });
    expect(option).toHaveTextContent("+91");
    expect(option).toHaveTextContent("India");
    await user.click(option);
    expect(trigger).toHaveTextContent("+91");
    expect(trigger).not.toHaveTextContent("India");
  });

  it("never shows or saves the country code twice (PLM-034)", async () => {
    render(<Example initial="+917780768279" initialCountry="IN" />);
    expect(await screen.findByRole("textbox", { name: /Mobile/ })).toHaveValue("7780768279");
    expect(screen.getByRole("button", { name: "Mobile country code" })).toHaveTextContent("+91");
  });

  it("switches the code when an international number is pasted, and drops a leading 0 on blur", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const input = screen.getByRole("textbox", { name: /Mobile/ });
    await user.click(input);
    await user.paste("+44 7400 123456");
    expect(screen.getByRole("button", { name: "Mobile country code" })).toHaveTextContent("+44");
    expect(input).toHaveValue("7400123456");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Mobile country code" }));
    await user.type(screen.getByRole("searchbox", { name: "Search country or code" }), "United Arab");
    await user.click(screen.getByRole("option", { name: /United Arab Emirates/ }));
    await user.type(input, "050 123 4567");
    await user.tab();
    expect(input).toHaveValue("501234567");
  });

  it("explains a number that is too long for the country (PLM-021)", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const input = screen.getByRole("textbox", { name: /Mobile/ });
    await user.type(input, "5012345678");
    await user.tab();
    expect(await screen.findByText(/Too long — United Arab Emirates mobile numbers are 9 digits after \+971/)).toBeInTheDocument();
  });
});
