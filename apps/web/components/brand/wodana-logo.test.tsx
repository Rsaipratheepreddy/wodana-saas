import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WodanaLogo } from "./wodana-logo";

describe("approved Wodana branding", () => {
  it.each(["micro", "compact", "small", "standard", "large"] as const)("draws the house and the wordmark at %s size", (size) => {
    render(<WodanaLogo size={size} subtitle="Business workspace" />);
    const logo = screen.getByRole("img", { name: "Wodana" });
    expect(logo).toHaveAttribute("data-size", size);
    expect(logo).toHaveAttribute("dir", "ltr");
    // Three mark shapes plus the wordmark, which follows the text colour.
    expect(logo.querySelectorAll("svg path")).toHaveLength(4);
    expect(logo.querySelector("svg path[fill='currentColor']")).not.toBeNull();
    expect(screen.getByText("Business workspace")).toBeVisible();
  });

  it("shows only the house when asked", () => {
    render(<WodanaLogo markOnly />);
    expect(screen.getByRole("img", { name: "Wodana" }).querySelectorAll("svg path")).toHaveLength(3);
  });
});
