import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WodanaLogo } from "./wodana-logo";

describe("approved Wodana branding", () => {
  it.each(["micro", "compact", "small", "standard", "large"] as const)("uses the approved transparent logo at %s size", (size) => {
    render(<WodanaLogo size={size} subtitle="Business workspace" />);
    const logo = screen.getByRole("img", { name: "Wodana" });
    expect(logo).toHaveAttribute("data-size", size);
    expect(logo.querySelector("img")?.getAttribute("src")).toContain("wodana-logo-v5.png");
    expect(logo.querySelector("img")).toHaveAttribute("width", "1973");
    expect(logo.querySelector("img")).toHaveAttribute("height", "587");
    expect(screen.getByText("Business workspace")).toBeVisible();
  });
});
