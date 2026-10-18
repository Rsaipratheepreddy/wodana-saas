"use client";

import { useEffect } from "react";

/**
 * Names the browser tab (and the file a "Save as PDF" suggests) after the document on the page once its data is
 * there: "PO-2026-00011 · Palm Living". Empty parts are left out; nothing changes until there is a name.
 */
export function useDocumentTitle(parts: Array<string | null | undefined> | null) {
  const title = parts?.map((part) => part?.trim()).filter(Boolean).join(" · ") ?? "";
  useEffect(() => { if (title) document.title = title; }, [title]);
}
