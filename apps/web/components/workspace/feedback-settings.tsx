"use client";

import { useLayoutEffect } from "react";
import { configureFeedback } from "@/lib/feedback/sounds";

/** Hands the person's "Sound & haptics" choice, and whether they're viewing as someone, to the sounds. Renders nothing. */
export function FeedbackSettings({ enabled, viewingAs }: { enabled: boolean; viewingAs: boolean }) {
  useLayoutEffect(() => { configureFeedback({ enabled, viewingAs }); }, [enabled, viewingAs]);
  return null;
}
