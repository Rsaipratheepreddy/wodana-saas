import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n/messages";
import { OPEN_ROLES, OpenRoles, TEAM, TeamGrid, type OpenRole } from "./company";
import { MarketingIntro } from "./marketing-frame";
import { tKey } from "@/lib/i18n/keys";

const t = translator("en");

describe("company pages", () => {
  it("lists no invented roles or people", () => {
    expect(OPEN_ROLES).toEqual([]);
    expect(TEAM).toEqual([]);
  });

  it("shows careers' empty state with a way to get in touch", () => {
    render(<OpenRoles roles={[]} t={t} />);
    expect(screen.getByText("No open roles right now")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get in touch" })).toHaveAttribute("href", "/contact-sales");
  });

  it("lists open roles once there are some", () => {
    const role: OpenRole = { id: "pm", title: tKey("Product designer"), team: tKey("Product"), location: tKey("Remote"), href: "/careers/product-designer" };
    render(<OpenRoles roles={[role]} t={t} />);
    expect(screen.getByRole("link", { name: /Product designer/ })).toHaveAttribute("href", "/careers/product-designer");
    expect(screen.queryByText("No open roles right now")).toBeNull();
  });

  it("shows the team's empty state until profiles are published", () => {
    render(<TeamGrid members={[]} t={t} />);
    expect(screen.getByText("Team profiles coming soon")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "About Wodana" })).toHaveAttribute("href", "/about");
  });

  it("gives each company page one title", () => {
    render(<MarketingIntro lead="The people building Wodana." title="Team" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Team");
  });
});
