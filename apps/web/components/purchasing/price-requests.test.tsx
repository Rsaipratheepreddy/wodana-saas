import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PurchasingApi } from "@/lib/purchasing/client";
import { PriceRequests } from "./price-requests";

const row = (id: string, number: number, replied: number) => ({ id, number, status: "open" as const, neededBy: null, createdAt: "2026-09-20", createdByName: "Faisal", lines: 2, suppliers: 2, replied, projects: ["PRJ-0004"] });

it("reads Ready to award once every supplier asked has replied, and Waiting for prices before", async () => {
  const api = { priceRequests: vi.fn(async () => ({ requests: [row("r1", 1, 2), row("r2", 2, 1)], canBuy: true })) } as unknown as PurchasingApi;
  render(<DesignSystemProvider><PriceRequests api={api} openId={null} onOpen={vi.fn()} onOrder={vi.fn()} refreshKey={0} /></DesignSystemProvider>);
  const first = (await screen.findByText("Price request 1")).closest("tr")!;
  expect(within(first).getByText("Ready to award")).toBeInTheDocument();
  const second = screen.getByText("Price request 2").closest("tr")!;
  expect(within(second).getByText("Waiting for prices")).toBeInTheDocument();
});
