import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n/messages";
import { Phone } from "./devices";
import { SHOTS } from "./landing-shots";

const t = translator("en");

describe("phone mockups", () => {
  it("draws an iPhone around a described app screen, with the hardware hidden from assistive tech", () => {
    const { container } = render(<Phone shot={SHOTS.appToday} sizes="300px" t={t} width="18rem" />);
    const image = screen.getByRole("img", { name: "The mobile app: today's sites, tasks and deliveries" });
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
    expect(image.getAttribute("src")).toMatch(/^\/landing\/opt\/app-today-540\.[0-9a-f]{8}\.webp$/);
    expect(container.querySelector("source[type='image/avif']:not([media])")?.getAttribute("srcset"))
      .toMatch(/app-today-360\.[0-9a-f]{8}\.avif 360w, .+ 540w, .+ 720w$/);
    const device = container.firstElementChild as HTMLElement;
    expect(device).toHaveAttribute("data-kind", "iphone");
    expect(device.style.getPropertyValue("--device-w")).toBe("18rem");
    for (const part of device.querySelectorAll("span")) {
      if (!part.closest("picture")) expect(part.closest("[aria-hidden='true']")).not.toBeNull();
    }
    expect(container.querySelector("source[type='image/avif'][media='(prefers-color-scheme: dark)']")?.getAttribute("srcset")).toContain("app-today-dark-");
  });

  it("draws an Android phone with a punch-hole camera", () => {
    const { container } = render(<Phone kind="android" shot={SHOTS.appReport} sizes="300px" t={t} />);
    expect(container.firstElementChild).toHaveAttribute("data-kind", "android");
    expect(screen.getByRole("img", { name: "The mobile app: daily site report" })).toBeInTheDocument();
  });
});
