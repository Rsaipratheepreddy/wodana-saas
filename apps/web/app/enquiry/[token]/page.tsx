import { notFound } from "next/navigation";
import { businessApiUrl } from "@/lib/auth/server";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { DesignSystemProvider } from "@/design-system";
import { PublicEnquiryFormView } from "@/components/crm/public-enquiry-form";
import type { PublicEnquiryForm } from "@/lib/crm/lead-forms";
import theme from "@/components/crm/crm-workspace-colors.module.css";
import styles from "@/components/crm/lead-forms.module.css";

export const metadata = { title: "Project enquiry", robots: { index: false, follow: false } };
export default async function EnquiryPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const query = await searchParams;
  // A shared link or QR code may preset the source, channel and placement (PLM-036 / PLM-028); the server validates them.
  const pick = (key: string) => typeof query[key] === "string" && /^[a-z0-9][a-z0-9_-]{0,59}$/.test(query[key] as string) ? query[key] as string : undefined;
  const link = { source: pick("source"), channel: pick("channel"), placement: pick("placement") };
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) notFound();
  const response = await fetch(businessApiUrl(`/public/crm/lead-forms/${token}`), { cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("The enquiry form is temporarily unavailable. Please try again.");
  const form = await response.json() as PublicEnquiryForm;
  return <DesignSystemProvider className={theme.theme} style={workspacePrimaryColorStyle(form.branding)} locale={form.defaultLocale ?? undefined}><main className={styles.publicPage}>
    <PublicEnquiryFormView form={form} token={token} link={link.source || link.channel || link.placement ? link : undefined} />
  </main></DesignSystemProvider>;
}
