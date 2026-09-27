"use client";
import Image from "next/image";
import type { PortalBrand } from "@/lib/commercial/types";
import s from "./commercial.module.css";

/** The tenant's logo on an issued document, or its initials and name when it has no logo. */
export function BrandLogo({ brand }: { brand: PortalBrand }) {
  return <div className={s.logo}>
    {brand.logo
      ? <Image unoptimized src={brand.logo} alt={brand.name} width={160} height={48} style={{ objectFit: "contain", width: "auto", height: "auto" }} />
      : <>
        <span className={s.logoMark} aria-hidden style={{ background: brand.primaryColor }}>
          {brand.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}
        </span>
        <span>{brand.name}</span>
      </>}
  </div>;
}
