import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { submitChatOnEnter } from "./chat-composer";

describe("chat composer keyboard", () => {
  it("uses the same submit handler for Enter and the send button, but not Shift+Enter", async () => {
    const submitted = vi.fn();
    render(<form onSubmit={(event) => { event.preventDefault(); submitted(); }}><textarea aria-label="Message" onKeyDown={submitChatOnEnter} /><button type="submit">Send</button></form>);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "Line one{Shift>}{Enter}{/Shift}Line two");
    expect(screen.getByRole("textbox")).toHaveValue("Line one\nLine two");
    expect(submitted).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(submitted).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(submitted).toHaveBeenCalledTimes(2);
  });

  it("does not send composition, repeated Enter, or modified keyboard input", () => {
    const submitted = vi.fn();
    render(<form onSubmit={(event) => { event.preventDefault(); submitted(); }}><textarea aria-label="Message" onKeyDown={submitChatOnEnter} /></form>);
    for (const props of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ...props });
    expect(submitted).not.toHaveBeenCalled();
  });
});
