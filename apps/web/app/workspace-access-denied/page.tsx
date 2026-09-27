import type { Metadata } from "next";
import { Container, Heading, Stack, Text, TextLink } from "@/design-system";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { serverTranslator } from "@/lib/i18n/server";
import styles from "./workspace-access-denied.module.css";

export const metadata: Metadata = { title: "Workspace access · Wodana" };

/** Where a direct link to an area the person's role can't open lands: who to ask, and the way back. */
export default async function WorkspaceAccessDenied() {
  const [profile, t] = await Promise.all([getAuthenticatedProfile(), serverTranslator()]);
  const suspended = profile.unavailableOrganizations?.filter((item) => item.workspaceStatus === "suspended") ?? [];
  return <Container as="main" className={styles.page} size="narrow">
    <Stack gap={4}>
      <Heading as="h1" size="lg">{profile.memberships.length ? t("You don't have access to this") : t("Your organization is unavailable")}</Heading>
      <Text tone="muted">{profile.memberships.length
        ? t("Ask your workspace admin for access.")
        : suspended.length
          ? t("{names} is suspended. Contact your workspace administrator.", { names: suspended.map((item) => item.workspaceName).join(", ") })
          : t("You do not have an active workspace. Contact your workspace administrator.")}</Text>
      {profile.memberships.length ? <TextLink href="/workspace">{t("Go to Home")}</TextLink> : null}
    </Stack>
  </Container>;
}
