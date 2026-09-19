import type { Metadata } from "next";
import { Container, Heading, Stack, Text, TextLink } from "@/design-system";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import styles from "./workspace-access-denied.module.css";

export const metadata: Metadata = { title: "Workspace access · Wodana" };

export default async function WorkspaceAccessDenied() {
  const profile = await getAuthenticatedProfile();
  const suspended = profile.unavailableOrganizations?.filter((item) => item.workspaceStatus === "suspended") ?? [];
  return <Container as="main" className={styles.page} size="narrow">
    <Stack gap={4}>
      <Text size="xs" tone="muted">Workspace access</Text>
      <Heading as="h1" size="lg">{profile.memberships.length ? "This module is unavailable to you" : "Your organization is unavailable"}</Heading>
      <Text tone="muted">{profile.memberships.length
        ? "Ask your workspace administrator for access to this module."
        : suspended.length
          ? `${suspended.map((item) => item.workspaceName).join(", ")} is suspended. Contact your workspace administrator.`
          : "You do not have an active workspace. Contact your workspace administrator."}</Text>
      {profile.memberships.length ? <TextLink href="/workspace">Go to workspace</TextLink> : null}
    </Stack>
  </Container>;
}
