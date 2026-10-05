import { notFound } from "next/navigation";
import { businessApiUrl } from "@/lib/auth/server";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { DesignSystemProvider } from "@/design-system";
import { ManageBooking } from "@/components/booking/manage-booking";
import type { ManageView } from "@/lib/booking/booking";
import { SLUG, TOKEN } from "@/lib/booking/public-proxy.server";
import theme from "@/components/crm/crm-workspace-colors.module.css";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getServerT();
  return { title: t("Your booking"), robots: { index: false, follow: false } };
}

/** The signed manage link: see the booking, move it or cancel it within the type's rules. */
export default async function ManageBookingPage({ params }: { params: Promise<{ workspace: string; token: string }> }) {
  const { workspace, token } = await params;
  if (!SLUG.test(workspace) || !TOKEN.test(token)) notFound();
  const response = await fetch(businessApiUrl(`/public/booking/${workspace}/manage/${token}`), { cache: "no-store", signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (response?.status === 404) notFound();
  if (!response?.ok) throw new Error((await getServerT())("Booking is unavailable right now. Please try again."));
  const data = await response.json() as ManageView;
  return <DesignSystemProvider className={theme.theme} style={workspacePrimaryColorStyle(data.branding)} locale={data.locale ?? undefined} timeZone={data.timeZone}>
    <ManageBooking data={data} workspace={workspace} token={token} />
  </DesignSystemProvider>;
}
