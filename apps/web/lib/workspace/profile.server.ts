import "server-only";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, businessApiUrl } from "@/lib/auth/server";
import type { MyProfile } from "./profile";

/** My photo and avatar for the shell; never blocks the page if it fails. */
export async function getMyProfile(workspaceId: string | undefined): Promise<MyProfile | null> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!workspaceId || !token || (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true")) return null;
  const response = await fetch(businessApiUrl(`/workspaces/${workspaceId}/me/profile`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(5_000) }).catch(() => null);
  return response?.ok ? await response.json().catch(() => null) as MyProfile | null : null;
}
