import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider, SelectField, TextInput } from "@/design-system";
import { BlockedSaveBoundary } from "./blocked-save-alert";

describe("blocked save", () => {
  it("names the missing required fields and shows why on each field instead of failing silently", async () => {
    const onSubmit = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(<BlockedSaveBoundary><DesignSystemProvider>
      <form onSubmit={onSubmit}>
        <TextInput isRequired label="Customer name" />
        <SelectField isRequired label="Lead source" items={[{ id: "referral", label: "Referral" }]} />
        <button type="submit">Save</button>
      </form>
    </DesignSystemProvider></BlockedSaveBoundary>);

    await act(async () => { screen.getByRole("button", { name: "Save" }).closest("form")!.requestSubmit(); await Promise.resolve(); });

    expect(onSubmit).not.toHaveBeenCalled();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Not saved yet");
    expect(alert).toHaveTextContent("Customer name");
    expect(alert).toHaveTextContent("Lead source");
    expect(screen.getAllByText("Required").length).toBeGreaterThanOrEqual(1);
  });
});
