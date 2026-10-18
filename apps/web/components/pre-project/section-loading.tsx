import { PageSkeleton } from "@/design-system";

/** A planning section while it opens: the section's header, toolbar and rows. */
export function PreProjectSectionLoading() {
  return <PageSkeleton variant="list" rows={6} />;
}
