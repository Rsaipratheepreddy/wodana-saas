import type { KeyboardEvent } from "react";

/** Use the form's submit path for both the send button and Enter. */
export function submitChatOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  // Safari can end composition before dispatching Enter, while keeping keyCode 229.
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  event.preventDefault();
  if (!event.repeat) event.currentTarget.form?.requestSubmit();
}
