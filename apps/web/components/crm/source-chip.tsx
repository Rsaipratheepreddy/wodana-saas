import { Globe, Mail, Phone, Users, UserRoundPlus, Building2, Repeat2, FileInput } from "lucide-react";
import { siFacebook, siInstagram, siWhatsapp } from "../brand/brand-icons";
import { label } from "@/lib/crm/client";
import styles from "./source-chip.module.css";

export function SourceChip({ source, displayLabel }: { source: string; displayLabel?: string }) {
  const key = source.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  const brand = key.includes("instagram") ? siInstagram : key.includes("facebook") || key === "meta" ? siFacebook : key.includes("whatsapp") ? siWhatsapp : null;
  const Icon = ({ self_generated: UserRoundPlus, company: Building2, third_party: Users, digital_marketing: Globe, website: Globe, web: Globe, email: Mail, gmail: Mail, phone: Phone, referral: Users, repeat: Repeat2, developer: Building2, manual: UserRoundPlus, import: FileInput } as Record<string, typeof Globe>)[key] ?? Globe;
  const tone = brand === siInstagram ? 'instagram' : brand === siFacebook ? 'facebook' : brand === siWhatsapp ? 'whatsapp' : ({ self_generated: 'self_generated', company: 'company', third_party: 'third_party', digital_marketing: 'digital_marketing', website: 'website', web: 'website', referral: 'referral', developer: 'developer', repeat: 'repeat' } as Record<string, string>)[key] ?? 'neutral';
  return <span className={styles.chip} title={displayLabel ?? label(source)} data-source-chip data-source={tone}>
    {brand ? <svg aria-hidden="true" viewBox="0 0 24 24" fill={`#${brand.hex}`}><path d={brand.path} /></svg> : <Icon aria-hidden="true" size={14} />}
    <span>{displayLabel ?? (key === "whatsapp" ? "WhatsApp" : label(source))}</span>
  </span>;
}
