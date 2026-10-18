import { Globe, Mail, Phone, Users, UserRoundPlus, Building2, Repeat2, FileInput } from "lucide-react";
import { siFacebook, siInstagram, siWhatsapp } from "../brand/brand-icons";
import { label } from "@/lib/crm/client";
import { Badge, chipHue } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";

export function SourceChip({ source, displayLabel }: { source: string; displayLabel?: string }) {
  const t = useT();
  const key = source.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  const brand = key.includes("instagram") ? siInstagram : key.includes("facebook") || key === "meta" ? siFacebook : key.includes("whatsapp") ? siWhatsapp : null;
  const Icon = ({ self_generated: UserRoundPlus, company: Building2, third_party: Users, digital_marketing: Globe, website: Globe, web: Globe, email: Mail, gmail: Mail, phone: Phone, referral: Users, repeat: Repeat2, developer: Building2, manual: UserRoundPlus, import: FileInput } as Record<string, typeof Globe>)[key] ?? Globe;
  const tone = brand === siInstagram ? 'instagram' : brand === siFacebook ? 'facebook' : brand === siWhatsapp ? 'whatsapp' : ({ self_generated: 'self_generated', company: 'company', third_party: 'third_party', digital_marketing: 'digital_marketing', website: 'website', web: 'website', referral: 'referral', developer: 'developer', repeat: 'repeat' } as Record<string, string>)[key] ?? 'neutral';
  // A source is a category: one calm hue per kind of source (no state colours), the same everywhere.
  const hue = tone === "neutral" ? undefined : ({ self_generated: 1, website: 1, facebook: 1, company: 2, developer: 2, referral: 6, repeat: 6, whatsapp: 6 } as Record<string, 1 | 2 | 6>)[tone] ?? chipHue(tone);
  return <Badge data-icon="" data-source={tone} data-source-chip="" hue={hue} title={displayLabel ?? translateKnown(t, label(source))}>
    {brand ? <svg aria-hidden="true" fill={`#${brand.hex}`} height={14} viewBox="0 0 24 24" width={14}><path d={brand.path} /></svg> : <Icon aria-hidden="true" size={14} />}
    <span>{displayLabel ?? (key === "whatsapp" ? "WhatsApp" : translateKnown(t, label(source)))}</span>
  </Badge>;
}
