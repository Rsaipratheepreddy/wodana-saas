"use client";

import { useRouter } from "next/navigation";
import { ListTabs } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";

export type ApprovalSource = "mine" | "designs" | "projects";

/** The approval queues the person can review, under the title; each is its own address. */
export function ApprovalTabs({ value, canReviewCases, canReviewProjects }: { value: ApprovalSource; canReviewCases: boolean; canReviewProjects: boolean }) {
  const t = useT();
  const router = useRouter();
  const items: Array<{ id: ApprovalSource; label: string }> = [{ id: "mine", label: t("Waiting for you") },
    ...(canReviewCases ? [{ id: "designs" as const, label: t("Designs") }] : []), ...(canReviewProjects ? [{ id: "projects" as const, label: t("Project requests") }] : [])];
  return <ListTabs label={t("Approval sources")} items={items} value={value}
    onChange={(id) => router.push(id === "mine" ? "/workspace/approvals" : `/workspace/approvals?source=${id}`)} />;
}
