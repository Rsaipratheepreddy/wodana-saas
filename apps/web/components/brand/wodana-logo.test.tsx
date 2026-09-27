import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WodanaLogo } from "./wodana-logo";

describe("approved Wodana branding", () => {
  it.each(["micro", "compact", "small", "standard", "large"] as const)("shows the house mark and the wordmark at %s size", (size) => {
    render(<WodanaLogo size={size} subtitle="Business workspace" />);
    const logo = screen.getByRole("img", { name: "Wodana" });
    expect(logo).toHaveAttribute("data-size", size);
    expect(logo).toHaveAttribute("dir", "ltr");
    expect(logo.querySelector("img")?.getAttribute("src")).toBe("/brand/logo/wodana-mark.svg");
    expect(logo).toHaveTextContent("wodana");
    expect(screen.getByText("Business workspace")).toBeVisible();
  });
});
