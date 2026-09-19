import type { ReactNode } from "react";
import { Heading, LabelText, Text } from "../primitives/typography";

export function PageHeader({ actions, description, eyebrow, title }: {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
}) {
  return <header className="wd-page-header">
    <div className="wd-page-header-copy">
      <span className="wd-page-header-title">
        {eyebrow ? <LabelText>{eyebrow}</LabelText> : null}
        <Heading as="h1" size="lg">{title}</Heading>
      </span>
      {description ? <Text tone="muted">{description}</Text> : null}
    </div>
    {actions ? <div className="wd-page-header-actions">{actions}</div> : null}
  </header>;
}
