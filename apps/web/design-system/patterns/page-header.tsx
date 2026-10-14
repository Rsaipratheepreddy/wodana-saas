"use client";

import type { ReactNode } from "react";
import { Heading, LabelText, Text } from "../primitives/typography";
import { useNamedByChrome } from "./page-shell";

/**
 * A page's compact title row with its actions at the end. When the workspace chrome already names the page (see
 * `PageChrome`), the title is for screen readers only and only the actions keep a row.
 */
export function PageHeader({ actions, description, eyebrow, title }: {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
}) {
  const named = useNamedByChrome(title);
  if (named) return <header className="wd-page-header" data-named="">
    <h1 className="wd-visually-hidden">{title}</h1>
    {description ? <Text tone="muted">{description}</Text> : null}
    {actions ? <div className="wd-page-header-actions">{actions}</div> : null}
  </header>;
  return <header className="wd-page-header">
    <div className="wd-page-header-copy">
      <span className="wd-page-header-title">
        {eyebrow ? <LabelText>{eyebrow}</LabelText> : null}
        <Heading as="h1" size="md">{title}</Heading>
      </span>
      {description ? <Text tone="muted">{description}</Text> : null}
    </div>
    {actions ? <div className="wd-page-header-actions">{actions}</div> : null}
  </header>;
}
