import { PageSkeleton } from "@/design-system";

export default function FactoryLoading() {
  return <PageSkeleton page variant="list" tabs={4} columns={6} />;
}
