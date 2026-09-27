import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import InternalError from "./error";

it("offers an accessible retry when the console cannot load", async () => {
  const reset = vi.fn();
  render(<InternalError error={new Error("Backend unavailable")} reset={reset} />);
  expect(screen.getByText("Wodana Control is unavailable")).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  expect(reset).toHaveBeenCalledOnce();
});
