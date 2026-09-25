import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { CrmPhoneField } from "./crm-phone-field";

function Example() {
  const [country, setCountry] = useState("AE");
  const [value, setValue] = useState("");
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
    await user.type(screen.getByRole("searchbox", { name: "Search mobile country" }), "India");
    const option = screen.getByRole("option", { name: /India.*\+91|\+91.*India/ });
    expect(option).toHaveTextContent("+91");
    expect(option).toHaveTextContent("India");
    await user.click(option);
    expect(trigger).toHaveTextContent("+91");
    expect(trigger).not.toHaveTextContent("India");
  });
});
