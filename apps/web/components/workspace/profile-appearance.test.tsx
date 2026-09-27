import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AVATAR_KEYS, avatarVariant } from "@wodana/contracts";
import { Avatar } from "@/design-system";
import { ProfileAppearance } from "./profile-appearance";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

const workspaceId = "6d0f2b67-6f6a-4a22-8cb0-3f2d5d77a33a";
const userId = "00000000-0000-4000-8000-000000000001";

describe("avatars", () => {
  it("has a woman and a man for each of the sixteen roles", () => {
    expect(AVATAR_KEYS).toHaveLength(32);
    expect(AVATAR_KEYS.filter((key) => key.endsWith("-f"))).toHaveLength(16);
  });

  it("prefers the photo, then the chosen picture, then the role's, and keeps initials for records", () => {
    const { container, rerender } = render(<Avatar name="Sara Khan" preset="painter-m" roles={["sales"]} seed={userId} src="/photo.webp" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/photo.webp");
    rerender(<Avatar name="Sara Khan" preset="painter-m" roles={["sales"]} seed={userId} />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/brand/avatars/painter-m.webp");
    rerender(<Avatar name="Sara Khan" preset="b03" roles={["sales"]} seed={userId} />);
    expect(container.querySelector("img")).toHaveAttribute("src", `/brand/avatars/sales-${avatarVariant(userId)}.webp`);
    rerender(<Avatar name="Sara Khan" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Sara Khan" })).toHaveTextContent("SK");
  });
});

describe("profile appearance", () => {
  it("offers the brand set, saves a chosen avatar and refuses a file that is not a photo", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ avatarPreset: "designer-f", photoUrl: null, version: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProfileAppearance email="sara@example.com" initial={{ avatarPreset: null, photoUrl: null, version: 0 }} name="Sara Khan" roles={["sales"]} userId={userId} workspaceId={workspaceId} />);
    expect(screen.getAllByRole("radio")).toHaveLength(32);
    expect(screen.getByRole("radio", { name: "Site supervisor · Man" }).querySelector("img")).toHaveAttribute("src", "/brand/avatars/site_supervisor-m.webp");
    await user.click(screen.getByRole("radio", { name: "Designer · Woman" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Designer · Woman" })).toHaveAttribute("aria-checked", "true"));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ workspaceId, avatarPreset: "designer-f", version: 0 });

    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, new File(["x"], "notes.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("Use a PNG, JPG or WebP photo.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
