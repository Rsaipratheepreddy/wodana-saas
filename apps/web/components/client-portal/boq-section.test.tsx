import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PortalApi } from "@/lib/client-portal/client";
import type { PortalBoq, PortalProject } from "@/lib/client-portal/types";
import type { PortalFormat } from "./portal-format";
import { BoqSection } from "./sections/boq-section";

const format = { money: (value: unknown, currency?: string | null) => `${currency} ${value}`, number: (value: unknown) => String(value) } as unknown as PortalFormat;
/** Text as read, without the bidi isolation marks the portal puts around numbers. */
const plain = (text: string) => (_: string, element: Element | null) => element?.children.length === 0 && (element?.textContent ?? "").replace(/[⁨⁩]/g, "") === text;
const props = { site: {} as never, api: {} as PortalApi, today: "2026-10-15", open: vi.fn(), go: vi.fn(), reload: vi.fn(), format };
const project = (boq: PortalBoq | null) => ({ id: "case-1", boq }) as unknown as PortalProject;
const boq: PortalBoq = {
  currency: "AED", revision: "R2", total: "7850.00",
  rooms: [
    { id: "r1", name: "Kitchen", total: "7200.00", lines: [
      { id: "l1", title: "Kitchen cabinets", description: "Oak veneer", quantity: "4.5", unit: "m", rate: "1200.00", amount: "5400.00" },
      { id: "l2", title: "Worktop", description: "", quantity: "2.25", unit: "m²", rate: "800.00", amount: "1800.00" },
    ] },
    { id: null, name: null, total: "650.00", lines: [{ id: "l3", title: "Lights", description: "", quantity: "1", unit: "nos", rate: "650.00", amount: "650.00" }] },
  ],
};

describe("PLM-170: the client's bill of quantities", () => {
  it("lists each room's items with quantity, unit, selling rate and amount, the room totals and the agreed total at the latest revision", () => {
    const { container } = render(<DesignSystemProvider locale="en-GB"><BoqSection {...props} project={project(boq)} /></DesignSystemProvider>);
    expect(screen.getByRole("region", { name: "Kitchen" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "General" })).toBeInTheDocument();
    expect(screen.getByText("Kitchen cabinets")).toBeInTheDocument();
    expect(screen.getByText("Oak veneer")).toBeInTheDocument();
    expect(screen.getByText(plain("4.5 m × AED 1200.00"))).toBeInTheDocument();
    expect(screen.getByText("AED 5400.00")).toBeInTheDocument();
    expect(screen.getByText("AED 7200.00")).toBeInTheDocument();
    expect(screen.getByText(plain("Agreed total · R2"))).toBeInTheDocument();
    expect(screen.getByText("AED 7850.00")).toBeInTheDocument();
    // Nothing of the cost side is on the page.
    expect(container.textContent).not.toMatch(/cost|margin|package|supplier/i);
  });

  it("says what will appear when there are no items yet, and renders nothing while the section is hidden", () => {
    render(<DesignSystemProvider locale="en-GB"><BoqSection {...props} project={project({ ...boq, rooms: [], total: "0.00" })} /></DesignSystemProvider>);
    expect(screen.getByText("No items yet")).toBeInTheDocument();
    const { container } = render(<DesignSystemProvider locale="en-GB"><BoqSection {...props} project={project(null)} /></DesignSystemProvider>);
    expect(container.textContent).toBe("");
  });
});
