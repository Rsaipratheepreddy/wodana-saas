import { useId } from "react";
import { Globe } from "lucide-react";
import { siBehance, siHouzz, siInstagram, siPinterest, siTiktok, siYoutube, type BrandIcon } from "./brand-icons";

/**
 * The real marks of the platforms clients share inspiration from. Brand colours are the brands'
 * own (from simple-icons), not theme colours; anything else falls back to a neutral globe.
 */
function Mark({ icon, fill }: { icon: BrandIcon; fill?: string }) {
  return <svg aria-hidden="true" role="img" viewBox="0 0 24 24"><path d={icon.path} fill={fill ?? `#${icon.hex}`} /></svg>;
}

function InstagramMark() {
  const id = useId();
  return <svg aria-hidden="true" role="img" viewBox="0 0 24 24">
    <defs>
      <radialGradient id={id} cx="0.3" cy="1.07" r="1.3">
        <stop offset="0" stopColor="#FFDC80" />
        <stop offset="0.12" stopColor="#FCAF45" />
        <stop offset="0.3" stopColor="#F77737" />
        <stop offset="0.5" stopColor="#F56040" />
        <stop offset="0.68" stopColor="#FD1D1D" />
        <stop offset="0.82" stopColor="#E1306C" />
        <stop offset="0.92" stopColor="#C13584" />
        <stop offset="1" stopColor="#833AB4" />
      </radialGradient>
    </defs>
    <path d={siInstagram.path} fill={`url(#${id})`} />
  </svg>;
}

function TiktokMark() {
  return <svg aria-hidden="true" role="img" viewBox="-1 -1 26 26">
    <path d={siTiktok.path} fill="#25F4EE" transform="translate(-0.6 -0.6)" />
    <path d={siTiktok.path} fill="#FE2C55" transform="translate(0.6 0.6)" />
    <path d={siTiktok.path} fill="#000000" />
  </svg>;
}

export function PlatformMark({ platform }: { platform: string }) {
  if (platform === "instagram") return <InstagramMark />;
  if (platform === "youtube") return <Mark icon={siYoutube} />;
  if (platform === "pinterest") return <Mark icon={siPinterest} />;
  if (platform === "tiktok") return <TiktokMark />;
  if (platform === "houzz") return <Mark icon={siHouzz} />;
  if (platform === "behance") return <Mark icon={siBehance} />;
  return <Globe aria-hidden="true" size={20} strokeWidth={1.7} />;
}
