import { Container, Skeleton, Stack } from "@/design-system";

export default function JobsLoading() {
  return <Container as="section" size="full"><Stack gap={5}><Skeleton lines={2} /><Skeleton lines={8} /></Stack></Container>;
}
