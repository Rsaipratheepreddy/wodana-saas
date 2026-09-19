import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import InternalPortalError from "./error";

it("offers an accessible retry when the tenant list cannot load", async () => {
  const reset = vi.fn();
  render(<InternalPortalError error={new Error("Backend unavailable")} reset={reset} />);
  expect(screen.getByRole("heading", { name: "Tenant controls are temporarily unavailable" })).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  expect(reset).toHaveBeenCalledOnce();
});
