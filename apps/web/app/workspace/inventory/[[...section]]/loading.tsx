import { PageSkeleton } from "@/design-system";

export default function InventoryLoading() {
  return <PageSkeleton page variant="list" tabs={3} columns={6} />;
}
