import { notFound } from "next/navigation";
import { businessApiUrl } from "@/lib/auth/server";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { DesignSystemProvider } from "@/design-system";
import { PublicBooking } from "@/components/booking/public-booking";
import { linkFromQuery, type PublicBookingType } from "@/lib/booking/booking";
import { SLUG } from "@/lib/booking/public-proxy.server";
import theme from "@/components/crm/crm-workspace-colors.module.css";
import { getServerT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getServerT();
  return { title: t("Book a meeting"), robots: { index: false, follow: false } };
}

/** The public booking page (plan §6.5b): tenant-branded, mobile first; a link or embed may preset source, channel and UTM. */
export default async function BookingPage({ params, searchParams }: { params: Promise<{ workspace: string; type: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { workspace, type } = await params;
  const query = await searchParams;
  if (!SLUG.test(workspace) || !SLUG.test(type)) notFound();
  const response = await fetch(businessApiUrl(`/public/booking/${workspace}/${type}`), { cache: "no-store", signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (response?.status === 404) notFound();
  if (!response?.ok) throw new Error((await getServerT())("Booking is unavailable right now. Please try again."));
  const data = await response.json() as PublicBookingType;
  return <DesignSystemProvider className={theme.theme} style={workspacePrimaryColorStyle(data.branding)} locale={data.locale ?? undefined} timeZone={data.timeZone}>
    <PublicBooking data={data} workspace={workspace} link={linkFromQuery(query)} embedded={query.embed === "1"} />
  </DesignSystemProvider>;
}
