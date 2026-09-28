import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import WorkspaceScreenError from "./error";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const failure = (message: string, status?: number) => Object.assign(new Error(message), status ? { status } : {});

describe("workspace page errors", () => {
  it("says a record changed while it was open, and reloads instead of blaming the connection", async () => {
    const reset = vi.fn();
    render(<WorkspaceScreenError error={failure("Version conflict", 409)} reset={reset} />);
    expect(screen.getByText("This changed while you were away")).toBeVisible();
    expect(screen.queryByText(/Check your connection/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reload" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("shows the service's reason when it refuses a request", () => {
    render(<WorkspaceScreenError error={failure("The quote has no lines yet.", 422)} reset={vi.fn()} />);
    expect(screen.getByText("The quote has no lines yet.")).toBeVisible();
    expect(screen.queryByText(/Check your connection/)).not.toBeInTheDocument();
  });

  it("keeps the connection advice for a service that didn't answer", () => {
    render(<WorkspaceScreenError error={failure("fetch failed")} reset={vi.fn()} />);
    expect(screen.getByText("This page didn't load")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
