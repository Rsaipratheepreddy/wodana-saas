import { describe, expect, it } from "vitest";
import type { CrmLeadListItem } from "./leads";
import { formAnswerColumns, formAnswerValue } from "./form-answer-columns";

const lead = (id: string, formId: string | null, answers: CrmLeadListItem["formAnswers"]): CrmLeadListItem => ({
  id, formId, formAnswers: answers,
} as CrmLeadListItem);

describe("dynamic enquiry form columns", () => {
  it("keeps core enquiry fields out and adds one column for each custom question", () => {
    const leads = [
      lead("one", "form-a", [
        { questionId: "name", title: "Your name", type: "text", field: "displayName", value: "Mina" },
        { questionId: "rooms", title: "How many rooms?", type: "number", field: "custom", value: "3" },
        { questionId: "features", title: "Features", type: "checkboxes", field: "custom", value: ["Storage", "Garden"] },
      ]),
      lead("two", "form-a", [{ questionId: "rooms", title: "How many rooms?", type: "number", field: "custom", value: "" }]),
      lead("three", "form-b", [{ questionId: "rooms", title: "Room count", type: "number", field: "custom", value: "2" }]),
    ];
    const columns = formAnswerColumns(leads);
    expect(columns.map(column => column.title)).toEqual(["How many rooms?", "Features", "Room count"]);
    expect(formAnswerValue(leads[0], columns[0])).toBe("3");
    expect(formAnswerValue(leads[0], columns[1])).toBe("Storage, Garden");
    expect(formAnswerValue(leads[1], columns[0])).toBe("—");
    expect(formAnswerValue(leads[2], columns[0])).toBe("—");
  });
});
