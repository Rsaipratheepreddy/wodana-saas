"use client";

import { Languages } from "lucide-react";
import type { ReactNode } from "react";
import { SelectField } from "@/design-system";
import { useLanguage, useT } from "@/lib/i18n/i18n-provider";
import { languages, supportedLanguage } from "@/lib/i18n/languages";

/**
 * The person's interface language, each name in its own script. The choice applies at once, is remembered on
 * this device, and inside the workspace is saved on the person's profile too.
 */
export function LanguageSelect({ label, description, compact = false, className }: {
  /** Visible label; `null` hides it (the field keeps an accessible name). */
  label?: ReactNode | null;
  description?: ReactNode;
  /** A small field with a language icon, for headers and the sign-in page. */
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  const { language, setLanguage, isSwitching } = useLanguage();
  const field = <SelectField
    accent="neutral"
    aria-label={t("Language")}
    description={description}
    isDisabled={isSwitching}
    items={languages.map((item) => ({ id: item.id, label: item.label }))}
    label={label === undefined ? t("Language") : label}
    onSelectionChange={(key) => {
      const next = supportedLanguage(key === null ? null : String(key));
      if (next && next !== language) void setLanguage(next);
    }}
    prefix={compact ? <Languages size={15} strokeWidth={2} /> : undefined}
    selectedKey={language} />;
  return className ? <div className={className} data-language-select>{field}</div> : field;
}
