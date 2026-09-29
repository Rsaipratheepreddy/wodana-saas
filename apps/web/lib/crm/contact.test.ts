import { describe, expect, it } from "vitest";
import { activityTitle } from "./contact";

const t = ((key: string) => `t:${key}`) as Parameters<typeof activityTitle>[1];

describe("logged contacts", () => {
  it("read as the channel and outcome in the reader's words, not the stored codes", () => {
    expect(activityTitle({ type: "call", title: "call · willing to talk", completionOutcome: "willing_to_talk" }, t)).toBe("t:Call · t:Willing to talk");
    expect(activityTitle({ type: "email", title: "email · message sent no reply", completionOutcome: "message_sent_no_reply" }, t)).toBe("t:Email · t:Message sent, no reply");
  });
  it("leave any other activity's own title", () => {
    expect(activityTitle({ type: "task", title: "Send Hessa the majlis brochure", completionOutcome: null }, t)).toBe("Send Hessa the majlis brochure");
    expect(activityTitle({ type: "call", title: "Call Faris about the JLT decision", completionOutcome: "Agreed to meet on Sunday" }, t)).toBe("Call Faris about the JLT decision");
  });
});
