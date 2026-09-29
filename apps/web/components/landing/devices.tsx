import type { CSSProperties } from "react";
import type { Translate } from "@/lib/i18n/keys";
import type { Shot } from "./landing-shots";
import { Screenshot } from "./screenshot";
import styles from "./devices.module.css";

export type DeviceKind = "iphone" | "android";

/** The status bar drawn over the screen's top strip: the time, then signal, Wi-Fi and battery. */
function StatusBar({ kind }: { kind: DeviceKind }) {
  return <span aria-hidden="true" className={styles.status} data-kind={kind}>
    <span className={styles.time}>9:41</span>
    <svg className={styles.glyphs} focusable="false" viewBox="0 0 68 14">
      {/* Signal */}
      <rect height="4" rx="1" width="3" x="0" y="9" /><rect height="6.5" rx="1" width="3" x="4.5" y="6.5" />
      <rect height="9" rx="1" width="3" x="9" y="4" /><rect height="11.5" rx="1" width="3" x="13.5" y="1.5" />
      {/* Wi-Fi */}
      <path d="M31 12.6 28.4 10a3.7 3.7 0 0 1 5.2 0L31 12.6Zm-4.3-4.3-1.6-1.6a8.3 8.3 0 0 1 11.8 0l-1.6 1.6a6 6 0 0 0-8.6 0Zm-3.3-3.3L21.8 3.4a13 13 0 0 1 18.4 0L38.6 5a10.7 10.7 0 0 0-15.2 0Z" />
      {/* Battery */}
      <rect fill="none" height="11" rx="3.2" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" width="23" x="42.5" y="1.5" />
      <rect height="8" rx="1.8" width="17" x="44.5" y="3" />
      <path d="M67 5.5v3.6c.8-.3 1.3-1 1.3-1.8s-.5-1.5-1.3-1.8Z" opacity="0.45" />
    </svg>
  </span>;
}

/**
 * A realistic phone in CSS: a titanium iPhone with its Dynamic Island, or an aluminium Android phone with a
 * punch-hole camera, with side buttons, a glass bezel and a soft reflection, holding a real app screenshot.
 * Every measure is a share of the phone's width (container units), so it keeps its proportions at any size.
 * The frame is decoration; only the screenshot is described.
 */
export function Phone({ kind = "iphone", shot, t, sizes, width, className, decorative = false }: {
  kind?: DeviceKind;
  shot: Shot;
  t: Translate;
  sizes: string;
  /** The phone's width (any CSS length); its height follows the screen. */
  width?: string;
  className?: string;
  decorative?: boolean;
}) {
  const style = width ? { "--device-w": width } as CSSProperties : undefined;
  return <div className={[styles.device, className].filter(Boolean).join(" ")} data-kind={kind} style={style}>
    <div className={styles.body}>
      <span aria-hidden="true" className={styles.buttons} />
      <div className={styles.bezel}>
        <div className={styles.screen}>
          <Screenshot className={styles.shot} decorative={decorative} shot={shot} sizes={sizes} t={t} />
          <StatusBar kind={kind} />
          <span aria-hidden="true" className={kind === "iphone" ? styles.island : styles.camera} />
          <span aria-hidden="true" className={styles.home} />
          <span aria-hidden="true" className={styles.glare} />
        </div>
      </div>
    </div>
  </div>;
}
