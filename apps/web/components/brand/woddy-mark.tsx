import Image from "next/image";
import { WODDY_MARK_SRC } from "@/lib/brand/identity";
import styles from "./woddy-mark.module.css";

export type WoddyMarkProps = {
  alt?: string;
  className?: string;
  priority?: boolean;
  size?: number;
};

/** The original mark silhouette and eyes, tinted to the Wodana accent family. */
export function WoddyMark({ alt = "", className, priority, size = 34 }: WoddyMarkProps) {
  return <Image alt={alt} className={[styles.mark, className].filter(Boolean).join(" ")} height={size} priority={priority} src={WODDY_MARK_SRC} width={size} />;
}
