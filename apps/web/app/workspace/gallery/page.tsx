import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GalleryEditor } from "@/components/gallery/gallery-editor";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Company gallery: the firm's brochure, edited here and shared by one link. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "";
  const protocol = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return <GalleryEditor workspaceId={membership.workspaceId} origin={host ? `${protocol}://${host}` : ""} />;
}
