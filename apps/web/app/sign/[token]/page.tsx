import { DesignSystemProvider } from "@/design-system";
import { SigningPage } from "@/components/esign/signing-page";
import { businessApiUrl } from "@/lib/auth/server";
import { getServerT } from "@/lib/i18n/server";
import type { SigningView } from "@/lib/proposals/client";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";

export async function generateMetadata() {
  const t = await getServerT();
  return { title: t("Sign"), robots: { index: false, follow: false } };
}

/** R8: the public signing page behind a signing link (no account; the token is the key), in the firm's brand. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  const response = valid ? await fetch(businessApiUrl(`/esign/${token}`), { cache: "no-store", signal: AbortSignal.timeout(12000) }).catch(() => null) : null;
  const view = response?.ok ? await response.json() as SigningView : undefined;
  return <DesignSystemProvider style={workspacePrimaryColorStyle(view?.brand.primaryColor)}>
    <SigningPage token={token} initial={view} />
  </DesignSystemProvider>;
}
