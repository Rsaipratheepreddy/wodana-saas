import type { Metadata } from "next";
import { Container, Heading, Text } from "@/design-system";
import styles from "../portal.module.css";

export const metadata: Metadata = { title: "Access required · Wodana Control" };

export default function InternalAccessDenied() {
  return <Container as="main" className={styles.errorPage} size="narrow">
    <Text size="xs" tone="muted">Wodana control</Text>
    <Heading as="h1" size="lg">Internal access required</Heading>
    <Text tone="muted">This portal is for authorized Wodana operators. Contact your platform administrator if you need access.</Text>
  </Container>;
}
