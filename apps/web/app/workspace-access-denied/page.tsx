import type { Metadata } from "next";
import { Container, Heading, Stack, Text, TextLink } from "@/design-system";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import styles from "./workspace-access-denied.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Workspace access · Wodana") };
}

export default async function WorkspaceAccessDenied() {
  const profile = await getAuthenticatedProfile();
  const t = await getServerT();
  const suspended = profile.unavailableOrganizations?.filter((item) => item.workspaceStatus === "suspended") ?? [];
  return <Container as="main" className={styles.page} size="narrow">
    <Stack gap={4}>
      <Text size="xs" tone="muted">{t("Workspace access")}</Text>
      <Heading as="h1" size="lg">{profile.memberships.length ? t("This module is unavailable to you") : t("Your organization is unavailable")}</Heading>
      <Text tone="muted">{profile.memberships.length
        ? t("Ask your workspace administrator for access to this module.")
        : suspended.length
          ? t("{workspaces} is suspended. Contact your workspace administrator.", { workspaces: suspended.map((item) => item.workspaceName).join(", ") })
          : t("You do not have an active workspace. Contact your workspace administrator.")}</Text>
      {profile.memberships.length ? <TextLink href="/workspace">{t("Go to workspace")}</TextLink> : null}
    </Stack>
  </Container>;
}
