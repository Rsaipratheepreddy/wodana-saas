import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { needsReconnect, SOURCE_MESSAGES, StatementSourceErrorState } from "./source-error";

describe("a statement the accounting system couldn't give", () => {
  it("asks to reconnect when the grant expired or the company isn't connected", () => {
    render(<DesignSystemProvider><StatementSourceErrorState status={409} message={SOURCE_MESSAGES.reconnect} /></DesignSystemProvider>);
    expect(screen.getByText("Reconnect the accounting system")).toBeInTheDocument();
    expect(screen.getByText(SOURCE_MESSAGES.reconnect)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", "/workspace/integrations");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(needsReconnect(400, SOURCE_MESSAGES.not_connected)).toBe(true);
  });

  it("offers Try again when the accounting system was busy or didn't answer", async () => {
    const retry = vi.fn();
    render(<DesignSystemProvider><StatementSourceErrorState status={502} message={SOURCE_MESSAGES.unavailable} onRetry={retry} /></DesignSystemProvider>);
    expect(screen.getByText(SOURCE_MESSAGES.unavailable)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reconnect" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(needsReconnect(429, SOURCE_MESSAGES.busy)).toBe(false);
  });
});
