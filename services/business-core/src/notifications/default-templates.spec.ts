import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_TEMPLATES, renderNoticeText } from "./default-templates";

describe("team notices", () => {
  it("name the role after the project, so any role noun reads naturally", () => {
    const variables = { title: "PRJ-0004", clientName: "Aisha", actor: "Sara", role: "Procurement" };
    const text = (code: string, channel: string, part: "subject" | "body") =>
      renderNoticeText(DEFAULT_NOTIFICATION_TEMPLATES.find((template) => template.code === code && template.channel === channel)![part] ?? "", variables);
    expect(text("project.team_added", "email", "subject")).toBe("You're on PRJ-0004 as Procurement");
    expect(text("project.team_added", "email", "body")).toBe("Sara added you to PRJ-0004 for Aisha as Procurement.");
    expect(text("project.started", "email", "body")).toBe("Sara started PRJ-0004 for Aisha. You're on it as Procurement.");
    expect(DEFAULT_NOTIFICATION_TEMPLATES.some((template) => /You're the \{\{role\}\}/.test(`${template.subject} ${template.body}`))).toBe(false);
  });
});
