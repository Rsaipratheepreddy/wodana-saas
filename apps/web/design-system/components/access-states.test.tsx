import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "../foundations/provider";
import { isNoAccessError } from "../foundations/access";
import { timeZoneCity } from "../foundations/time-zone";
import { PersonChip, PersonName, personDisplayName } from "./person";
import { NoAccessNotice, NoAccessState } from "./status";

describe("no-access states", () => {
  it("names the area and who to ask, with no retry and no permission codes", () => {
    render(<DesignSystemProvider><NoAccessState area="Finance" /></DesignSystemProvider>);
    expect(screen.getByText("You don't have access to Finance")).toBeInTheDocument();
    expect(screen.getByText("Ask your workspace admin for access.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has an inline form that works right-to-left", () => {
    render(<DesignSystemProvider direction="rtl"><NoAccessNotice area="Lead sources" /></DesignSystemProvider>);
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("You don't have access to Lead sources");
    expect(notice.closest("[dir]")).toHaveAttribute("dir", "rtl");
  });

  it("recognises refusals by status or the service's wording", () => {
    expect(isNoAccessError(Object.assign(new Error("Forbidden"), { status: 403 }))).toBe(true);
    expect(isNoAccessError("Permissions required: payables.view")).toBe(true);
    expect(isNoAccessError(new Error("Any permission required: module.members.read"))).toBe(true);
    expect(isNoAccessError(new Error("You do not have access to this HRMS action."))).toBe(true);
    expect(isNoAccessError(new Error("You don't have access to projects."))).toBe(true);
    expect(isNoAccessError(Object.assign(new Error("Service unavailable"), { status: 503 }))).toBe(false);
    expect(isNoAccessError("")).toBe(false);
  });
});

describe("people are named, not addressed", () => {
  it("uses the display name, else the part of the email before the @, as entered", () => {
    expect(personDisplayName({ displayName: "Sara Khan", email: "sara@example.com" })).toBe("Sara Khan");
    expect(personDisplayName("Operations@palmliving.example")).toBe("Operations");
    expect(personDisplayName({ email: "omar.qs@example.com" })).toBe("omar.qs");
    expect(personDisplayName(null)).toBe("");
  });

  it("keeps the full email as a tooltip and never re-cases it", () => {
    render(<DesignSystemProvider><PersonName person="operations@example.com" /><PersonChip person={{ name: "Layla" }} /></DesignSystemProvider>);
    expect(screen.getByText("operations")).toHaveAttribute("title", "operations@example.com");
    expect(screen.getByText("Layla")).toBeInTheDocument();
  });

  it("names a time zone by its city", () => {
    expect(timeZoneCity("Asia/Dubai")).toBe("Dubai");
    expect(timeZoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });
});
