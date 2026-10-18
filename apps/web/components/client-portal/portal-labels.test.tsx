import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StateLabel } from "./portal-labels";

describe("portal state labels", () => {
  it("say \"Waiting for you\" only to the person who decides", () => {
    const { rerender } = render(<StateLabel state="issued" canDecide />);
    expect(screen.getByText("Waiting for you")).toBeInTheDocument();
    rerender(<StateLabel state="issued" canDecide={false} />);
    expect(screen.getByText("Waiting for a decision")).toBeInTheDocument();
    rerender(<StateLabel state="accepted" canDecide={false} />);
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });
});
