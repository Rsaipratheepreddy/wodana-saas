import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, businessApiUrl } from "@/lib/auth/server";
import type { WaitingForYou } from "./approvals";

/** Everything waiting for the signed-in person, for the first paint of Approvals. */
export async function getWaitingForYou(workspaceId: string): Promise<{ data: WaitingForYou | null; failed: boolean }> {
  if (process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true")
    return { data: { rows: [], count: 0, counts: { designs: 0, quotes: 0, payments: 0, deals: 0, orders: 0, factory: 0, site: 0, stock: 0, finance: 0, ai: 0 } }, failed: false };
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const response = await fetch(businessApiUrl(`/workspaces/${workspaceId}/approvals/mine`), { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
  if (response?.status === 401) redirect("/login");
  if (!response?.ok) return { data: null, failed: true };
  return { data: await response.json() as WaitingForYou, failed: false };
}
