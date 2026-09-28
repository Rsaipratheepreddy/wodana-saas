"use client";

import { useRouter } from "next/navigation";
import { useLiveInvalidate } from "@/lib/workspace/live-events";

/** For a page rendered on the server: re-renders it when one of `scopes` changes (someone else acted). */
export function LiveRefresh({ workspaceId, scopes }: { workspaceId: string; scopes: string[] }) {
  const router = useRouter();
  useLiveInvalidate(workspaceId, scopes, () => router.refresh(), 2_000);
  return null;
}
