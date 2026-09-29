"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { receiveUrl, type ReceiveTarget } from "@/lib/operations/receive-link";
import styles from "./print.module.css";

/** The code printed on an order or a move: scanned on arrival, it opens that record's receive screen (D-46). */
export function ReceiveQr({ target, caption }: { target: ReceiveTarget; caption: string }) {
  const [code, setCode] = useState<{ key: string; src: string } | null>(null);
  const key = `${target.kind}:${target.id}`;
  useEffect(() => {
    let live = true;
    import("qrcode").then((module) => module.toDataURL(receiveUrl(window.location.origin, target), { width: 240, margin: 1, errorCorrectionLevel: "M" }))
      .then((src) => { if (live) setCode({ key, src }); }).catch(() => undefined);
    return () => { live = false; };
    // The code depends only on what it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <figure className={styles.qr}>
    {code?.key === key ? <Image unoptimized src={code.src} alt={caption} width={120} height={120} /> : <span className={styles.qrPending} aria-hidden="true" />}
    <figcaption>{caption}</figcaption>
  </figure>;
}
