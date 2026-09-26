/**
 * Prints one element as A4 pages from a hidden frame, with the app's styles and fonts, so the
 * browser's "Save as PDF" gives the client document on its own.
 */
export async function printDocument(element: HTMLElement, title: string) {
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", insetInlineStart: "-10000px", insetBlockStart: "0", inlineSize: "210mm", blockSize: "297mm", border: "0" });
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument, win = frame.contentWindow;
    if (!doc || !win) throw new Error("Could not prepare the document.");
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map((node) => node.outerHTML).join("");
    doc.open();
    doc.write(`<!doctype html><html class="${document.documentElement.className}" dir="${document.documentElement.dir || "ltr"}" lang="${document.documentElement.lang}"><head><meta charset="utf-8"><title>${title.replace(/</g, "&lt;")}</title>${styles}<style>@page{size:A4;margin:0}html,body{margin:0;padding:0;background:white}</style></head><body>${element.outerHTML}</body></html>`);
    doc.close();
    await Promise.all(Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map((link) => new Promise<void>((resolve) => {
      if ((link as HTMLLinkElement).sheet) return resolve();
      link.addEventListener("load", () => resolve(), { once: true }); link.addEventListener("error", () => resolve(), { once: true }); setTimeout(resolve, 4000);
    })));
    await doc.fonts.ready;
    await Promise.all(Array.from(doc.images).map((image) => image.decode().catch(() => undefined)));
    win.focus();
    win.print();
  } finally {
    setTimeout(() => frame.remove(), 1000);
  }
}
