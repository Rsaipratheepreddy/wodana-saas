"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, InlineNotice, PageHeader, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { inventoryApi } from "@/lib/inventory/client";
import { RECEIVE_PATH, parseReceiveLink, receiveHref, type ReceiveTarget } from "@/lib/operations/receive-link";
import { purchasingApi } from "@/lib/purchasing/client";
import { MoveSheet } from "../inventory/moves";
import { ReceiveDialog } from "./receive-dialog";
import styles from "./receive-scan.module.css";

type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
type DetectorClass = new (options: { formats: string[] }) => Detector;

/** The phone's QR reader, where the browser has one (Chrome on Android does); elsewhere the phone's own camera opens the link. */
function detectorClass(): DetectorClass | null {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  return (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector ?? null;
}

/**
 * Receiving on a phone (D-46), camera first: the code on a printed purchase order or move opens its receive screen
 * (`?order=` or `?move=`, which the phone's own camera opens too). Without a camera, the order or move number finds it.
 * After a delivery is received the camera is ready for the next one.
 */
export function ReceiveScan({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const target = parseReceiveLink(`${RECEIVE_PATH}?${params?.toString() ?? ""}`);
  const purchasing = useMemo(() => purchasingApi(workspaceId), [workspaceId]);
  const stock = useMemo(() => inventoryApi(workspaceId), [workspaceId]);
  const [notice, setNotice] = useState("");
  const open = useCallback((found: ReceiveTarget) => { setNotice(""); router.replace(receiveHref(found)); }, [router]);
  const back = () => router.replace(RECEIVE_PATH);
  return <div className={styles.page}>
    <PageHeader title={t("Receive")} />
    {notice ? <InlineNotice tone="success" message={notice} /> : null}
    {target ? null : <Scanner onFound={open} find={async (text) => {
      const value = text.trim().toLowerCase();
      const orders = await purchasing.deliveries().then((state) => state.expected).catch(() => []);
      const order = orders.find((row) => row.number.toLowerCase() === value);
      if (order) return { kind: "order", id: order.id };
      const digits = value.replace(/\D/g, "");
      const moves = digits ? await stock.transfers().then((state) => state.transfers).catch(() => []) : [];
      const move = moves.find((row) => String(row.number) === digits && row.status === "in_transit");
      return move ? { kind: "move", id: move.id } : null;
    }} />}
    {target?.kind === "order" ? <ReceiveDialog api={purchasing} orderId={target.id} onClose={back}
      onReceived={() => { setNotice(t("Received. Scan the next delivery.")); back(); }} /> : null}
    {target?.kind === "move" ? <MoveSheet api={stock} transferId={target.id} onChanged={() => setNotice(t("Received. Scan the next delivery."))} onClose={back} /> : null}
  </div>;
}

function Scanner({ onFound, find }: { onFound: (target: ReceiveTarget) => void; find: (text: string) => Promise<ReceiveTarget | null> }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<"starting" | "scanning" | "none" | "blocked">("starting");
  const [unknown, setUnknown] = useState(false);
  const [number, setNumber] = useState("");
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const Barcode = detectorClass();
    if (!Barcode) { queueMicrotask(() => setCamera("none")); return; }
    const detector = new Barcode({ formats: ["qr_code"] });
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(async (media) => {
      if (stopped) { media.getTracks().forEach((track) => track.stop()); return; }
      stream = media;
      const element = video.current;
      if (!element) return;
      element.srcObject = media;
      await element.play().catch(() => undefined);
      setCamera("scanning");
      const look = async () => {
        if (stopped) return;
        const codes = await detector.detect(element).catch(() => []);
        for (const code of codes) {
          const found = parseReceiveLink(code.rawValue);
          if (found) { stopped = true; onFound(found); return; }
          if (code.rawValue) setUnknown(true);
        }
        timer = window.setTimeout(() => void look(), 250);
      };
      void look();
    }).catch(() => { if (!stopped) setCamera("blocked"); });
    return () => { stopped = true; window.clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop()); };
  }, [onFound]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!number.trim()) return;
    setBusy(true); setMissing(false);
    const found = await find(number);
    setBusy(false);
    if (found) onFound(found); else setMissing(true);
  };
  return <section className={styles.scanner} aria-label={t("Scan the code on the order or move")}>
    {camera === "none" || camera === "blocked" ? null : <video ref={video} className={styles.camera} muted playsInline aria-label={t("Camera")} />}
    <p className={styles.hint} role="status">{camera === "scanning" ? (unknown ? t("That code isn't an order or a move. Scan the code on the printed order or move.") : t("Point the camera at the code on the printed order or move."))
      : camera === "blocked" ? t("The camera is off for this page. Allow it in the browser, or enter the number.")
      : camera === "none" ? t("Scan the code with your phone's camera, or enter the number.") : t("Starting the camera…")}</p>
    <form className={styles.manual} onSubmit={(event) => void submit(event)}>
      <TextInput label={t("Order or move number")} value={number} onChange={(value) => { setNumber(value); setMissing(false); }}
        errorMessage={missing ? t("No order or move on its way has that number.") : undefined} isInvalid={missing} />
      <Button type="submit" isLoading={busy} isDisabled={!number.trim()}>{t("Open")}</Button>
    </form>
  </section>;
}
