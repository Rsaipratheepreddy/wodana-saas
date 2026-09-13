import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "./avatar";
import { Avatar as LegacyAvatar } from "@/components/ui/avatar";
import { identityStyle } from "@/lib/brand/identity";

describe("shared avatar branding", () => {
  it("uses the same gradient in both component families and every size", () => {
    render(<><Avatar name="Iglo Administrator" size="sm" /><Avatar name="Iglo Administrator" size="lg" /><LegacyAvatar name="Iglo Administrator" /></>);
    for (const avatar of screen.getAllByRole("img", { name: "Iglo Administrator" })) {
      expect(avatar).toHaveTextContent("IA");
      expect(avatar.style.backgroundImage).toBe(identityStyle("Iglo Administrator").backgroundImage);
      expect(avatar.style.color).toBe("var(--wd-identity-ink)");
    }
  });

  it("leaves photos intact and removes fallback initials and gradient", () => {
    render(<Avatar name="Noura Haddad" src="/portrait.png" />);
    const avatar = screen.getByRole("img", { name: "Noura Haddad" });
    expect(avatar.querySelector("img")).toHaveAttribute("src", "/portrait.png");
    expect(avatar).not.toHaveTextContent("NH");
    expect(avatar.style.backgroundImage).toBe("");
  });
});
