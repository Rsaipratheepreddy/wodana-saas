"use client";

import { InlineNotice } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";

/** AI credits used up, or today's AI limit reached: a calm line with the next step, not an error. */
export function AiPauseNotice({ message, className }: { message: string; className?: string }) {
  const t = useT();
  return <InlineNotice className={className} tone="info" message={translateKnown(t, message)} />;
}
