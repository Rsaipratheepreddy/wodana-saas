import { redirect } from "next/navigation";
import { BookingTypesPage } from "@/components/booking/booking-types-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Sales › Settings › Booking pages (plan §6.5b). The service checks the Sales settings permission. */
export default async function BookingTypesRoute() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <BookingTypesPage workspaceId={membership.workspaceId} />;
}
