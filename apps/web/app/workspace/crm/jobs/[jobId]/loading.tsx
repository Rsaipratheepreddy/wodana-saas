import { Container, Skeleton, Stack } from "@/design-system";

export default function JobLoading() {
  return <Container as="section" size="full"><Stack gap={5}><Skeleton lines={3} /><Skeleton lines={10} /></Stack></Container>;
}
