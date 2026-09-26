import { Fragment, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/react";
import { markdownDocument } from "@/lib/crm/note-document";
import styles from "./note-preview.module.css";

type Props = { document?: { content: JSONContent } | null; text?: string; limit?: number; className?: string };

/** A note as readers see it: headings, lists, quotes, code and links, never raw markdown. Photos and videos stay with the note's attachments. */
export function NotePreview({ document, text = "", limit, className }: Props) {
  const doc = document?.content ?? markdownDocument(text);
  const blocks = (doc.content ?? []).filter((node) => node.type !== "noteMedia" && !(node.type === "paragraph" && !node.content?.length));
  const shown = limit ? blocks.slice(0, limit) : blocks;
  if (!shown.length) return null;
  return <div className={[styles.note, className].filter(Boolean).join(" ")} data-clipped={limit && blocks.length > limit ? "true" : undefined}>{shown.map((node, index) => <Block key={index} node={node} />)}</div>;
}

function Block({ node }: { node: JSONContent }): ReactNode {
  const children = (node.content ?? []).map((child, index) => <Block key={index} node={child} />);
  switch (node.type) {
    case "paragraph": return <p>{inline(node)}</p>;
    case "heading": { const level = Math.min(3, Number(node.attrs?.level ?? 2)); return level === 1 ? <h4 data-level="1">{inline(node)}</h4> : level === 2 ? <h5 data-level="2">{inline(node)}</h5> : <h6 data-level="3">{inline(node)}</h6>; }
    case "bulletList": return <ul>{children}</ul>;
    case "orderedList": return <ol start={Number(node.attrs?.start ?? 1)}>{children}</ol>;
    case "listItem": return <li data-checked={node.attrs?.checked === undefined ? undefined : String(node.attrs.checked)}>{children}</li>;
    case "blockquote": return <blockquote>{children}</blockquote>;
    case "codeBlock": return <pre><code>{(node.content ?? []).map((child) => child.text ?? "").join("")}</code></pre>;
    case "horizontalRule": return <hr />;
    case "noteMedia": return null;
    default: return <>{children}</>;
  }
}

function inline(node: JSONContent): ReactNode {
  return (node.content ?? []).map((child, index) => {
    if (child.type === "hardBreak") return <br key={index} />;
    if (child.type !== "text") return <Fragment key={index}>{inline(child)}</Fragment>;
    let out: ReactNode = child.text ?? "";
    for (const mark of child.marks ?? []) {
      if (mark.type === "bold") out = <strong>{out}</strong>;
      else if (mark.type === "italic") out = <em>{out}</em>;
      else if (mark.type === "strike") out = <s>{out}</s>;
      else if (mark.type === "underline") out = <u>{out}</u>;
      else if (mark.type === "code") out = <code>{out}</code>;
      else if (mark.type === "link" && typeof mark.attrs?.href === "string" && /^https?:\/\//i.test(mark.attrs.href)) out = <a href={mark.attrs.href} rel="noopener noreferrer" target="_blank" onClick={(event) => event.stopPropagation()}>{out}</a>;
    }
    return <Fragment key={index}>{out}</Fragment>;
  });
}
