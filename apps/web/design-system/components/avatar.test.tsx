import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "./avatar";
import { Avatar as LegacyAvatar } from "@/components/ui/avatar";
import { avatarVariant } from "@wodana/contracts";
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

describe("role avatars", () => {
  const userId = "3f1c2b7e-1d2a-4f5b-9c8d-0a1b2c3d4e5f";
  const variant = avatarVariant(userId);

  it("shows the main role's avatar for a person without a photo, with initials underneath until it loads", () => {
    render(<Avatar name="Omar Qasim" roles={["member", "quantity_surveyor"]} seed={userId} />);
    const avatar = screen.getByRole("img", { name: "Omar Qasim" });
    expect(avatar.querySelector("img")).toHaveAttribute("src", `/brand/avatars/estimator-${variant}.webp`);
    expect(avatar.querySelector("img")).toHaveAttribute("alt", "");
    expect(avatar).toHaveTextContent("OQ");
    expect(avatar.style.backgroundImage).toBe(identityStyle("Omar Qasim").backgroundImage);
  });

  it("keeps the same woman or man for the same person and uses default for unknown roles", () => {
    const { rerender } = render(<Avatar name="Sara Khan" roles={["wizard"]} seed={userId} />);
    const first = screen.getByRole("img", { name: "Sara Khan" }).querySelector("img")?.getAttribute("src");
    expect(first).toBe(`/brand/avatars/default-${variant}.webp`);
    rerender(<Avatar name="Sara Khan" roles={["wizard"]} seed={userId} size="lg" />);
    expect(screen.getByRole("img", { name: "Sara Khan" }).querySelector("img")).toHaveAttribute("src", first);
  });

  it("lets an uploaded photo win, and falls back to initials when the picture fails", () => {
    const { rerender } = render(<Avatar name="Layla Nasser" roles={["sales"]} seed={userId} src="/photo.webp" />);
    expect(screen.getByRole("img", { name: "Layla Nasser" }).querySelector("img")).toHaveAttribute("src", "/photo.webp");
    rerender(<Avatar name="Layla Nasser" roles={["sales"]} seed={userId} />);
    const picture = screen.getByRole("img", { name: "Layla Nasser" }).querySelector("img")!;
    expect(picture).toHaveAttribute("src", `/brand/avatars/sales-${variant}.webp`);
    fireEvent.error(picture);
    expect(screen.getByRole("img", { name: "Layla Nasser" }).querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Layla Nasser" })).toHaveTextContent("LN");
  });

  it("keeps initials for records that are not people", () => {
    render(<Avatar name="Villa 402" />);
    expect(screen.getByRole("img", { name: "Villa 402" }).querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Villa 402" })).toHaveTextContent("V4");
  });
});
