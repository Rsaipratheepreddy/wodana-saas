import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WodanaLogo } from "./wodana-logo";

describe("approved Wodana branding", () => {
  it.each(["standard", "large"] as const)("uses the approved transparent logo at %s size", (size) => {
    render(<WodanaLogo size={size} subtitle="Business workspace" />);
    const logo = screen.getByRole("img", { name: "Wodana" });
    expect(logo).toHaveAttribute("data-size", size);
    expect(logo.querySelector("img")?.getAttribute("src")).toContain("wodana-logo-v4.png");
    expect(logo.querySelector("img")).toHaveAttribute("width", "2172");
    expect(logo.querySelector("img")).toHaveAttribute("height", "724");
    expect(screen.getByText("Business workspace")).toBeVisible();
  });
});
