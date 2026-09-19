import { notFound } from "next/navigation";
import Image from "next/image";
import { businessApiUrl } from "@/lib/auth/server";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";
import { DesignSystemProvider } from "@/design-system";
import { PublicEnquiryFormView } from "@/components/crm/public-enquiry-form";
import type { PublicEnquiryForm } from "@/lib/crm/lead-forms";
import theme from "@/components/crm/crm-workspace-colors.module.css";
import styles from "@/components/crm/lead-forms.module.css";

export const metadata = { title: "Project enquiry", robots: { index: false, follow: false } };
export default async function EnquiryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) notFound();
  const response = await fetch(businessApiUrl(`/public/crm/lead-forms/${token}`), { cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("The enquiry form is temporarily unavailable. Please try again.");
  const form = await response.json() as PublicEnquiryForm;
  return <DesignSystemProvider className={theme.theme} style={workspacePrimaryColorStyle(form.branding)} locale="en-AE" currency="AED" timeZone="Asia/Dubai"><main className={styles.publicPage}>
    {form.branding && <div className={styles.publicBrand}>{form.branding.logoUrl
      ? <Image src={form.branding.logoUrl} alt={form.branding.displayName} width={220} height={70} unoptimized />
      : <strong>{form.branding.displayName}</strong>}</div>}
    <PublicEnquiryFormView form={form} token={token} />
  </main></DesignSystemProvider>;
}
