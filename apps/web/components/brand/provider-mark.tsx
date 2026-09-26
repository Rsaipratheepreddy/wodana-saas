import { Braces, CreditCard } from "lucide-react";
import { siAutodesk, siDropbox, siMeta, siQuickbooks, siWhatsapp, siZoho, type SimpleIcon } from "simple-icons";
import type { ProviderCapabilityState } from "@/lib/workspace/integrations";

function SimpleBrandMark({ color, icon }: { color?: string; icon: SimpleIcon }) {
  return <svg aria-hidden="true" fill={color ?? `#${icon.hex}`} role="img" viewBox="0 0 24 24"><path d={icon.path} /></svg>;
}

function GoogleWorkspaceMark() {
  return <svg aria-hidden="true" role="img" viewBox="0 0 24 24">
    <path d="M21.6 12.227c0-.709-.064-1.39-.182-2.045H12v3.868h5.382a4.6 4.6 0 0 1-1.995 3.018v2.51h3.229c1.89-1.74 2.984-4.305 2.984-7.35Z" fill="#4285F4" />
    <path d="M12 22c2.7 0 4.964-.896 6.616-2.423l-3.229-2.51c-.895.6-2.04.956-3.387.956-2.605 0-4.81-1.76-5.6-4.123H3.064v2.59A9.997 9.997 0 0 0 12 22Z" fill="#34A853" />
    <path d="M6.4 13.9A6.01 6.01 0 0 1 6.086 12c0-.66.114-1.3.314-1.9V7.51H3.064A9.997 9.997 0 0 0 2 12c0 1.614.386 3.14 1.064 4.49L6.4 13.9Z" fill="#FBBC05" />
    <path d="M12 5.977c1.468 0 2.786.505 3.823 1.496l2.864-2.864C16.959 2.995 14.696 2 12 2a9.997 9.997 0 0 0-8.936 5.51L6.4 10.1C7.19 7.736 9.395 5.977 12 5.977Z" fill="#EA4335" />
  </svg>;
}

function MicrosoftMark() {
  return <svg aria-hidden="true" role="img" viewBox="0 0 23 23">
    <path d="M0 0h11v11H0z" fill="#f35325" />
    <path d="M12 0h11v11H12z" fill="#81bc06" />
    <path d="M0 12h11v11H0z" fill="#05a6f0" />
    <path d="M12 12h11v11H12z" fill="#ffba08" />
  </svg>;
}

function DocusignMark() {
  return <svg aria-hidden="true" role="img" viewBox="0 0 194 194">
    <path d="M139.5 139.5V189c0 2.6-2.1 4.7-4.7 4.7H4.7A4.7 4.7 0 0 1 0 189V59c0-2.6 2.1-4.7 4.7-4.7h49.4v80.5c0 2.6 2.1 4.7 4.7 4.7h80.7Z" fill="#4c00ff" />
    <path d="M193.7 69.7c0 41.6-24.3 69.7-54.2 69.8V87.1c0-1.5-.6-3-1.7-4l-27.2-27.2a5.6 5.6 0 0 0-4-1.7H54.2V4.8C54.2 2.2 56.3.1 59 .1h73.3c34.7-.1 61.4 27.9 61.4 69.6Z" fill="#ff5252" />
    <path d="M137.8 83c1.1 1.1 1.7 2.5 1.7 4v52.4H58.9a4.7 4.7 0 0 1-4.7-4.7V54.2h52.4c1.5 0 3 .6 4 1.7L137.8 83Z" fill="#171319" />
  </svg>;
}

export function ProviderMark({ provider }: { provider: ProviderCapabilityState["id"] }) {
  if (provider === "google_workspace") return <GoogleWorkspaceMark />;
  if (provider === "quickbooks") return <SimpleBrandMark icon={siQuickbooks} />;
  if (provider === "whatsapp") return <SimpleBrandMark icon={siWhatsapp} />;
  if (provider === "zoho_books") return <SimpleBrandMark icon={siZoho} />;
  if (provider === "autodesk_construction_cloud") return <SimpleBrandMark color="currentColor" icon={siAutodesk} />;
  if (provider === "microsoft_365") return <MicrosoftMark />;
  if (provider === "docusign") return <DocusignMark />;
  if (provider === "dropbox") return <SimpleBrandMark icon={siDropbox} />;
  if (provider === "meta_lead_ads") return <SimpleBrandMark icon={siMeta} />;
  if (provider === "payment") return <CreditCard aria-hidden="true" size={24} strokeWidth={1.7} />;
  return <Braces aria-hidden="true" size={24} strokeWidth={1.7} />;
}
