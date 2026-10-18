"use client";

import type { ReactNode } from "react";
import { MapPin } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { mapsUrl, validCoordinates } from "@/lib/geo/map-link";
import styles from "./site-location.module.css";

type Position = { latitude?: number | null; longitude?: number | null };

/** Open in Maps for a position, in a new tab (the maps app on a phone); nothing without valid coordinates. */
export function OpenInMaps({ latitude, longitude }: Position) {
  const t = useT();
  if (!validCoordinates(latitude, longitude)) return null;
  return <a className={styles.maps} href={mapsUrl({ latitude: latitude as number, longitude: longitude as number })} target="_blank" rel="noopener noreferrer">
    <MapPin aria-hidden="true" size={13} />{t("Open in Maps")}
  </a>;
}

/** Where a job is, read only: its address, then Open in Maps. The fallback shows when neither is known. */
export function SiteLocation({ address, latitude, longitude, fallback = null }: Position & { address?: string | null; fallback?: ReactNode }) {
  const located = validCoordinates(latitude, longitude);
  if (!address?.trim() && !located) return <>{fallback}</>;
  return <span className={styles.site}>
    {address?.trim() ? <span>{address}</span> : null}
    <OpenInMaps latitude={latitude} longitude={longitude} />
  </span>;
}
