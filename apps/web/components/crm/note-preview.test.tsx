import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { markdownDocument } from "@/lib/crm/note-document";
import { NotePreview } from "./note-preview";

describe("note preview", () => {
  it("turns markdown habits in plain notes into structure", () => {
    const doc = markdownDocument("# Kitchen\nFull height **oak** units, see [ref](https://example.com/oak)\n- soft-close\n- handleless\n1. measure\n2. quote\n> keep the arch\n- [x] floor plan");
    expect(doc.content!.map((node) => node.type)).toEqual(["heading", "paragraph", "bulletList", "orderedList", "blockquote", "bulletList"]);
    expect(doc.content![1].content).toEqual(expect.arrayContaining([expect.objectContaining({ text: "oak", marks: [{ type: "bold" }] }), expect.objectContaining({ text: "ref", marks: [{ type: "link", attrs: { href: "https://example.com/oak" } }] })]));
  });

  it("renders headings, lists, emphasis and safe links without markdown symbols", () => {
    render(<NotePreview text={"## Wardrobe\n- **Fluted** glass doors\n- LED strips\nSee [board](https://example.com/b) or javascript:alert(1)"} />);
    expect(screen.getByRole("heading", { name: "Wardrobe" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Fluted").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "board" })).toHaveAttribute("href", "https://example.com/b");
    expect(document.body.textContent).not.toContain("**");
    expect(document.body.textContent).not.toContain("##");
  });

  it("renders editor documents and skips inline media, and clips long notes", () => {
    const document = { content: { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "Line one" }] },
      { type: "noteMedia", attrs: { assetId: "a" } },
      { type: "paragraph", content: [{ type: "text", text: "Line two" }] },
      { type: "paragraph", content: [{ type: "text", text: "Line three" }] },
    ] } };
    const { container } = render(<NotePreview document={document} limit={2} />);
    expect(screen.getByText("Line one")).toBeInTheDocument();
    expect(screen.queryByText("Line three")).not.toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute("data-clipped", "true");
  });
});
