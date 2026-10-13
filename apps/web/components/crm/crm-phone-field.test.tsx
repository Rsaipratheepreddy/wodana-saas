import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
    expect(await screen.findByRole("textbox", { name: /Mobile/ })).toHaveValue("77807 68279");
    expect(screen.getByRole("button", { name: "Mobile country code" })).toHaveTextContent("+91");
  });

  it("switches the code when an international number is pasted, and on blur drops a leading 0 but keeps the local grouping", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const input = screen.getByRole("textbox", { name: /Mobile/ });
    await user.click(input);
    await user.paste("+44 7400 123456");
    expect(screen.getByRole("button", { name: "Mobile country code" })).toHaveTextContent("+44");
    expect(input).toHaveValue("7400 123456");
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Mobile country code" }));
    await user.type(screen.getByRole("searchbox", { name: "Search country or code" }), "United Arab");
    await user.click(screen.getByRole("option", { name: /United Arab Emirates/ }));
    await user.type(input, "050 123 4567");
    await user.tab();
    expect(input).toHaveValue("50 123 4567");
  });

  it("explains a number that is too long for the country (PLM-021)", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const input = screen.getByRole("textbox", { name: /Mobile/ });
    await user.type(input, "5012345678");
    await user.tab();
    expect(await screen.findByText("Enter a valid mobile number for United Arab Emirates (9 digits)")).toBeInTheDocument();
  });

  it("checks against the selected country: exactly its mobile length, and again at once when the country changes", async () => {
    const user = userEvent.setup();
    render(<Example initialCountry="IN" />);
    const input = screen.getByRole("textbox", { name: /Mobile/ });
    await user.type(input, "987654321");
    await user.tab();
    expect(await screen.findByText("Enter a valid mobile number for India (10 digits)")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    // One digit more is a valid Indian mobile: the error goes as the number is typed.
    await user.type(input, "0");
    expect(screen.queryByText(/Enter a valid mobile number/)).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid", "true");
    // Eleven digits is too many.
    await user.type(input, "1");
    expect(screen.getByText("Enter a valid mobile number for India (10 digits)")).toBeInTheDocument();
    await user.type(input, "{Backspace}");
    await user.tab();
    expect(screen.queryByText(/Enter a valid mobile number/)).not.toBeInTheDocument();
    // The same ten digits are not a UAE mobile: changing the country shows it straight away.
    await user.click(screen.getByRole("button", { name: "Mobile country code" }));
    await user.type(screen.getByRole("searchbox", { name: "Search country or code" }), "United Arab");
    await user.click(screen.getByRole("option", { name: /United Arab Emirates/ }));
    expect(await screen.findByText("Enter a valid mobile number for United Arab Emirates (9 digits)")).toBeInTheDocument();
  });

  it("blocks the form's save while the number is invalid", async () => {
    const user = userEvent.setup();
    const submitted = vi.fn();
    function Form() {
      const [country, setCountry] = useState("IN");
      const [value, setValue] = useState("");
      return <DesignSystemProvider><form onSubmit={(event) => { event.preventDefault(); submitted(); }}>
        <CrmPhoneField label="Mobile" value={value} onChange={setValue} countryCode={country} onCountryChange={setCountry} />
        <button type="submit">Save</button>
      </form></DesignSystemProvider>;
    }
    render(<Form />);
    await user.type(screen.getByRole("textbox", { name: /Mobile/ }), "98765");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(submitted).not.toHaveBeenCalled();
    expect(await screen.findByText("Enter a valid mobile number for India (10 digits)")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Mobile/ }), "43210");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(submitted).toHaveBeenCalledOnce();
  });
});
